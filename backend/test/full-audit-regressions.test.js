const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const jwt = require("jsonwebtoken");
const { ApiError } = require("../src/utils/api-error");

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

test("new login tokens are unique even with identical credentials and timestamp", () => {
  const { generateToken } = require("../src/utils/jwt-handle");
  const payload = { id: 9, roleId: 2, iat: 1800000000 };
  const first = generateToken(payload, "test-secret", "1h");
  const second = generateToken(payload, "test-secret", "1h");
  assert.notEqual(first, second);
  assert.notEqual(jwt.decode(first).jti, jwt.decode(second).jti);
  assert.equal(jwt.decode(first).iat, jwt.decode(second).iat);
});

test("logins lock the account row before password verification and session replacement", async () => {
  let statement;
  const repository = loadWithMocks("../src/modules/auth/auth-repository", {
    "../../config": { db: {} }, "../../utils": {},
  });
  await repository.findUserByUsername("example@test.invalid", { query: async (sql) => { statement = sql; return { rows: [] }; } });
  assert.match(statement, /FOR UPDATE/);
});

test("delegated staff editors cannot mint accounts or disable an administrator", async () => {
  let writes = 0;
  const service = loadWithMocks("../src/modules/staffs/staffs-service", {
    "../../utils": { ApiError },
    "./staffs-repository": {
      getStaffDetailById: async () => ({ role: 1 }),
      reviewStaffStatus: async () => { writes++; return 1; },
      addOrUpdateStaff: async () => { writes++; return { status: true }; },
    },
  });
  const actor = { id: 5, roleId: 2 };
  await assert.rejects(service.processAddStaff({ name: "Attack", email: "x@example.test", role: 1 }, actor), { statusCode: 403 });
  await assert.rejects(service.processReviewStaffStatus({ userId: 1, reviewerId: 5, status: false }, actor), { statusCode: 403 });
  assert.equal(writes, 0);
});

function staffTransaction(current = { id: 9, role: 2, name: "Teacher", email: "teacher@example.test", systemAccess: true }) {
  const statements = [];
  const client = {
    query: async (sql, params) => {
      statements.push({ sql, params });
      if (sql.includes("FOR UPDATE")) return { rows: [{ id: 9 }] };
      if (sql.includes('t1.role_id AS role')) return { rows: [current] };
      if (sql.includes("AS role_valid")) return { rows: [{ role_valid: true, department_valid: true, reporter_valid: true, assignment_valid: true }] };
      if (sql.includes("staff_add_update")) return { rows: [{ status: true }] };
      return { rows: [] };
    },
    release() {},
  };
  const repository = loadWithMocks("../src/modules/staffs/staffs-repository", {
    "../../config": { db: { connect: async () => client } }, "../../utils": { ApiError },
  });
  return { repository, statements };
}

test("staff role and administrator edit guards run inside the transaction after locking", async () => {
  for (const [current, change, actor, code] of [
    [undefined, { role: 1 }, { id: 9, roleId: 2 }, 403],
    [undefined, { email: "attacker@example.test" }, { id: 5, roleId: 2 }, 403],
    [{ id: 9, role: 1, email: "admin@example.test", systemAccess: true }, { email: "attacker@example.test" }, { id: 7, roleId: 2 }, 403],
    [undefined, { systemAccess: false }, { id: 9, roleId: 1 }, 400],
    [undefined, { role: 4 }, { id: 9, roleId: 1 }, 400],
  ]) {
    const fixture = staffTransaction(current);
    await assert.rejects(fixture.repository.updateStaffById(9, change, actor), { statusCode: code });
    assert.equal(fixture.statements.some(({ sql }) => sql.includes("staff_add_update")), false);
    assert.equal(fixture.statements.at(-1).sql, "ROLLBACK");
  }
});

test("staff credential, role and disable changes revoke sessions before committing", async () => {
  for (const change of [{ role: 4 }, { email: "new@example.test" }, { systemAccess: false }]) {
    const fixture = staffTransaction();
    await fixture.repository.updateStaffById(9, change, { id: 1, roleId: 1 });
    assert.match(fixture.statements.at(-2).sql, /DELETE FROM user_refresh_tokens/);
    assert.equal(fixture.statements.at(-1).sql, "COMMIT");
  }
});

