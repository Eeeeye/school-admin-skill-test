// Real local-stack smoke test. Run via scripts/test-product.sh, never in production.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { db } = require("./src/config");
const argon2 = require("argon2");

if (process.env.CERTIFICATE_DEMO_MODE !== "true" || process.env.NODE_ENV === "production") {
  throw new Error("Product integration tests require the local demonstration stack");
}
const origin = process.env.PRODUCT_TEST_ORIGIN || "http://frontend";
const runId = randomUUID();
const password = `Product-${runId}`;
const students = [];
const certificates = [];
let customRole;
const fixtureClass = `Test ${runId}`;
const fixtureSection = `S${runId}`;
let checks = 0;

function session() {
  const cookies = new Map();
  return async (path, options = {}, status = 200) => {
    const headers = { "content-type": "application/json", ...options.headers };
    if (cookies.size) {
      headers.cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join("; ");
      headers["x-csrf-token"] = decodeURIComponent(cookies.get("csrfToken") || "");
    }
    const response = await fetch(`${origin}/api/v1${path}`, {
      ...options, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(65000),
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
const admin = session();
const anonymous = session();
const post = (body, headers) => ({ method: "POST", body, headers });

async function main() {
  const login = await admin("/auth/login", post({ username: "admin@school-admin.com", password: process.env.PRODUCT_TEST_ADMIN_PASSWORD || "3OU4zn3q6Zh9" }));
  assert.equal(login.role, "admin");
  const config = await admin("/certificates/config");
  assert.equal(config.available, true, JSON.stringify(config));
  assert.equal(config.chainId, 31337);
  const access = await admin("/access-controls/me");
  assert.ok(JSON.stringify(access).includes("certificates"));
  assert.ok(!JSON.stringify(access).includes('"markets"'));
  await admin("/dashboard");
  await admin("/classes");
  await admin("/sections");
  await admin("/departments");
  await admin("/sections", post({ name: fixtureSection }));
  await admin("/classes", post({ name: fixtureClass, sections: fixtureSection }));

  for (let i = 0; i < 2; i++) {
    const email = `product-${runId}-${i}@example.invalid`;
    const created = await admin("/students", post({ name: `Integration Student ${i}`, email, class: fixtureClass, section: fixtureSection, roll: 100 + i }), 201);
    students.push(created.userId);
    const hash = await argon2.hash(password);
    await db.query("UPDATE users SET password=$1, is_active=true, is_email_verified=true WHERE id=$2", [hash, created.userId]);
  }
  const id = students[0];
  await admin(`/students/${id}`, { method: "PUT", body: { name: "Updated integration student" } });
  const student = await admin(`/students/${id}`);
  assert.equal(student.name, "Updated integration student");
  assert.equal(student.class, fixtureClass);
  await admin(`/students/${id}`, { method: "PUT", body: { class: null, section: fixtureSection } }, 400);
  await admin(`/students/${id}`, { method: "PUT", body: { class: null } });
  const cleared = await admin(`/students/${id}`);
  assert.equal(cleared.class, null); assert.equal(cleared.section, null);
  await admin(`/students/${id}`, { method: "PUT", body: { class: fixtureClass, section: fixtureSection } });
  await admin("/students", post({ name: "Invalid pairing", email: "pairing@example.invalid", section: fixtureSection }), 400);
  await admin("/students", post({ name: "Duplicate", email: student.email }), 409);
  await admin("/students?name=definitely-no-such-student").then((data) => assert.deepEqual(data.students, []));

  const payload = { studentId: id, title: "Integration certificate", description: "Local automated test achievement", recipientAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" };
  await anonymous("/certificates", {}, 401);
  await admin("/certificates", post({ ...payload, recipientAddress: "0x0000000000000000000000000000000000000000" }), 400);
  const first = await admin("/certificates", post(payload, { "Idempotency-Key": runId }), 201);
  certificates.push(first.certificate.id);
  assert.equal(first.certificate.status, "issued", JSON.stringify(first));
  assert.ok(first.certificate.transactionHash);
  const repeat = await admin("/certificates", post(payload, { "Idempotency-Key": runId }), 201);
  assert.equal(repeat.certificate.id, first.certificate.id);
  await admin("/certificates", post({ ...payload, title: "Different" }, { "Idempotency-Key": runId }), 409);
  const verified = await anonymous(`/certificates/verify/${first.certificate.id}`);
  assert.equal(verified.valid, true);
  assert.equal(verified.title, payload.title);
  for (const key of ["studentId", "studentName", "email", "createdBy"]) assert.equal(key in verified, false, key);
  const gateway = await fetch(`${origin}/ipfs/${verified.metadataCid}`, { signal: AbortSignal.timeout(15000) });
  assert.equal(gateway.status, 200);
  const metadata = await gateway.json();
  assert.equal(metadata.certificateId, first.certificate.id);
  assert.equal(JSON.stringify(metadata).includes(student.email), false);
  assert.equal(JSON.stringify(metadata).includes(student.name), false);
  const writeGateway = await fetch(`${origin}/ipfs/${verified.metadataCid}`, { method: "POST" });
  assert.equal(writeGateway.status, 405);
  checks += 3;

  const owner = session();
  const other = session();
  await owner("/auth/login", post({ username: student.email, password }));
  await other("/auth/login", post({ username: `product-${runId}-1@example.invalid`, password }));
  const mine = await owner("/certificates");
  assert.equal(mine.certificates.length, 1);
  await owner(`/certificates/${first.certificate.id}`);
  await owner("/certificates", post(payload), 403);
  await other(`/certificates/${first.certificate.id}`, {}, 403);
  await other(`/certificates?studentId=${id}`, {}, 403);
  await other(`/certificates/${first.certificate.id}/revoke`, post({}), 403);

  // Saving the second set must revoke permissions missing from that set.
  await admin("/roles", post({ name: `Test ${runId}` }));
  const roles = await admin("/roles");
  customRole = roles.roles.find((row) => row.name === `Test ${runId}`).id;
  const permissions = (await db.query("SELECT id FROM access_controls ORDER BY id LIMIT 2")).rows.map((row) => row.id);
  await admin(`/roles/${customRole}/permissions`, post({ permissions: permissions.join(",") }));
  await admin(`/roles/${customRole}/permissions`, post({ permissions: String(permissions[1]) }));
  assert.deepEqual((await admin(`/roles/${customRole}/permissions`)).permissions.map((row) => row.id), [permissions[1]]);
  await admin(`/roles/${customRole}/permissions`, post({ permissions: "" }));
  assert.deepEqual((await admin(`/roles/${customRole}/permissions`)).permissions, []);

  const revoked = await admin(`/certificates/${first.certificate.id}/revoke`, post({}));
  assert.equal(revoked.certificate.status, "revoked");
  const invalid = await anonymous(`/certificates/verify/${first.certificate.id}`);
  assert.equal(invalid.valid, false);
  assert.equal(invalid.status, "revoked");
  const repeatedRevoke = await admin(`/certificates/${first.certificate.id}/revoke`, post({}));
  assert.equal(repeatedRevoke.certificate.status, "revoked");
  await admin(`/students/${id}`, { method: "DELETE" });
  const preserved = await admin(`/certificates/${first.certificate.id}`);
  assert.equal(preserved.certificate.studentId, null);
  assert.equal((await anonymous(`/certificates/verify/${first.certificate.id}`)).status, "revoked");
  await admin(`/students/${id}`, {}, 404);
  console.log(`PASS: ${checks} real HTTP checks; student CRUD, RBAC, permission replacement, IPFS, issuance, verification and revocation.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  // Remove only this run's fixtures. On-chain transactions are permanent local history.
  await db.query("DELETE FROM student_certificates WHERE id = ANY($1::text[])", [certificates]);
  for (const id of students) {
    await db.query("DELETE FROM user_profiles WHERE user_id=$1", [id]);
    await db.query("DELETE FROM users WHERE id=$1", [id]);
  }
  if (customRole) {
    await db.query("DELETE FROM permissions WHERE role_id=$1", [customRole]);
    await db.query("DELETE FROM roles WHERE id=$1", [customRole]);
  }
  await db.query("DELETE FROM classes WHERE name=$1", [fixtureClass]);
  await db.query("DELETE FROM sections WHERE name=$1", [fixtureSection]);
  await db.end();
});
