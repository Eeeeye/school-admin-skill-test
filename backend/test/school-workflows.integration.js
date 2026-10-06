// Run in the local Compose backend: docker compose exec -T backend node < this-file
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { db } = require("./src/config");
const argon2 = require("argon2");

if (process.env.CERTIFICATE_DEMO_MODE !== "true" || process.env.NODE_ENV === "production") {
  throw new Error("School integration tests require the local demonstration stack");
}
const runId = randomUUID();
const origin = process.env.PRODUCT_TEST_ORIGIN || "http://frontend";
const password = `School-${runId}`;
const users = [];
let roleId;
let policyId;
let checks = 0;

function session() {
  const cookies = new Map();
  return async (path, options = {}, status = 200) => {
    const headers = { "content-type": "application/json" };
    if (cookies.size) {
      headers.cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join("; ");
      headers["x-csrf-token"] = decodeURIComponent(cookies.get("csrfToken") || "");
    }
    const response = await fetch(`${origin}/api/v1${path}`, {
      ...options, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: AbortSignal.timeout(20000),
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
}
const post = (body) => ({ method: "POST", body });

async function main() {
  // Separate test users prevent concurrent browser/demo sessions being logged out.
  roleId = (await db.query("INSERT INTO roles(name) VALUES ($1) RETURNING id", [`Workflow ${runId}`])).rows[0].id;
  await db.query(`INSERT INTO permissions(role_id, access_control_id, type)
    SELECT $1, id, type FROM access_controls WHERE path LIKE '/api/v1/notices%'
      OR path LIKE '/api/v1/leave%'`, [roleId]);
  const hash = await argon2.hash(password);
  for (const [i, role] of [1, roleId, roleId].entries()) {
    const email = `workflow-${runId}-${i}@example.invalid`;
    const result = await db.query(`INSERT INTO users(name,email,password,role_id,is_active,is_email_verified)
      VALUES($1,$2,$3,$4,true,true) RETURNING id`, [`Workflow ${i}`, email, hash, role]);
    users.push({ id: result.rows[0].id, email, api: session() });
    await users[i].api("/auth/login", post({ username: email, password }));
  }
  const [admin, owner, other] = users;
  await owner.api("/notices").then((data) => assert.ok(Array.isArray(data.notices)));
  await owner.api("/leave/request").then((data) => assert.deepEqual(data.leaveHistory, []));
  await owner.api("/leave/policies/me").then((data) => assert.deepEqual(data.leavePolicies, []));
  const notice = { title: `Workflow ${runId}`, description: "A persisted announcement", status: 2, recipientType: "EV" };
  await owner.api("/notices", post(notice));
  const noticeId = (await db.query("SELECT id FROM notices WHERE author_id=$1", [owner.id])).rows[0].id;
  assert.equal((await owner.api(`/notices/${noticeId}`)).description, notice.description);
  await other.api(`/notices/${noticeId}`, {}, 403);
  await other.api(`/notices/${noticeId}`, { method: "PUT", body: { ...notice, description: "Unauthorized" } }, 403);
  await owner.api(`/notices/${noticeId}/status`, post({ status: 5 }), 403);
  await owner.api(`/notices/${noticeId}`, { method: "PUT", body: { ...notice, status: 5 } }, 400);
  await admin.api(`/notices/${noticeId}/status`, post({ status: 5 }));
  assert.equal((await other.api(`/notices/${noticeId}`)).description, notice.description);
  await owner.api(`/notices/${noticeId}`, { method: "PUT", body: { ...notice, description: "Updated and resubmitted" } });
  assert.equal((await owner.api(`/notices/${noticeId}`)).description, "Updated and resubmitted");

  await admin.api("/leave/policies", post({ name: `Workflow ${runId}` }));
  policyId = (await db.query("SELECT id FROM leave_policies WHERE name=$1", [`Workflow ${runId}`])).rows[0].id;
  await admin.api(`/leave/policies/${policyId}/users`, post({ users: `${owner.id},${other.id}` }));
  const request = { policy: policyId, from: "2026-01-15", to: "2026-03-16", note: "Integration only" };
  await owner.api("/leave/request", post({ ...request, to: "2026-01-01" }), 400);
  await owner.api("/leave/request", post({ ...request, from: "2026-02-30" }), 400);
  await admin.api("/leave/request", post(request), 403);
  await owner.api("/leave/request", post(request));
  const requestId = (await owner.api("/leave/request")).leaveHistory[0].id;
  await other.api(`/leave/request/${requestId}`, { method: "PUT", body: request }, 403);
  await other.api(`/leave/request/${requestId}`, { method: "DELETE" }, 403);
  await other.api(`/leave/pending/${requestId}/status`, post({ status: 2 }), 403);
  assert.equal((await other.api("/leave/pending")).pendingLeaves.some((row) => row.id === requestId), false);
  assert.equal((await admin.api("/leave/pending")).pendingLeaves.some((row) => row.id === requestId), true);
  await admin.api(`/leave/pending/${requestId}/status`, post({ status: 2 }));
  await admin.api(`/leave/pending/${requestId}/status`, post({ status: 2 }), 409);
  await owner.api(`/leave/request/${requestId}`, { method: "DELETE" }, 403);
  assert.equal((await owner.api("/leave/request")).leaveHistory[0].days, 61);
  await other.api("/leave/request", post({ ...request, from: "2026-03-01", to: "2026-03-01" }));
  const otherRequestId = (await other.api("/leave/request")).leaveHistory[0].id;
  await admin.api(`/leave/pending/${otherRequestId}/status`, post({ status: 2 }));
  const ownerUsage = (await owner.api("/leave/policies/me")).leavePolicies.find((row) => row.id === policyId);
  assert.equal(Number(ownerUsage.totalDaysUsed), 61);
  const otherUsage = (await other.api("/leave/policies/me")).leavePolicies.find((row) => row.id === policyId);
  assert.equal(Number(otherUsage.totalDaysUsed), 1);
  await owner.api("/leave/request", post({ ...request, from: "2026-04-01", to: "2026-04-01" }));
  const ownPending = (await owner.api("/leave/request")).leaveHistory.find((row) => row.statusId === 1);
  await owner.api(`/leave/request/${ownPending.id}`, { method: "DELETE" });
  const eligible = await admin.api("/leave/policies/eligible-users");
  assert.equal(eligible.users.some((row) => "password" in row), false);
  console.log(`PASS: ${checks} real HTTP checks; notice persistence/authorization, leave ownership/review/dates/usage.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  const ids = users.map((user) => user.id);
  await db.query("DELETE FROM notices WHERE author_id=ANY($1::int[])", [ids]);
  await db.query("DELETE FROM user_leaves WHERE user_id=ANY($1::int[])", [ids]);
  await db.query("DELETE FROM user_leave_policy WHERE user_id=ANY($1::int[])", [ids]);
  await db.query("DELETE FROM users WHERE id=ANY($1::int[])", [ids]);
  if (policyId) await db.query("DELETE FROM leave_policies WHERE id=$1", [policyId]);
  if (roleId) {
    await db.query("DELETE FROM permissions WHERE role_id=$1", [roleId]);
    await db.query("DELETE FROM roles WHERE id=$1", [roleId]);
  }
  await db.end();
});
