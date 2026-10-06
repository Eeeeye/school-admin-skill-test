const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const jwt = require("jsonwebtoken");

process.env.PASSWORD_SETUP_TOKEN_SECRET = "local-test-only-password-secret";
const { ApiError } = require("../src/utils/api-error");
const { passwordTokenFingerprint, matchesPasswordToken } = require("../src/utils/password-token");
const testEnv = {
  JWT_ACCESS_TOKEN_SECRET: "test-access-secret",
  JWT_REFRESH_TOKEN_SECRET: "test-refresh-secret",
  PASSWORD_SETUP_TOKEN_SECRET: process.env.PASSWORD_SETUP_TOKEN_SECRET,
  PASSWORD_SETUP_TOKEN_TIME_IN_MS: "300000",
  JWT_ACCESS_TOKEN_TIME_IN_MS: "900000",
  JWT_REFRESH_TOKEN_TIME_IN_MS: "28800000",
  UI_URL: "http://localhost.invalid",
};

// Dependencies are replaced only while the target module is loaded. These
// tests never open a database socket or contact an email provider.
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

function tokenPair(access = {}, refresh = {}) {
  return {
    accessToken: jwt.sign({ id: 7, roleId: 2, role: "teacher", ...access }, testEnv.JWT_ACCESS_TOKEN_SECRET, { expiresIn: "15m" }),
    refreshToken: jwt.sign({ id: 7, roleId: 2, ...refresh }, testEnv.JWT_REFRESH_TOKEN_SECRET, { expiresIn: "8h" }),
  };
}

function invokeMiddleware(middleware, req) {
  return new Promise((resolve, reject) => {
    try {
      const result = middleware(req, {}, (error) => resolve(error || null));
      Promise.resolve(result).catch(reject);
    } catch (error) { resolve(error); }
  });
}

test("authentication checks persisted session, account and current role", async (t) => {
  const validSession = { id: 7, role_id: 2, role: "teacher", is_active: true, role_active: true };
  for (const [name, session, access, refresh, expected] of [
    ["valid current session", validSession, {}, {}, null],
    ["logged out or expired persisted session", null, {}, {}, 401],
    ["disabled account", { ...validSession, is_active: false }, {}, {}, 401],
    ["disabled role", { ...validSession, role_active: false }, {}, {}, 401],
    ["old administrator token after demotion", validSession, { roleId: 1 }, {}, 401],
    ["access and refresh belong to different users", validSession, {}, { id: 8 }, 401],
    ["invalid token user id", validSession, { id: "7" }, { id: "7" }, 401],
  ]) {
    await t.test(name, async () => {
      const cookies = tokenPair(access, refresh);
      const queries = [];
      const { authenticateToken } = loadWithMocks("../src/middlewares/authenticate-token", {
        "../config": { env: testEnv, db: { query: async (sql, params) => {
          queries.push({ sql, params }); return { rows: session ? [session] : [] };
        } } },
      });
      const req = { cookies };
      const error = await invokeMiddleware(authenticateToken, req);
      assert.equal(error?.statusCode ?? null, expected);
      if (expected === null) {
        assert.equal(req.user.roleId, 2);
        assert.equal(req.user.role, "teacher");
        assert.deepEqual(queries[0].params, [cookies.refreshToken, 7]);
        assert.match(queries[0].sql, /rt\.expires_at > NOW\(\)/);
      }
    });
  }
});

test("authentication rejects malformed JWTs before querying database", async () => {
  let queries = 0;
  const { authenticateToken } = loadWithMocks("../src/middlewares/authenticate-token", {
    "../config": { env: testEnv, db: { query: async () => { queries++; return { rows: [] }; } } },
  });
  const error = await invokeMiddleware(authenticateToken, { cookies: { accessToken: "bad", refreshToken: "bad" } });
  assert.equal(error.statusCode, 401);
  assert.equal(queries, 0);
});

test("authentication reports a database outage as unavailable", async () => {
  const cookies = tokenPair();
  const { authenticateToken } = loadWithMocks("../src/middlewares/authenticate-token", {
    "../config": { env: testEnv, db: { query: async () => { throw new Error("database offline"); } } },
  });
  const error = await invokeMiddleware(authenticateToken, { cookies });
  assert.equal(error.statusCode, 503);
});

