const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { randomBytes } = require("node:crypto");
const Module = require("node:module");
const { createRateLimit, clientAddress } = require("../src/middlewares/auth-rate-limit");
const { trustedProxyAddresses } = require("../src/config/trusted-proxies");
const { assertProductionConfig } = require("../src/config/env");
const { bootstrapAdmin, readAdminInput } = require("../src/scripts/bootstrap-admin");
const { assertSafeProductionAdmin, DEMO_ADMIN_EMAIL, DEMO_ADMIN_HASH, DEMO_ADMIN_PASSWORD } = require("../src/security/demo-credentials");

function loadWithMocks(relativePath, mocks) {
  const filename = require.resolve(relativePath);
  const original = Module._load;
  delete require.cache[filename];
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === filename && Object.hasOwn(mocks, request)) return mocks[request];
    return original.call(this, request, parent, isMain);
  };
  try { return require(filename); } finally { Module._load = original; }
}

function response(status = 200) {
  const res = new EventEmitter();
  res.statusCode = status;
  res.headers = {};
  res.set = (key, value) => { res.headers[key] = value; return res; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; res.emit("finish"); return res; };
  return res;
}

test("authentication rate limit blocks repeated failures and resets after its window", () => {
  let clock = 1000;
  const limiter = createRateLimit({ limit: 2, windowMs: 1000, now: () => clock });
  let admitted = 0;
  for (let i = 0; i < 2; i++) limiter({ ip: "192.0.2.1" }, response(), () => admitted++);
  const blocked = response();
  limiter({ ip: "192.0.2.1" }, blocked, () => admitted++);
  assert.equal(admitted, 2);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.headers["Retry-After"], "1");
  clock += 1001;
  limiter({ ip: "192.0.2.1" }, response(), () => admitted++);
  assert.equal(admitted, 3);
});

test("successful logins do not exhaust failed-attempt budgets and bounded storage fails closed", () => {
  const limiter = createRateLimit({ limit: 1, windowMs: 1000, skipSuccessful: true, maxEntries: 2, now: () => 1000 });
  for (let i = 0; i < 3; i++) {
    const res = response();
    let admitted = false;
    limiter({ ip: "192.0.2.1" }, res, () => { admitted = true; res.emit("finish"); });
    assert.equal(admitted, true);
  }
  limiter({ ip: "192.0.2.2" }, response(), () => {});
  const saturated = response();
  limiter({ ip: "192.0.2.3" }, saturated, () => assert.fail("must not evict live limits"));
  assert.equal(saturated.statusCode, 429);
});

test("client addresses ignore forwarded headers and group equivalent IPv6 networks", () => {
  assert.equal(clientAddress({ ip: "192.0.2.1", headers: { "x-forwarded-for": "198.51.100.10" } }), "192.0.2.1");
  assert.equal(clientAddress({ ip: "2001:db8:abcd:12::1" }), clientAddress({ ip: "2001:0db8:abcd:0012::ffff" }));
  assert.notEqual(clientAddress({ ip: "2001:db8:abcd:12::1" }), clientAddress({ ip: "2001:db8:abcd:13::1" }));
  assert.equal(clientAddress({ ip: "::ffff:192.0.2.10" }), "192.0.2.10");
  assert.equal(clientAddress({ ip: "::ffff:c000:020a" }), "192.0.2.10");
});

test("trusted proxies default off and accept only explicit internal IPs or subnets", () => {
  assert.equal(trustedProxyAddresses(undefined), false);
  assert.deepEqual(trustedProxyAddresses("172.30.0.2/32,127.0.0.1,::1"), ["172.30.0.2/32", "127.0.0.1", "::1"]);
  for (const unsafe of ["true", "1", "loopback", "0.0.0.0/0", "8.8.8.8", "10.1.1.1/0", "192.168.1.1/8", "::/0", "2001:db8::/32", "127.0.0.1,"]) {
    assert.throws(() => trustedProxyAddresses(unsafe), /proxy|proxies|TRUSTED_PROXY/);
  }
});

