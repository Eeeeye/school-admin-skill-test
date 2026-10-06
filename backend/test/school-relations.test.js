const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
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

function studentsFixture({ existing = { id: 3, name: "Student", email: "student@example.test", class: "Grade 1", section: "A" }, sectionList = "A,B", missingStudent = false } = {}) {
  const writes = [];
  const statements = [];
  let releases = 0;
  const client = {
    async query(query, params) {
      statements.push(query);
      if (query.includes("SELECT id FROM users")) return { rowCount: missingStudent ? 0 : 1 };
      if (query.includes('p.class_name AS "class"')) return { rows: [existing] };
      if (query.startsWith("SELECT sections FROM classes")) return { rows: params[0] === "Missing" ? [] : [{ sections: sectionList }] };
      if (query.startsWith("SELECT id, name FROM sections")) return { rows: params[0] === "A" ? [{ id: 7, name: "A" }] : params[0] === "B" ? [{ id: 8, name: "B" }] : [{ id: 9, name: "C" }] };
      if (query.includes("student_add_update")) { writes.push(params[0]); return { rows: [{ status: true, userId: 3, message: "Success" }] }; }
      return { rows: [] };
    },
    release() { releases++; },
  };
  const repository = loadWithMocks("../src/modules/students/students-repository", {
    "../../config": { db: { connect: async () => client } }, "../../utils": { processDBRequest: async () => ({ rows: [] }) },
  });
  return { repository, writes, statements, get releases() { return releases; } };
}

test("student create accepts class sections represented by names or legacy IDs", async () => {
  for (const sectionList of ["A,B", "7,8", " A , B "]) {
    const fixture = studentsFixture({ sectionList });
    assert.equal((await fixture.repository.addOrUpdateStudent({ class: "Grade 1", section: "A" })).status, true);
    assert.equal(fixture.writes.length, 1);
    assert.ok(fixture.statements.includes("COMMIT"));
    assert.equal(fixture.releases, 1);
  }
});

test("student create rejects a valid section that belongs to another class and sections without classes", async () => {
  for (const payload of [{ class: "Grade 1", section: "C" }, { section: "A" }, { class: null, section: "A" }, { class: "Missing" }]) {
    const fixture = studentsFixture();
    const result = await fixture.repository.addOrUpdateStudent(payload);
    assert.equal(result.status, false);
    assert.equal(result.message, "Invalid class or section");
    assert.equal(fixture.writes.length, 0);
    assert.ok(fixture.statements.includes("ROLLBACK"));
    assert.equal(fixture.releases, 1);
  }
});

test("student partial update retains omitted placement fields and validates the merged pair", async () => {
  const fixture = studentsFixture();
  assert.equal((await fixture.repository.updateStudentById(3, { name: "New name" })).status, true);
  assert.equal(fixture.writes[0].class, "Grade 1");
  assert.equal(fixture.writes[0].section, "A");
  const invalid = studentsFixture({ sectionList: "B" });
  assert.equal((await invalid.repository.updateStudentById(3, { class: "Grade 2" })).status, false);
  assert.equal(invalid.writes.length, 0);
});

test("clearing a student's class clears an omitted section; explicit sections without a class are rejected", async () => {
  const fixture = studentsFixture();
  assert.equal((await fixture.repository.updateStudentById(3, { class: null })).status, true);
  assert.equal(fixture.writes[0].class, null);
  assert.equal(fixture.writes[0].section, null);
  const invalid = studentsFixture();
  assert.equal((await invalid.repository.updateStudentById(3, { class: null, section: "A" })).status, false);
  const clearedSection = studentsFixture();
  assert.equal((await clearedSection.repository.updateStudentById(3, { section: null })).status, true);
  assert.equal(clearedSection.writes[0].class, "Grade 1");
  assert.equal(clearedSection.writes[0].section, null);
});

test("missing or non-student update cannot fall through to student creation", async () => {
  const fixture = studentsFixture({ missingStudent: true });
  assert.deepEqual(await fixture.repository.updateStudentById(3, { class: "Grade 1" }), { status: false, message: "Student not found" });
  assert.equal(fixture.writes.length, 0);
});

test("notice audience uses fixed department/class queries and never runs legacy SQL configuration", async () => {
  const queries = [];
  const db = { async query(query, params) {
    queries.push(query);
    if (query === "SELECT * FROM notice_recipient_types") return { rows: [
      { id: 1, role_id: 2, primary_dependent_select: "DROP TABLE users" },
      { id: 2, role_id: 3, primary_dependent_select: "SELECT password FROM users" },
      { id: 3, role_id: 4, primary_dependent_select: "SELECT private FROM secrets" },
    ] };
    if (query.startsWith("SELECT name FROM roles")) return { rows: [{ name: `Role ${params[0]}` }] };
    if (query.includes("FROM departments")) return { rows: [{ id: "2", name: "Science" }] };
    if (query.includes("FROM classes")) return { rows: [{ id: "Grade 1", name: "Grade 1" }] };
    throw new Error(`Unexpected query ${query}`);
  } };
  const repository = loadWithMocks("../src/modules/notices/notices-repository", {
    "../../config": { db }, "../../utils": { processDBRequest: async () => ({ rows: [] }) },
  });
  const recipients = await repository.getNoticeRecipientList();
  assert.equal(recipients[0].primaryDependents.name, "Department");
  assert.equal(recipients[1].primaryDependents.list[0].id, "Grade 1");
  assert.deepEqual(recipients[2].primaryDependents.list, []);
  assert.equal(queries.some((query) => /DROP|password|private/.test(query)), false);
});

test("notice recipient writes reject SQL and fix the label and type for each role", async () => {
  const writes = [];
  const service = loadWithMocks("../src/modules/notices/notices-service", {
    "../../utils": { ApiError },
    "./notices-repository": { addNoticeRecipient: async (payload) => { writes.push(payload); return 1; }, updateNoticeRecipient: async (payload) => { writes.push(payload); return 1; } },
  });
  await assert.rejects(service.processAddNoticeRecipient({ roleId: 3, primaryDependentSelect: "SELECT * FROM classes" }), { statusCode: 400 });
  await assert.rejects(service.processUpdateNoticeRecipient({ id: 2, roleId: 3, primaryDependentSelect: "departments" }), { statusCode: 400 });
  await service.processAddNoticeRecipient({ roleId: 3, primaryDependentName: "Unsafe label", primaryDependentSelect: "classes" });
  assert.equal(writes[0].primaryDependentName, "Class");
  assert.equal(writes[0].primaryDependentSelect, "classes");
});

test("specific notices reject unknown classes or departments before persistence", async () => {
  let writes = 0;
  const service = loadWithMocks("../src/modules/notices/notices-service", {
    "../../utils": { ApiError },
    "./notices-repository": { isNoticeRecipientValid: async () => false, addNewNotice: async () => { writes++; return 1; } },
  });
  const input = { title: "Announcement", description: "A test notice", status: 2, recipientType: "SP", currentUserRole: "admin" };
  await assert.rejects(service.addNotice({ ...input, recipientRole: 3, firstField: "Unknown class" }), { statusCode: 400 });
  await assert.rejects(service.addNotice({ ...input, recipientRole: 2, firstField: "999" }), { statusCode: 400 });
  assert.equal(writes, 0);
});