test("account and role disable waits for login locks, then revokes sessions with a fresh transaction snapshot", async () => {
  for (const [path, method, payload] of [
    ["../src/modules/students/students-repository", "findStudentToSetStatus", { userId: 9, reviewerId: 1, status: false }],
    ["../src/modules/staffs/staffs-repository", "reviewStaffStatus", { userId: 9, reviewerId: 1, actorRoleId: 1, status: false }],
    ["../src/modules/roles-and-permissions/rp-repository", "enableOrDisableRoleStatusByRoleId", 4],
  ]) {
    const statements = [];
    const client = { query: async (sql) => { statements.push(sql); return { rowCount: 1, rows: [] }; }, release() {} };
    const repository = loadWithMocks(path, {
      "../../config": { db: { connect: async () => client } }, "../../utils": { ApiError },
    });
    assert.equal(await repository[method](payload, false), 1);
    const lock = statements.findIndex((sql) => /FOR UPDATE/.test(sql));
    const academicLock = statements.findIndex((sql) => /pg_advisory_xact_lock\(7183001\)/.test(sql));
    const revoke = statements.findIndex((sql) => /DELETE FROM user_refresh_tokens/.test(sql));
    assert.ok(academicLock >= 0 && academicLock < lock);
    assert.ok(lock >= 0 && revoke > lock);
    assert.equal(statements.at(-1), "COMMIT");
    assert.equal(statements.some((sql) => /WITH changed AS/.test(sql)), false);
  }
});