test("actual Express requests cannot evade a default IP budget by spoofing forwarded headers", async () => {
  const express = require("express");
  const app = express();
  app.set("trust proxy", trustedProxyAddresses(undefined));
  app.get("/login", createRateLimit({ limit: 2, windowMs: 1000 }), (_req, res) => res.status(400).json({ error: "Invalid credential" }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const statuses = [];
    for (let i = 0; i < 3; i++) {
      const result = await fetch(`http://127.0.0.1:${server.address().port}/login`, { headers: { "x-forwarded-for": `198.51.100.${i + 1}` } });
      statuses.push(result.status);
      await result.text();
    }
    assert.deepEqual(statuses, [400, 400, 429]);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

function productionConfig() {
  return {
    NODE_ENV: "production", UI_URL: "https://school.example", API_URL: "https://school.example", COOKIE_SECURE: "true",
    JWT_ACCESS_TOKEN_SECRET: randomBytes(32).toString("hex"), JWT_REFRESH_TOKEN_SECRET: randomBytes(32).toString("hex"),
    CSRF_TOKEN_SECRET: randomBytes(32).toString("hex"), EMAIL_VERIFICATION_TOKEN_SECRET: randomBytes(32).toString("hex"),
    PASSWORD_SETUP_TOKEN_SECRET: randomBytes(32).toString("hex"),
    JWT_ACCESS_TOKEN_TIME_IN_MS: "900000", JWT_REFRESH_TOKEN_TIME_IN_MS: "28800000", CSRF_TOKEN_TIME_IN_MS: "950000",
    EMAIL_VERIFICATION_TOKEN_TIME_IN_MS: "18000000", PASSWORD_SETUP_TOKEN_TIME_IN_MS: "300000",
  };
}

test("production enforces HTTPS, host-only secure cookies, independent secrets and finite lifetimes", () => {
  const config = productionConfig();
  assert.doesNotThrow(() => assertProductionConfig(config));
  for (const change of [{ UI_URL: "http://school.example" }, { API_URL: "https://secret@school.example" },
    { COOKIE_DOMAIN: ".example" }, { COOKIE_SECURE: "false" }, { COOKIE_SECURE: "banana" },
    { JWT_ACCESS_TOKEN_SECRET: "0".repeat(64) }, { JWT_ACCESS_TOKEN_SECRET: config.JWT_REFRESH_TOKEN_SECRET },
    { CSRF_TOKEN_TIME_IN_MS: "1" }, { JWT_REFRESH_TOKEN_TIME_IN_MS: "Infinity" }]) {
    assert.throws(() => assertProductionConfig({ ...config, ...change }));
  }
  assert.doesNotThrow(() => assertProductionConfig({ NODE_ENV: "development", COOKIE_SECURE: "false" }));
});

test("production cookie flags are secure, host-only and consistent when clearing", () => {
  const cookie = loadWithMocks("../src/cookie", { "./config": { env: { ...productionConfig(), COOKIE_DOMAIN: "" } } });
  const values = [];
  const cleared = [];
  const res = { cookie: (name, value, options) => values.push({ name, value, options }), clearCookie: (name, options) => cleared.push({ name, options }) };
  cookie.setAllCookies(res, "access", "refresh", "csrf");
  cookie.clearAllCookies(res);
  for (const { name, options } of values) {
    assert.equal(options.secure, true);
    assert.equal(options.domain, undefined);
    assert.equal(options.path, "/");
    assert.equal(options.sameSite, "lax");
    assert.equal(options.httpOnly, name !== "csrfToken");
    assert.equal(cleared.find((item) => item.name === name).options.secure, true);
  }
});

test("production login rejects default credentials before opening a database connection", async () => {
  const { ApiError } = require("../src/utils/api-error");
  const { login } = loadWithMocks("../src/modules/auth/auth-service", {
    "../../config": { env: { NODE_ENV: "production" }, db: { connect: async () => assert.fail("default credentials must be blocked") } },
    "../../utils": { ApiError }, "./auth-repository": {}, "../../shared/repository": {},
  });
  await assert.rejects(login(DEMO_ADMIN_EMAIL.toUpperCase(), "different-password"), { statusCode: 400 });
  await assert.rejects(login("private-admin@example.test", DEMO_ADMIN_PASSWORD), { statusCode: 400 });
});

function bootstrapFixture({ targetRole, failRetire = false } = {}) {
  const password = "Generated-admin-secret-93!";
  const environment = { NODE_ENV: "production", BOOTSTRAP_ADMIN_EMAIL: "Owner@example.test", BOOTSTRAP_ADMIN_PASSWORD: password, BOOTSTRAP_ADMIN_NAME: "Owner" };
  const state = { users: [{ id: 1, role_id: 1, email: DEMO_ADMIN_EMAIL, password: DEMO_ADMIN_HASH, is_active: true, is_email_verified: true }], sessions: [1], hashes: 0, writes: 0 };
  if (targetRole) state.users.push({ id: 2, role_id: targetRole, email: "owner@example.test", password: "oldhash", is_active: true, is_email_verified: true });
  let snapshot;
  const client = {
    async query(sql, params = []) {
      if (sql === "BEGIN") { snapshot = structuredClone(state); return { rows: [] }; }
      if (sql === "ROLLBACK") { Object.assign(state, snapshot); return { rows: [] }; }
      if (sql.includes("FROM roles")) return { rows: [{ id: 1 }] };
      if (sql.startsWith("SELECT id, role_id")) return { rows: state.users.filter((user) => user.email.toLowerCase() === params[0]).map((user) => ({ ...user })) };
      if (sql.startsWith("INSERT INTO users")) {
        const id = state.users.length + 1;
        state.users.push({ id, role_id: 1, name: params[0], email: params[1], password: params[2], is_active: true, is_email_verified: true });
        state.writes++; return { rows: [{ id }] };
      }
      if (sql.startsWith("UPDATE users SET name")) {
        Object.assign(state.users.find((user) => user.id === params[3]), { name: params[0], email: params[1], password: params[2], is_active: true, is_email_verified: true });
        state.writes++; return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE users SET is_active")) {
        if (failRetire) throw new Error("injected transaction failure");
        const rows = state.users.filter((user) => user.id !== params[0] && (user.email.toLowerCase() === params[1] || user.password === params[2]) && (user.is_active || user.password !== null));
        for (const row of rows) { row.is_active = false; row.password = null; }
        return { rows: rows.map((row) => ({ id: row.id })) };
      }
      if (sql.startsWith("DELETE FROM user_refresh_tokens")) {
        const before = state.sessions.length;
        state.sessions = state.sessions.filter((id) => !params[0].includes(id)
          && !state.users.some((user) => user.id === id && user.email.toLowerCase() === params[1] && user.id !== params[2]));
        return { rowCount: before - state.sessions.length };
      }
      return { rows: [] };
    },
    release() {},
  };
  const options = { db: { connect: async () => client }, environment,
    hash: async (value) => { state.hashes++; return `hashed:${value}`; }, verify: async (hashed, value) => hashed === `hashed:${value}` };
  return { options, state, password };
}

test("bootstrap creates a private administrator, retires default credentials and is idempotent", async () => {
  const { options, state, password } = bootstrapFixture();
  const first = await bootstrapAdmin(options);
  assert.equal(first.created, true);
  assert.equal(first.retiredDefaultAccounts, 1);
  assert.equal(state.users[0].is_active, false);
  assert.equal(state.users[0].password, null);
  assert.deepEqual(state.sessions, []);
  const second = await bootstrapAdmin(options);
  assert.equal(second.adminId, first.adminId);
  assert.equal(second.created, false);
  assert.equal(second.updated, false);
  assert.equal(state.hashes, 1);
  assert.equal(state.writes, 1);
  assert.equal(JSON.stringify(first).includes(password), false);
});

test("bootstrap changes revoke old sessions, refuses privilege escalation and rolls back failures", async () => {
  const fixture = bootstrapFixture();
  await bootstrapAdmin(fixture.options);
  fixture.state.sessions.push(2);
  fixture.options.environment.BOOTSTRAP_ADMIN_PASSWORD = "Rotated-admin-secret-84!";
  assert.equal((await bootstrapAdmin(fixture.options)).updated, true);
  assert.deepEqual(fixture.state.sessions, []);
  const student = bootstrapFixture({ targetRole: 3 });
  await assert.rejects(bootstrapAdmin(student.options), /Refusing to promote/);
  assert.equal(student.state.users[0].is_active, true);
  const failing = bootstrapFixture({ failRetire: true });
  await assert.rejects(bootstrapAdmin(failing.options), /injected transaction failure/);
  assert.equal(failing.state.users.length, 1);
  assert.equal(failing.state.users[0].is_active, true);
});

test("bootstrap rejects missing or placeholder credentials and preserves development compatibility", () => {
  const { options } = bootstrapFixture();
  for (const change of [{ BOOTSTRAP_ADMIN_PASSWORD: "" }, { BOOTSTRAP_ADMIN_PASSWORD: "x".repeat(24) },
    { BOOTSTRAP_ADMIN_PASSWORD: "replace-with-new-secret-123!" }, { BOOTSTRAP_ADMIN_EMAIL: DEMO_ADMIN_EMAIL }]) {
    assert.throws(() => readAdminInput({ ...options.environment, ...change }));
  }
  assert.doesNotThrow(() => readAdminInput({ ...options.environment, NODE_ENV: "development", BOOTSTRAP_ADMIN_EMAIL: DEMO_ADMIN_EMAIL }));
});

test("production startup refuses default administrators; development keeps its local demo account", async () => {
  let queries = 0;
  const db = { async query() { queries++; return { rows: [{ id: 1, email: DEMO_ADMIN_EMAIL, password: DEMO_ADMIN_HASH }] }; } };
  await assert.rejects(assertSafeProductionAdmin(db, { NODE_ENV: "production" }, async () => true), /Default demonstration/);
  await assertSafeProductionAdmin(db, { NODE_ENV: "development" });
  assert.equal(queries, 1);
  await assert.rejects(assertSafeProductionAdmin({ query: async () => ({ rows: [] }) }, { NODE_ENV: "production" }), /No active production administrator/);
  await assertSafeProductionAdmin({ query: async () => ({ rows: [{ id: 2, email: "owner@example.test", password: "privatehash" }] }) }, { NODE_ENV: "production" }, async () => false);
});
