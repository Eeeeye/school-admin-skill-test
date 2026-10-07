// Stream into the isolated local backend: docker compose exec -T backend node < backend/test/audit.integration.js
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const argon2 = require("argon2");
const { db } = require("./src/config");

const origin = process.env.PRODUCT_TEST_ORIGIN || "http://frontend";
if (process.env.NODE_ENV === "production" || process.env.CERTIFICATE_DEMO_MODE !== "true"
    || !["localhost", "127.0.0.1", "frontend", "backend"].includes(new URL(origin).hostname)) {
  throw new Error("Audit integration checks require an isolated local demonstration stack");
}
const runId = randomUUID().slice(0, 12);
const password = `Audit-password-${randomUUID()}`;
const users = [];
const classNames = [`Audit class ${runId}`, `Renamed class ${runId}`];
const sectionNames = [`Audit ${runId}`, `Renamed ${runId}`];
let roleId, policyId, classId, sectionId;
let checks = 0;
const post = (body) => ({ method: "POST", body });
const put = (body) => ({ method: "PUT", body });

function session() {
  const cookies = new Map();
  const request = async (path, options = {}, status = 200) => {
    const headers = { "content-type": "application/json" };
    if (cookies.size) {
      headers.cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join("; ");
      headers["x-csrf-token"] = decodeURIComponent(cookies.get("csrfToken") || "");
    }
    const response = await fetch(`${origin}/api/v1${path}`, {
      ...options, headers, body: options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
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
  };
  return { request, cookies };
}

async function main() {
  // Prefer the historically misclassified ID 4 if unused, without overwriting
  // existing roles when this script is run on a populated isolated stack.
  const role = await db.query("INSERT INTO roles(id,name) SELECT 4,$1 WHERE NOT EXISTS(SELECT 1 FROM roles WHERE id=4) RETURNING id", [`Audit role ${runId}`]);
  roleId = role.rows[0]?.id || (await db.query("INSERT INTO roles(name) VALUES($1) RETURNING id", [`Audit role ${runId}`])).rows[0].id;
  // Deliberately grant every configurable permission: administrator-only guards
  // must still stop role escalation and edits to administrator accounts.
  await db.query("INSERT INTO permissions(role_id,access_control_id,type) SELECT $1,id,type FROM access_controls", [roleId]);
  const hash = await argon2.hash(password);
  for (const [index, role] of [1, roleId, 2, 3].entries()) {
    const email = `audit-${runId}-${index}@example.invalid`;
    const id = (await db.query(`INSERT INTO users(name,email,password,role_id,is_active,is_email_verified)
      VALUES($1,$2,$3,$4,true,true) RETURNING id`, [`Audit ${index}`, email, hash, role])).rows[0].id;
    await db.query("INSERT INTO user_profiles(user_id) VALUES($1)", [id]);
    const api = session();
    users.push({ id, email, ...api });
    await api.request("/auth/login", post({ username: email, password }));
  }
  const [admin, editor, teacher, student] = users;
  await db.query("UPDATE user_profiles SET join_dt=CURRENT_DATE WHERE user_id=$1", [editor.id]);
  const parentCount = (await db.query(`SELECT count(*)::int AS total FROM users u JOIN user_profiles p ON p.user_id=u.id
    JOIN roles r ON r.id=u.role_id WHERE LOWER(r.name)='parent' AND EXTRACT(YEAR FROM p.join_dt)=EXTRACT(YEAR FROM CURRENT_DATE)`)).rows[0].total;
  assert.equal((await admin.request('/dashboard')).parents.totalNumberCurrentYear, parentCount);
  await editor.request("/staffs", post({ name: "Escalation", email: `blocked-${runId}@example.invalid`, role: 1 }), 403);
  await editor.request(`/staffs/${editor.id}`, put({ role: 1 }), 403);
  await editor.request(`/staffs/${admin.id}`, put({ email: `hijack-${runId}@example.invalid` }), 403);
  await editor.request(`/staffs/${teacher.id}`, put({ email: `hijack-teacher-${runId}@example.invalid` }), 403);
  await editor.request(`/staffs/${admin.id}/status`, post({ status: false }), 403);
  await editor.request("/roles/switch", post({ userId: editor.id, roleId: 1 }), 403);
  await admin.request(`/staffs/${admin.id}`, put({ systemAccess: false }), 400);
  await admin.request("/roles/switch", post({ userId: admin.id, roleId: 2 }), 400);
  await admin.request("/roles/switch", post({ userId: teacher.id, roleId: 3 }), 400);
  await admin.request(`/roles/${roleId}`, put({ name: "aDmIn" }), 409);
  await editor.request(`/staffs/${teacher.id}`, put({ phone: "123456" }));

  await admin.request(`/staffs/${teacher.id}/status`, post({ status: false }));
  await teacher.request("/account/me", {}, 401);
  await admin.request(`/staffs/${teacher.id}/status`, post({ status: true }));
  await teacher.request("/account/me", {}, 401);
  await teacher.request("/auth/login", post({ username: teacher.email, password }));
  await admin.request(`/students/${student.id}/status`, post({ status: false }));
  await admin.request(`/students/${student.id}/status`, post({ status: true }));
  await student.request("/account/me", {}, 401);
  await student.request("/auth/login", post({ username: student.email, password }));
  await admin.request(`/roles/${roleId}/status`, post({ status: false }));
  await admin.request(`/roles/${roleId}/status`, post({ status: true }));
  await editor.request("/account/me", {}, 401);
  await editor.request("/auth/login", post({ username: editor.email, password }));

  await admin.request("/sections", post({ name: sectionNames[0] }));
  sectionId = (await db.query("SELECT id FROM sections WHERE name=$1", [sectionNames[0]])).rows[0].id;
  await admin.request("/sections", post({ name: sectionNames[0] }), 409);
  await admin.request("/sections", post({ name: " " }), 400);
  await admin.request("/sections/not-an-id", {}, 400);
  await admin.request("/classes", post({ name: classNames[0], sections: String(sectionId) }));
  classId = (await db.query("SELECT id FROM classes WHERE name=$1", [classNames[0]])).rows[0].id;
  await admin.request(`/students/${student.id}`, put({ class: classNames[0], section: sectionNames[0] }));
  await admin.request("/class-teachers", post({ class: classNames[0], section: sectionNames[0], teacher: teacher.id }));
  await admin.request("/roles/switch", post({ userId: teacher.id, roleId }), 409);
  await admin.request(`/classes/${classId}`, put({ name: classNames[0], sections: "" }), 409);
  await admin.request(`/sections/${sectionId}`, put({ name: sectionNames[1] }));
  assert.equal((await admin.request(`/classes/${classId}`)).sections, sectionNames[1]);
  assert.equal((await admin.request(`/students/${student.id}`)).section, sectionNames[1]);
  await admin.request(`/students/${student.id}`, put({ name: "Still editable after rename" }));
  await admin.request("/notices", post({ title: `Audit notice ${runId}`, description: "Specific class audience", status: 5, recipientType: "SP", recipientRole: 3, firstField: classNames[0] }));
  const noticeId = (await db.query("SELECT id FROM notices WHERE title=$1", [`Audit notice ${runId}`])).rows[0].id;
  await admin.request(`/classes/${classId}`, put({ name: classNames[1], sections: sectionNames[1] }));
  assert.equal((await admin.request(`/notices/${noticeId}`)).firstField, classNames[1]);
  await admin.request(`/classes/${classId}`, { method: "DELETE" });
  const cleared = await admin.request(`/students/${student.id}`);
  assert.equal(cleared.class, null);
  assert.equal(cleared.section, null);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM class_teachers WHERE teacher_id=$1", [teacher.id])).rows[0].n, 0);
  // Deleting a section also repairs every class membership string.
  await admin.request("/classes", post({ name: classNames[0], sections: sectionNames[1] }));
  classId = (await db.query("SELECT id FROM classes WHERE name=$1", [classNames[0]])).rows[0].id;
  await admin.request(`/sections/${sectionId}`, { method: "DELETE" });
  assert.equal((await admin.request(`/classes/${classId}`)).sections, "");
  await admin.request(`/classes/${classId}`, { method: "DELETE" });

  await admin.request("/leave/policies", post({ name: `Audit leave ${runId}` }));
  policyId = (await db.query("SELECT id FROM leave_policies WHERE name=$1", [`Audit leave ${runId}`])).rows[0].id;
  await admin.request(`/leave/policies/${policyId}/users`, post({ users: [editor.id] }), 400);
  await admin.request(`/leave/policies/${policyId}/users`, post({ users: `${editor.id},${teacher.id}` }));
  await db.query(`INSERT INTO user_leaves(user_id,leave_policy_id,from_dt,to_dt,status,submitted_dt)
    VALUES($1,$3,'2026-01-15','2026-03-16',2,NOW()),($2,$3,'2026-03-01','2026-03-01',2,NOW())`, [editor.id, teacher.id, policyId]);
  const dashboard = await editor.request("/dashboard");
  const content = dashboard.dashboard || dashboard;
  assert.equal(Number(content.leavePolicies.find((row) => row.id === policyId).totalDaysUsed), 61);
  assert.equal(Number(content.leaveHistory.find((row) => row.policyId === policyId).days), 61);
  await admin.request("/auth/login", { method: "POST", rawBody: "{" }, 400);
  await admin.request("/auth/login", post({ padding: "x".repeat(70000) }), 413);
  console.log(`PASS: ${checks} audit HTTP checks; privilege boundaries, session revocation, academic relationships, dashboard totals and malformed bodies.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  const ids = users.map(({ id }) => id);
  await db.query("DELETE FROM notices WHERE author_id=ANY($1::int[])", [ids]);
  await db.query("DELETE FROM class_teachers WHERE teacher_id=ANY($1::int[]) OR class_name=ANY($2::text[])", [ids, classNames]);
  await db.query("DELETE FROM user_leaves WHERE user_id=ANY($1::int[])", [ids]);
  await db.query("DELETE FROM user_leave_policy WHERE user_id=ANY($1::int[])", [ids]);
  await db.query("DELETE FROM user_profiles WHERE user_id=ANY($1::int[])", [ids]);
  await db.query("UPDATE users SET status_last_reviewer_id=NULL,reporter_id=NULL WHERE id=ANY($1::int[])", [ids]);
  await db.query("DELETE FROM users WHERE id=ANY($1::int[])", [ids]);
  await db.query("DELETE FROM classes WHERE name=ANY($1::text[])", [classNames]);
  await db.query("DELETE FROM sections WHERE name=ANY($1::text[])", [sectionNames]);
  if (policyId) await db.query("DELETE FROM leave_policies WHERE id=$1", [policyId]);
  if (roleId) {
    await db.query("DELETE FROM permissions WHERE role_id=$1", [roleId]);
    await db.query("DELETE FROM roles WHERE id=$1", [roleId]);
  }
  await db.end();
});
