// Stream into the local backend container: docker compose exec -T backend node < backend/test/staff.integration.js
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { db } = require("./src/config");
const argon2 = require("argon2");

if (process.env.CERTIFICATE_DEMO_MODE !== "true" || process.env.NODE_ENV === "production") {
  throw new Error("Staff integration tests require the local demonstration stack");
}
const origin = process.env.PRODUCT_TEST_ORIGIN || "http://frontend";
const runId = randomUUID();
const fixtureDepartment = `Dept ${runId}`;
const fixtureClass = `Class ${runId}`;
const secondClass = `Other ${runId}`;
const fixtureSection = `S${runId}`;
const users = [];
const cookies = new Map();
let checks = 0;
let departmentId;
let adminId;
const post = (body) => ({ method: "POST", body });
const put = (body) => ({ method: "PUT", body });

async function request(path, options = {}, status = 200) {
  const headers = { "content-type": "application/json" };
  if (cookies.size) {
    headers.cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join("; ");
    headers["x-csrf-token"] = decodeURIComponent(cookies.get("csrfToken") || "");
  }
  const response = await fetch(`${origin}/api/v1${path}`, {
    ...options, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(15000),
  });
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(";", 1)[0];
    const index = pair.indexOf("=");
    cookies.set(pair.slice(0, index), pair.slice(index + 1));
  }
  const body = await response.json();
  assert.equal(response.status, status, `${options.method || "GET"} ${path}: ${JSON.stringify(body)}`);
  checks++;
  return body;
}