test("password fingerprints bind user, email, password state and purpose", () => {
  const user = { id: 7, email: "student@example.test", password: "old-salted-hash" };
  const fingerprint = passwordTokenFingerprint(user, "reset");
  assert.equal(matchesPasswordToken(user, "reset", fingerprint), true);
  assert.equal(matchesPasswordToken({ ...user, password: "new-salted-hash" }, "reset", fingerprint), false);
  assert.equal(matchesPasswordToken({ ...user, email: "other@example.test" }, "reset", fingerprint), false);
  assert.equal(matchesPasswordToken({ ...user, id: 8 }, "reset", fingerprint), false);
  assert.equal(matchesPasswordToken(user, "setup", fingerprint), false);
  for (const value of [null, "", "x".repeat(64), {}, []]) assert.equal(matchesPasswordToken(user, "reset", value), false);
});

function passwordFixture({ active = true, verified = true, roleActive = true, failRevocation = false } = {}) {
  const state = { user: { id: 7, email: "student@example.test", password: active ? "old-hash" : null,
    is_active: active, is_email_verified: verified, role_active: roleActive, role_id: 2 }, sessions: ["old-session"], events: [] };
  let queue = Promise.resolve();
  let hashes = 0;
  const db = { connect: async () => {
    let unlock;
    let snapshot;
    let locked = false;
    return {
      query: async (sql, params = []) => {
        state.events.push(sql.trim());
        if (sql.includes("FOR UPDATE OF u")) {
          const previous = queue;
          queue = new Promise((resolve) => { unlock = resolve; });
          await previous;
          locked = true;
          snapshot = structuredClone({ user: state.user, sessions: state.sessions });
          return { rows: params[0] === state.user.id ? [{ ...state.user }] : [] };
        }
        if (/UPDATE users/.test(sql)) {
          state.user.password = params[0]; state.user.is_active = true;
          return { rowCount: 1 };
        }
        if (/DELETE FROM user_refresh_tokens/.test(sql)) {
          if (failRevocation) throw new Error("injected session store failure");
          state.sessions = []; return { rowCount: 1 };
        }
        if (sql === "COMMIT" || sql === "ROLLBACK") {
          if (sql === "ROLLBACK" && snapshot) Object.assign(state, snapshot);
          if (locked) { locked = false; unlock(); }
        }
        return { rows: [], rowCount: 0 };
      },
      release: () => { assert.equal(locked, false, "transaction lock must be released"); },
    };
  } };
  const repository = loadWithMocks("../src/modules/auth/auth-repository", {
    "../../config": { db }, "../../utils": { processDBRequest: async () => { throw new Error("Unexpected non-transactional query"); } },
  });
  const { processPasswordSetup } = loadWithMocks("../src/modules/auth/auth-service", {
    "../../utils": { ApiError, generateHashedPassword: async () => `new-random-hash-${++hashes}` },
    "../../config": { db, env: testEnv },
    "./auth-repository": repository,
    "../../shared/repository": {},
  });
  const payload = { userId: 7, userEmail: state.user.email, password: "New-password-123", purpose: active ? "reset" : "setup" };
  payload.fingerprint = passwordTokenFingerprint(state.user, payload.purpose);
  return { state, processPasswordSetup, payload };
}

test("reset consumes credential-bound token and revokes old sessions atomically", async () => {
  const { state, processPasswordSetup, payload } = passwordFixture();
  await processPasswordSetup(payload);
  assert.notEqual(state.user.password, "old-hash");
  assert.deepEqual(state.sessions, []);
  await assert.rejects(processPasswordSetup(payload), { statusCode: 400 });
  assert.equal(state.events.filter((event) => event === "COMMIT").length, 1);
});

