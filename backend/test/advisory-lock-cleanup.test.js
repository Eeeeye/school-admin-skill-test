const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

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

test("certificate lock cleanup failure discards the pooled connection, preserving the operation result", async () => {
  for (const operationFails of [false, true]) {
    const unlockError = new Error("injected lock cleanup cancellation");
    const operationError = new Error("injected operation failure");
    let releasedWith;
    const client = {
      async query(sql) {
        if (sql.includes("pg_advisory_unlock")) throw unlockError;
        return { rows: [{ acquired: true }] };
      },
      release(error) { releasedWith = error; },
    };
    const { createRepository } = loadWithMocks("../src/modules/certificates/certificates-repository", {
      "../../config": { db: { connect: async () => client } },
    });
    const outcome = createRepository().withMutationLock(async () => {
      if (operationFails) throw operationError;
      return "issued";
    });
    if (operationFails) await assert.rejects(outcome, (error) => error === operationError);
    else assert.equal(await outcome, "issued");
    assert.equal(releasedWith, unlockError, "pg must destroy the connection instead of pooling its session lock");
  }
});

test("a refused certificate lock returns 409 without unlocking another session", async () => {
  const statements = [];
  let released = false;
  const client = {
    async query(sql) { statements.push(sql); return { rows: [{ acquired: false }] }; },
    release(error) { assert.equal(error, undefined); released = true; },
  };
  const { createRepository } = loadWithMocks("../src/modules/certificates/certificates-repository", {
    "../../config": { db: { connect: async () => client } },
  });
  await assert.rejects(createRepository().withMutationLock(() => { throw new Error("must not run"); }), { statusCode: 409 });
  assert.equal(released, true);
  assert.equal(statements.some((sql) => sql.includes("pg_advisory_unlock")), false);
});

test("migration lock cleanup failure discards the client after a successful migration", async () => {
  const unlockError = new Error("injected migration unlock cancellation");
  const statements = [];
  let releasedWith;
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.includes("pg_advisory_unlock")) throw unlockError;
      return { rows: [], rowCount: 0 };
    },
    release(error) { releasedWith = error; },
  };
  const { migrate } = loadWithMocks("../src/migrate", {
    "node:fs/promises": { readdir: async () => [] },
  });
  await migrate({ connect: async () => client }, "/unused-test-path");
  assert.equal(statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS schema_migrations")), true);
  assert.equal(releasedWith, unlockError);
});