async function main() {
  const adminEmail = `staff-test-admin-${runId}@example.invalid`;
  const adminPassword = `Staff-${runId}`;
  adminId = (await db.query(`INSERT INTO users(name,email,password,role_id,is_active,is_email_verified)
    VALUES('Staff test administrator',$1,$2,1,true,true) RETURNING id`, [adminEmail, await argon2.hash(adminPassword)])).rows[0].id;
  await request("/auth/login", post({ username: adminEmail, password: adminPassword }));
  await request("/departments", post({ name: fixtureDepartment }));
  departmentId = (await request("/departments")).departments.find((row) => row.name === fixtureDepartment).id;
  await request("/departments", post({ name: fixtureDepartment }), 409);
  const payload = { name: "Staff department test", email: `staff-${runId}@example.invalid`, role: 2,
    departmentId, reporterId: adminId, dob: "1990-01-02", joinDate: "2026-01-02", systemAccess: false };
  const created = await request("/staffs", post(payload));
  assert.ok(created.userId, JSON.stringify(created));
  users.push(created.userId);
  const staff = await request(`/staffs/${created.userId}`);
  assert.equal(staff.departmentId, departmentId);
  assert.equal(staff.departmentName, fixtureDepartment);
  assert.equal(staff.dob, payload.dob);
  const filtered = await request(`/staffs?departmentId=${departmentId}`);
  assert.deepEqual(filtered.staffs.map((row) => row.id), [created.userId]);
  await request(`/staffs/${created.userId}`, put({ departmentId: null }));
  const cleared = await request(`/staffs/${created.userId}`);
  assert.equal(cleared.departmentId, null);
  assert.equal(cleared.email, payload.email);
  await request(`/staffs/${created.userId}`, put({ departmentId }));
  await request("/staffs", post(payload), 409);
  await request(`/staffs/${created.userId}`, put({ departmentId: 2147483647 }), 400);
  await request(`/staffs/${created.userId}`, put({ dob: "2026-02-30" }), 400);
  await request(`/staffs/${created.userId}/status`, post({ status: "false" }), 400);
  await request(`/staffs/${created.userId}/status`, post({ status: true }), 400);
  await db.query("UPDATE users SET is_email_verified=true WHERE id=$1", [created.userId]);
  await request(`/staffs/${created.userId}/status`, post({ status: true }));
  assert.equal((await request(`/staffs/${created.userId}`)).systemAccess, true);

  await request("/sections", post({ name: fixtureSection }));
  await request("/classes", post({ name: fixtureClass, sections: fixtureSection }));
  const student = await request("/students", post({ name: "Never staff", email: `student-${runId}@example.invalid`, class: fixtureClass, section: fixtureSection }), 201);
  users.push(student.userId);
  await request("/class-teachers", post({ class: fixtureClass, section: fixtureSection, teacher: student.userId }), 400);
  await request("/class-teachers", post({ class: fixtureClass, section: "Unrelated section", teacher: created.userId }), 400);
  await request("/class-teachers", post({ class: fixtureClass, section: fixtureSection, teacher: created.userId }));
  await request("/class-teachers", post({ class: fixtureClass, section: fixtureSection, teacher: created.userId }), 409);
  const assignment = (await request("/class-teachers")).classTeachers.find((row) => row.class === fixtureClass);
  assert.equal(assignment.teacher, payload.name);
  assert.equal((await request(`/class-teachers/${assignment.id}`)).teacher, created.userId);
  assert.equal((await request(`/students/${student.userId}`)).reporterName, payload.name);
  await request(`/staffs/${created.userId}`, put({ role: 1 }), 409);

  const secondTeacher = await request("/staffs", post({ ...payload, name: "Replacement teacher", email: `second-staff-${runId}@example.invalid` }));
  users.push(secondTeacher.userId);
  await request(`/class-teachers/${assignment.id}`, put({ class: fixtureClass, section: fixtureSection, teacher: secondTeacher.userId }));
  assert.equal((await request(`/students/${student.userId}`)).reporterName, "Replacement teacher");
  await request("/classes", post({ name: secondClass, sections: fixtureSection }));
  const secondStudent = await request("/students", post({ name: "Second class student", email: `second-student-${runId}@example.invalid`, class: secondClass, section: fixtureSection }), 201);
  users.push(secondStudent.userId);
  await request(`/class-teachers/${assignment.id}`, put({ class: secondClass, section: fixtureSection, teacher: secondTeacher.userId }));
  const reporters = (await db.query("SELECT id, reporter_id FROM users WHERE id=ANY($1::int[])", [[student.userId, secondStudent.userId]])).rows;
  assert.notEqual(reporters.find((row) => row.id === student.userId).reporter_id, secondTeacher.userId);
  assert.equal(reporters.find((row) => row.id === secondStudent.userId).reporter_id, secondTeacher.userId);

  await request(`/staffs/${student.userId}`, {}, 404);
  await request(`/staffs/${student.userId}`, put({ role: 2, name: "Invalid conversion" }), 404);
  await request(`/staffs/${student.userId}/status`, post({ status: false }), 404);
  await request(`/departments/${departmentId}`, { method: "DELETE" });
  assert.equal((await request(`/staffs/${created.userId}`)).departmentId, null);
  console.log(`PASS: ${checks} staff HTTP checks; departments, staff create/edit/validation/status, teacher assignment and student isolation.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await db.query("DELETE FROM class_teachers WHERE class_name=ANY($1::text[])", [[fixtureClass, secondClass]]);
  await db.query("UPDATE users SET reporter_id=NULL WHERE reporter_id=ANY($1::int[])", [users]);
  for (const id of users) {
    await db.query("DELETE FROM user_profiles WHERE user_id=$1", [id]);
    await db.query("DELETE FROM users WHERE id=$1", [id]);
  }
  if (departmentId) await db.query("DELETE FROM departments WHERE id=$1", [departmentId]);
  if (adminId) await db.query("DELETE FROM users WHERE id=$1", [adminId]);
  await db.query("DELETE FROM classes WHERE name=ANY($1::text[])", [[fixtureClass, secondClass]]);
  await db.query("DELETE FROM sections WHERE name=$1", [fixtureSection]);
  await db.end();
});
