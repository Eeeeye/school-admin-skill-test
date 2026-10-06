const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { ApiError } = require("../src/utils/api-error");
const { validateStaffPayload, staffId } = require("../src/modules/staffs/staffs-validation");

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

const input = { name: "New Teacher", email: "teacher@example.test", role: 2, departmentId: 1 };

test("staff validation rejects invalid references, calendar dates and injected identity", () => {
  for (const change of [{ role: 3 }, { role: true }, { departmentId: -1 }, { departmentId: [1] },
    { reporterId: 1.5 }, { dob: "2026-02-30" }, { dob: "2026-01-01T00:00:00Z" },
    { email: "invalid" }, { systemAccess: "false" }, { userId: 1 }, { name: "x".repeat(101) }]) {
    assert.throws(() => validateStaffPayload({ ...input, ...change }, { creating: true }), { statusCode: 400 });
  }
  for (const value of [null, true, [], [1], "1e2", "1.0", -1, 2147483648]) {
    assert.throws(() => staffId(value), { statusCode: 400 });
  }
  assert.deepEqual(validateStaffPayload({ ...input, departmentId: null, reporterId: 0, password: "injected" }, { creating: true }),
    { ...input, departmentId: null, reporterId: null, systemAccess: false });
});

function fixture({ exists = true, writeResult, mailFailure = false } = {}) {
  const writes = [];
  const existing = { id: 9, name: "Teacher", email: "old@example.test", role: 2,
    departmentId: 1, departmentName: "Teaching", reporterId: 1, dob: "1990-01-01", systemAccess: true };
  const repository = {
    getStaffDetailById: async () => exists ? existing : undefined,
    validateStaffReferences: async (payload) => { if (payload.departmentId === 999) throw new ApiError(400, "Department does not exist"); },
    addOrUpdateStaff: async (payload) => { writes.push(payload); return writeResult || { status: true, userId: 9, message: "Staff saved" }; },
    updateStaffById: async (id, payload) => {
      if (!exists) throw new ApiError(404, "Staff detail not found");
      await repository.validateStaffReferences(payload);
      writes.push({ ...payload, userId: id });
      return writeResult || { status: true, userId: id, message: "Staff saved" };
    },
    reviewStaffStatus: async () => 1,
    getAllStaffs: async () => [],
  };
  const service = loadWithMocks("../src/modules/staffs/staffs-service", {
    "../../utils": { ApiError, sendAccountVerificationEmail: async () => { if (mailFailure) throw new Error("offline"); } },
    "./staffs-repository": repository,
  });
  return { service, writes, existing };
}

test("partial staff updates forward only requested fields and preserve an explicit department clear", async () => {
  const { service, writes } = fixture();
  await service.processUpdateStaff({ userId: 9, departmentId: 2 });
  assert.equal(writes[0].name, undefined);
  assert.equal(writes[0].email, undefined);
  assert.equal(writes[0].dob, undefined);
  assert.equal(writes[0].departmentId, 2);
  await service.processUpdateStaff({ userId: 9, departmentId: null });
  assert.equal(writes[1].departmentId, null);
});

test("missing staff and nonexistent departments never reach the write query", async () => {
  const missing = fixture({ exists: false });
  await assert.rejects(missing.service.processUpdateStaff({ userId: 9, departmentId: 2 }), { statusCode: 404 });
  assert.equal(missing.writes.length, 0);
  const invalid = fixture();
  await assert.rejects(invalid.service.processAddStaff({ ...input, departmentId: 999 }), { statusCode: 400 });
  assert.equal(invalid.writes.length, 0);
});

test("duplicate staff emails are conflicts and mail failures preserve the created user ID", async () => {
  const duplicate = fixture({ writeResult: { status: false, message: "Email already exists" } });
  await assert.rejects(duplicate.service.processAddStaff(input), { statusCode: 409 });
  const unavailable = fixture({ mailFailure: true });
  const result = await unavailable.service.processAddStaff(input);
  assert.equal(result.userId, 9);
  assert.match(result.message, /failed to send verification email/);
});

test("staff status requires a boolean and cannot disable the current administrator", async () => {
  const { service } = fixture();
  await assert.rejects(service.processReviewStaffStatus({ userId: 9, reviewerId: 1, status: "false" }), { statusCode: 400 });
  await assert.rejects(service.processReviewStaffStatus({ userId: 9, reviewerId: 9, status: false }), { statusCode: 400 });
  assert.deepEqual(await service.processGetAllStaffs({}), []);
});

test("staff repository validates active staff roles, departments and reporting managers", async () => {
  for (const rejectedField of ["role_valid", "department_valid", "reporter_valid", "assignment_valid"]) {
    const repository = loadWithMocks("../src/modules/staffs/staffs-repository", {
      "../../utils": { ApiError, processDBRequest: async () => ({ rows: [{ role_valid: true, department_valid: true, reporter_valid: true, assignment_valid: true, [rejectedField]: false }] }) },
      "../../config": { db: {} },
    });
    await assert.rejects(repository.validateStaffReferences({ role: 2, departmentId: 1, reporterId: 1 }), { statusCode: rejectedField === "assignment_valid" ? 409 : 400 });
  }
});

test("staff repository merges partial updates only after locking the current row", async () => {
  const queries = [];
  let released = false;
  const current = { id: 9, name: "Teacher", email: "staff@example.test", role: 2, departmentId: 1, dob: "1990-01-01" };
  const client = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes("FOR UPDATE")) return { rows: [{ id: 9 }] };
      if (sql.includes("SELECT\n            t1.id")) return { rows: [current] };
      if (sql.includes("AS role_valid")) return { rows: [{ role_valid: true, department_valid: true, reporter_valid: true, assignment_valid: true }] };
      if (sql.includes("staff_add_update")) return { rows: [{ status: true }] };
      return { rows: [] };
    },
    release: () => { released = true; },
  };
  const repository = loadWithMocks("../src/modules/staffs/staffs-repository", {
    "../../utils": { ApiError }, "../../config": { db: { connect: async () => client } },
  });
  await repository.updateStaffById(9, { departmentId: null });
  assert.match(queries[1].sql, /FOR UPDATE/);
  const written = queries.find(({ sql }) => sql.includes("staff_add_update")).params[0];
  assert.equal(written.name, current.name);
  assert.equal(written.dob, current.dob);
  assert.equal(written.departmentId, null);
  assert.equal(queries.at(-1).sql, "COMMIT");
  assert.equal(released, true);
});

test("duplicate department names return a conflict without leaking database errors", async () => {
  const repository = loadWithMocks("../src/modules/departments/department-repository", {
    "../../config": { db: { query: async () => { const error = new Error("private database diagnostic"); error.code = "23505"; throw error; } } },
  });
  await assert.rejects(repository.addNewDepartment("Teaching"), { statusCode: 409, message: "Department name already exists" });
});