test("concurrent use of one reset link permits exactly one password update", async () => {
  const { state, processPasswordSetup, payload } = passwordFixture();
  const results = await Promise.allSettled([processPasswordSetup(payload), processPasswordSetup(payload)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.statusCode, 400);
  assert.equal(state.events.filter((event) => event.includes("UPDATE users")).length, 1);
});

test("setup activates a verified inactive account once", async () => {
  const { state, processPasswordSetup, payload } = passwordFixture({ active: false });
  await processPasswordSetup(payload);
  assert.equal(state.user.is_active, true);
  await assert.rejects(processPasswordSetup(payload), { statusCode: 400 });
});

test("password and sessions roll back together when revocation fails", async () => {
  const { state, processPasswordSetup, payload } = passwordFixture({ failRevocation: true });
  await assert.rejects(processPasswordSetup(payload), /injected session store failure/);
  assert.equal(state.user.password, "old-hash");
  assert.deepEqual(state.sessions, ["old-session"]);
  assert.equal(state.events.includes("COMMIT"), false);
});

test("password setup rejects disabled roles, unverified accounts and wrong purpose", async () => {
  for (const options of [{ verified: false }, { roleActive: false }]) {
    const { state, processPasswordSetup, payload } = passwordFixture(options);
    await assert.rejects(processPasswordSetup(payload), { statusCode: 400 });
    assert.equal(state.user.password, "old-hash");
  }
  const { processPasswordSetup, payload } = passwordFixture();
  await assert.rejects(processPasswordSetup({ ...payload, purpose: "admin" }), { statusCode: 400 });
});

test("password change is role-aware and replaces all refresh sessions", async () => {
  const events = [];
  const client = {
    query: async (sql, params = []) => {
      events.push({ sql: sql.trim(), params });
      if (sql.includes("FOR UPDATE OF u")) {
        return { rows: [{ id: 7, email: "student@example.test", password: "old-hash", role_id: 2,
          is_active: true, role_active: true }] };
      }
      if (sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    },
    release: () => {},
  };
  const db = { connect: async () => client };
  const authRepository = loadWithMocks("../src/modules/auth/auth-repository", {
    "../../config": { db },
    "../../utils": { processDBRequest: async () => ({ rows: [], rowCount: 0 }) },
  });
  const accountRepository = {
    changePassword: async ({ userId, hashedPassword }, tx) => tx.query("UPDATE users SET password = $1 WHERE id = $2", [hashedPassword, userId]),
    getUserRoleNameByUserId: async () => "teacher",
  };
  let inserted;
  const { processPasswordChange } = loadWithMocks("../src/modules/account/account-service", {
    "../../config": { db, env: testEnv },
    "../../utils": {
      ApiError,
      generateHashedPassword: async () => "new-hash",
      generateToken: (payload) => JSON.stringify(payload),
      generateCsrfHmacHash: () => "csrf-hash",
      verifyPassword: async () => {},
    },
    "./account-repository": accountRepository,
    "../auth/auth-repository": authRepository,
    "../../shared/repository": {
      insertRefreshToken: async (payload, tx) => { inserted = payload; await tx.query("INSERT refresh token"); },
      findUserById: async () => null,
    },
  });
  const result = await processPasswordChange({ userId: 7, oldPassword: "old-password", newPassword: "new-password" });
  assert.equal(result.message, "Password changed successfully");
  assert.equal(inserted.userId, 7);
  assert.match(inserted.accessToken ?? result.accessToken, /roleId/);
  assert.equal(events.some(({ sql }) => sql.includes("DELETE FROM user_refresh_tokens")), true);
  assert.equal(events.at(-1).sql, "COMMIT");
});

test("auth user IDs reject boolean, arrays, objects and fractional input", () => {
  const { UserIdSchema, PasswordSetupSchema } = require("../src/modules/auth/auth-schema");
  for (const userId of [true, false, [], [1], {}, "", " ", null, 0, -1, 1.2, "1.2", "1e3", "0x10", 2147483648]) {
    assert.equal(UserIdSchema.safeParse({ body: { userId } }).success, false, String(userId));
  }
  for (const userId of [1, "1", 42, "42"]) assert.equal(UserIdSchema.safeParse({ body: { userId } }).success, true);
  assert.equal(PasswordSetupSchema.safeParse({ body: { token: "t", username: "user@example.test", password: "x" } }).success, false);
});
