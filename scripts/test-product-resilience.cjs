// Real dependency-failure/restart checks. This intentionally restarts local services.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const origin = process.env.PRODUCT_URL || 'http://localhost:5173';
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname));
const compose = (...args) => execFileSync('docker', ['compose', ...args], { cwd: root, stdio: ['pipe', 'pipe', 'inherit'], timeout: 120000 });
const jar = new Map();
let studentId;
const ids = [];
async function request(route, method = 'GET', body, expected = 200, headers = {}) {
  const response = await fetch(`${origin}/api/v1${route}`, {
    method, headers: { 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
      'x-csrf-token': decodeURIComponent(jar.get('csrfToken') || ''), ...headers },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(65000),
  });
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';')[0]; const i = pair.indexOf('=');
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  const data = await response.json();
  assert.equal(response.status, expected, `${route}: ${JSON.stringify(data)}`);
  return data;
}
async function main() {
  await request('/auth/login', 'POST', { username: 'admin@school-admin.com', password: process.env.PRODUCT_TEST_ADMIN_PASSWORD || '3OU4zn3q6Zh9' });
  const config = await request('/certificates/config');
  assert.equal(config.demoMode, true); assert.equal(config.chainId, 31337); assert.equal(config.available, true);
  studentId = (await request('/students', 'POST', { name: 'Resilience test fixture', email: `resilience-${randomUUID()}@example.invalid` }, 201)).userId;
  const payload = { studentId, title: 'Resilience test', description: 'Automated local fixture', recipientAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' };
  const issued = (await request('/certificates', 'POST', payload, 201)).certificate;
  ids.push(issued.id); assert.equal(issued.status, 'issued');
  assert.equal((await request(`/certificates/verify/${issued.id}`)).valid, true);

  compose('stop', 'ipfs');
  await request(`/certificates/verify/${issued.id}`, 'GET', undefined, 503);
  const failed = (await request('/certificates', 'POST', { ...payload, title: 'Recovery test' }, 503)).certificate;
  ids.push(failed.id); assert.equal(failed.status, 'failed');
  compose('up', '-d', '--wait', 'ipfs');
  const recovered = (await request(`/certificates/${failed.id}/retry`, 'POST', {})).certificate;
  assert.equal(recovered.id, failed.id); assert.equal(recovered.status, 'issued');
  console.log('PASS: IPFS outage returns 503; failed issuance recovers the same certificate.');

  compose('stop', 'blockchain');
  await request(`/certificates/verify/${issued.id}`, 'GET', undefined, 503);
  compose('up', '-d', '--wait', 'blockchain');
  const resumed = await request(`/certificates/verify/${issued.id}`);
  assert.equal(resumed.valid, true); assert.equal(resumed.contractAddress, config.contractAddress);
  console.log('PASS: chain outage returns 503; restart preserves the registry and certificate.');

  compose('restart', 'postgres', 'ipfs', 'backend');
  compose('up', '-d', '--wait');
  const persisted = await request(`/certificates/verify/${issued.id}`);
  assert.equal(persisted.valid, true); assert.equal(persisted.metadataCid, issued.metadataCid);
  assert.equal((await request(`/certificates/${issued.id}`)).certificate.studentId, studentId);
  for (const id of ids) assert.equal((await request(`/certificates/${id}/revoke`, 'POST', {})).certificate.status, 'revoked');
  compose('restart', 'blockchain');
  compose('up', '-d', '--wait', 'blockchain');
  assert.equal((await request(`/certificates/verify/${issued.id}`)).status, 'revoked');
  console.log('PASS: database/IPFS/API restart preserves the student link and metadata; revoked state survives chain restart.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  compose('up', '-d', '--wait');
  // Delete only fixtures created by this test. On-chain audit history is immutable.
  for (const id of ids) {
    await request(`/certificates/${id}/revoke`, 'POST', {}).catch(() => {});
    assert(/^0x[0-9a-f]{64}$/.test(id));
    compose('exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'school_mgmt', '-c', `DELETE FROM student_certificates WHERE id='${id}'`);
  }
  if (studentId) await request(`/students/${studentId}`, 'DELETE');
});