function academicFixture({ classes = [{ id: 1, sections: "A,B" }], section = { id: 7, name: "A" }, extraSections = [], assigned = [], fail = false } = {}) {
  const statements = [];
  const client = {
    async query(sql, params) {
      statements.push({ sql, params });
      if (sql === "SELECT id, sections FROM classes ORDER BY id FOR UPDATE") return { rows: classes };
      if (sql === "SELECT id, name FROM sections ORDER BY id FOR UPDATE") return { rows: [...(section ? [section] : []), { id: 8, name: "B" }, ...extraSections] };
      if (sql === "SELECT id, name FROM sections ORDER BY id FOR SHARE") return { rows: [{ id: 7, name: "A" }, { id: 8, name: "B" }] };
      if (sql === "SELECT name FROM classes WHERE id=$1 FOR UPDATE") return { rows: [{ name: "Grade 1" }] };
      if (sql.includes("UNION SELECT section_name")) return { rows: assigned };
      if (fail && sql.startsWith("UPDATE sections")) throw Object.assign(new Error("duplicate"), { code: "23505" });
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const helper = loadWithMocks("../src/utils/academic-integrity", { "../config": { db: { connect: async () => client } } });
  const mocks = { "../../utils": {}, "../../utils/academic-integrity": helper };
  const sections = loadWithMocks("../src/modules/sections/section-repository", mocks);
  const classesRepository = loadWithMocks("../src/modules/classes/classes-repository", mocks);
  return { sections, classes: classesRepository, helper, statements };
}

test("renaming a section updates class membership represented by names and legacy IDs", async () => {
  const fixture = academicFixture({ classes: [{ id: 1, sections: "A,B" }, { id: 2, sections: "7,8" }] });
  assert.equal(await fixture.sections.updateSectionById({ id: 7, name: "Alpha" }), 1);
  const updates = fixture.statements.filter(({ sql }) => sql.startsWith("UPDATE classes"));
  assert.deepEqual(updates.map(({ params }) => params), [["Alpha,B", 1], ["Alpha,8", 2]]);
  assert.equal(fixture.statements.at(-1).sql, "COMMIT");
});

test("section rename conflict rolls back associated class updates", async () => {
  const fixture = academicFixture({ fail: true });
  await assert.rejects(fixture.sections.updateSectionById({ id: 7, name: "B" }), { statusCode: 409 });
  assert.equal(fixture.statements.at(-1).sql, "ROLLBACK");
});

test("numeric section names take precedence over colliding legacy IDs during rename and delete", async () => {
  const fixture = academicFixture({ classes: [{ id: 1, sections: "A,7" }], extraSections: [{ id: 9, name: "7" }] });
  await fixture.sections.updateSectionById({ id: 7, name: "Alpha" });
  assert.deepEqual(fixture.statements.find(({ sql }) => sql.startsWith("UPDATE classes")).params, ["Alpha,7", 1]);
  const deleted = academicFixture({ classes: [{ id: 1, sections: "A,7" }], extraSections: [{ id: 9, name: "7" }] });
  await deleted.sections.deleteSectionById(7);
  assert.deepEqual(deleted.statements.find(({ sql }) => sql.startsWith("UPDATE classes")).params, ["7", 1]);
});

test("introducing a numeric section name preserves existing legacy ID membership", async () => {
  const renamed = academicFixture({ classes: [{ id: 1, sections: "7,8" }] });
  await renamed.sections.updateSectionById({ id: 8, name: "7" });
  assert.deepEqual(renamed.statements.find(({ sql }) => sql.startsWith("UPDATE classes")).params, ["A,7", 1]);

  const created = academicFixture({ classes: [{ id: 1, sections: "7,8" }] });
  await created.sections.addNewSection("7");
  assert.deepEqual(created.statements.find(({ sql }) => sql.startsWith("UPDATE classes")).params, ["A,B", 1]);
  assert.ok(created.statements.findIndex(({ sql }) => sql.startsWith("UPDATE classes"))
    < created.statements.findIndex(({ sql }) => sql.startsWith("INSERT INTO sections")));
});

test("section deletion removes membership and orphan teacher assignments", async () => {
  const fixture = academicFixture();
  await fixture.sections.deleteSectionById(7);
  assert.deepEqual(fixture.statements.find(({ sql }) => sql.startsWith("UPDATE classes")).params, ["B", 1]);
  assert.ok(fixture.statements.some(({ sql }) => sql === "DELETE FROM class_teachers WHERE section_name=$1"));
  assert.ok(fixture.statements.some(({ sql }) => sql.startsWith("UPDATE users SET reporter_id")));
});

test("class edits validate membership and cannot remove sections with assigned students or teachers", async () => {
  const fixture = academicFixture({ assigned: [{ section_name: "A" }] });
  await assert.rejects(fixture.classes.updateClassDetailById({ id: 1, name: "Grade 1", sections: "B" }), { statusCode: 409 });
  assert.equal(fixture.statements.some(({ sql }) => sql.startsWith("UPDATE classes")), false);
  await assert.rejects(fixture.classes.addNewClass({ name: "New", sections: "Unknown" }), { statusCode: 400 });
  await fixture.classes.addNewClass({ name: "New", sections: "7,8" });
  assert.deepEqual(fixture.statements.find(({ sql }) => sql.startsWith("INSERT INTO classes")).params, ["New", "A,B"]);
});

test("class rename updates its notice audience; deletion clears student sections as well", async () => {
  const fixture = academicFixture();
  await fixture.classes.updateClassDetailById({ id: 1, name: "Grade 2", sections: "A,B" });
  assert.deepEqual(fixture.statements.find(({ sql }) => sql.startsWith("UPDATE notices")).params, ["Grade 2", "Grade 1"]);
  await fixture.classes.deleteClassById(1);
  assert.ok(fixture.statements.some(({ sql }) => sql === "UPDATE user_profiles SET section_name=NULL WHERE class_name=$1"));
  assert.ok(fixture.statements.some(({ sql }) => sql === "DELETE FROM class_teachers WHERE class_name=$1"));
});

test("invalid academic IDs, empty names, comma names and malformed section lists are rejected", () => {
  const { helper } = academicFixture();
  for (const id of [null, true, [1], "1e2", -1, 2147483648]) assert.throws(() => helper.academicId(id), { statusCode: 400 });
  for (const name of [null, "", "  ", "A,B", "x".repeat(51)]) assert.throws(() => helper.academicName(name, "Section"), { statusCode: 400 });
  for (const sections of [[], null, {}, "x".repeat(51)]) assert.throws(() => helper.sectionTokens(sections), { statusCode: 400 });
});

test("malformed and oversized JSON bodies return a useful 400 or 413 response", () => {
  const { handleGlobalError } = loadWithMocks("../src/middlewares/handle-global-error", { "../utils": { ApiError } });
  for (const [type, expected] of [["entity.parse.failed", 400], ["entity.too.large", 413]]) {
    let status, body;
    const res = { status(value) { status = value; return this; }, json(value) { body = value; } };
    handleGlobalError({ type, body: "private input" }, {}, res);
    assert.equal(status, expected);
    assert.equal(JSON.stringify(body).includes("private input"), false);
  }
});
