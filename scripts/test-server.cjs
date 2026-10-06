#!/usr/bin/env node
// Public HTTPS acceptance test. Run only after deployment is explicitly ready.
// Credentials: SERVER_TEST_ADMIN_EMAIL/PASSWORD, or .server-deploy/access.json.
// Retains a clearly fictional Demo student + valid certificate on success.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const DEMO_NAME = 'Demo Interview Student';
const DEMO_EMAIL = 'interview-demo@school-demo.invalid';
const DEMO_TITLE = 'Demo Backend and Blockchain Completion';
const DEMO_DESCRIPTION = 'Fictional interview demonstration only. This is not a real academic qualification.';
const RECIPIENT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

function check(condition, label) {
  if (!condition) throw new Error(label);
}

function configuration(argv = process.argv.slice(2), env = process.env) {
  check(env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 'TLS certificate verification must remain enabled');
  const file = env.SERVER_TEST_ACCESS_FILE || path.resolve(__dirname, '../.server-deploy/access.json');
  let saved = {};
  if (fs.existsSync(file)) {
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (_error) { throw new Error('Unable to read the private server access file'); }
  }
  const email = env.SERVER_TEST_ADMIN_EMAIL || saved.email;
  const password = env.SERVER_TEST_ADMIN_PASSWORD || saved.password;
  const rawUrl = argv[0] || env.SERVER_TEST_URL || saved.url;
  let target;
  try { target = new URL(rawUrl); } catch (_error) { throw new Error('Supply a valid public HTTPS origin'); }
  check(target.protocol === 'https:' && !target.username && !target.password && !target.search && !target.hash
    && target.pathname === '/', 'Target must be an HTTPS origin without credentials, query, fragment or path');
  check(typeof email === 'string' && typeof password === 'string' && email && password, 'Administrator credentials are missing');
  if (saved.url && (!env.SERVER_TEST_ADMIN_EMAIL || !env.SERVER_TEST_ADMIN_PASSWORD)) {
    check(new URL(saved.url).origin === target.origin, 'Target differs from the private credential file; refusing to send its credentials');
  }
  return { origin: target.origin, email, password };
}

function parseCookie(value) {
  const parts = value.split(';').map((part) => part.trim());
  const separator = parts[0].indexOf('=');
  check(separator > 0, 'Server returned a malformed cookie');
  const attributes = new Map(parts.slice(1).map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? [part.toLowerCase(), true] : [part.slice(0, index).toLowerCase(), part.slice(index + 1)];
  }));
  return { name: parts[0].slice(0, separator), value: parts[0].slice(separator + 1), attributes };
}

function assertCookieSecurity(cookieHeaders, names = ['accessToken', 'refreshToken', 'csrfToken']) {
  const cookies = new Map();
  for (const value of cookieHeaders) {
    const cookie = parseCookie(value);
    if (cookie.value && Number(cookie.attributes.get('max-age')) > 0) cookies.set(cookie.name, cookie);
  }
  for (const name of names) {
    const cookie = cookies.get(name);
    check(Boolean(cookie), `Missing active ${name} cookie`);
    check(cookie.attributes.get('secure') === true, `${name} is missing Secure`);
    check(!cookie.attributes.has('domain'), `${name} must be host-only`);
    check(cookie.attributes.get('path') === '/', `${name} must cover the application path`);
    check(String(cookie.attributes.get('samesite')).toLowerCase() === 'lax', `${name} must use SameSite=Lax`);
    check(cookie.attributes.has('httponly') === (name !== 'csrfToken'), `${name} has an incorrect HttpOnly flag`);
  }
}

function publicLink(value, origin, pathname) {
  let parsed;
  try { parsed = new URL(value); } catch (_error) { throw new Error('Server returned an invalid public link'); }
  check(parsed.origin === origin && parsed.pathname === pathname && !parsed.username && !parsed.password && !parsed.search && !parsed.hash,
    'Public link must use the HTTPS application origin and expected resource');
  return parsed.href;
}

async function run(config) {
  const { origin, email, password } = config;
  const runId = randomUUID();
  const temporaryName = `Temporary Acceptance ${runId}`;
  const temporaryEmail = `acceptance-${runId}@example.invalid`;
  const cleanupStudents = new Set();
  const ownedCertificates = new Map();
  let checks = 0;
  let cleanupChecks = 0;
  let cleanupFailures = 0;
  let authenticated = false;
  let success = false;
  let result;

  function session() {
    const cookies = new Map();
    return async (resource, options = {}, expected = 200) => {
      const { body, csrf = true, headers: suppliedHeaders = {}, ...requestOptions } = options;
      const headers = { Accept: 'application/json', ...suppliedHeaders };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (cookies.size) {
        headers.Cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
        if (csrf === true) headers['X-CSRF-TOKEN'] = decodeURIComponent(cookies.get('csrfToken') || '');
        else if (typeof csrf === 'string') headers['X-CSRF-TOKEN'] = csrf;
      }
      let response;
      try {
        response = await fetch(`${origin}${resource}`, {
          ...requestOptions, headers, body: body === undefined ? undefined : JSON.stringify(body),
          redirect: 'manual', signal: AbortSignal.timeout(75000),
        });
      } catch (_error) { throw new Error(`HTTPS request failed: ${requestOptions.method || 'GET'} ${resource}`); }
      const cookieHeaders = response.headers.getSetCookie();
      for (const value of cookieHeaders) {
        const cookie = parseCookie(value);
        if (!cookie.value || cookie.attributes.get('max-age') === '0') cookies.delete(cookie.name);
        else cookies.set(cookie.name, cookie.value);
      }
      const text = await response.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch (_error) { parsed = null; }
      if (expected !== null) {
        const statuses = Array.isArray(expected) ? expected : [expected];
        check(statuses.includes(response.status), `${requestOptions.method || 'GET'} ${resource} returned HTTP ${response.status}; expected ${statuses.join('/')}`);
        checks++;
      }
      return { status: response.status, body: parsed, text, headers: response.headers, cookieHeaders };
    };
  }
  const admin = session();
  const anonymous = session();
  const api = (resource) => `/api/v1${resource}`;
  const post = (body, headers) => ({ method: 'POST', body, headers });
  const data = async (client, resource, options, expected = 200) => {
    const response = await client(api(resource), options, expected);
    check(response.body !== null, `${resource} must return JSON`);
    return response.body;
  };

  async function confirmedIssue(studentId, title, description, keep = false) {
    let response = await admin(api('/certificates'), post({ studentId, title, description, recipientAddress: RECIPIENT },
      { 'Idempotency-Key': `server-acceptance-${runId}-${keep ? 'demo' : 'revocation'}` }), null);
    let certificate = response.body?.certificate;
    if (certificate?.id) ownedCertificates.set(certificate.id, { certificate, keep: false });
    check([201, 202, 503].includes(response.status) && /^0x[0-9a-f]{64}$/.test(certificate?.id || ''), 'Certificate issuance did not create a recoverable record');
    checks++;
    for (let attempt = 0; certificate.status !== 'issued' && attempt < 4; attempt++) {
      check(certificate.status === 'pending' || certificate.status === 'failed', 'Unexpected certificate issuance status');
      await new Promise((resolve) => setTimeout(resolve, 1500));
      response = await admin(api(`/certificates/${certificate.id}/retry`), post({}), [200, 202, 503]);
      certificate = response.body?.certificate;
      check(Boolean(certificate?.id), 'Certificate retry response is missing its record');
      ownedCertificates.set(certificate.id, { certificate, keep: false });
    }
    check(certificate.status === 'issued' && /^0x[0-9a-fA-F]{64}$/.test(certificate.transactionHash || ''), 'Certificate issuance did not confirm');
    return certificate;
  }

  async function verified(certificate, expectedStatus, forbiddenStudent) {
    const value = await data(anonymous, `/certificates/verify/${certificate.id}`);
    check(value.exists === true && value.status === expectedStatus && value.valid === (expectedStatus === 'issued'), 'Public verification differs from the expected on-chain status');
    check(value.title === certificate.title, 'Verified certificate title differs from the issued record');
    for (const key of ['studentId', 'studentName', 'email', 'createdBy']) check(!(key in value), `Public verification leaks ${key}`);
    if (forbiddenStudent) {
      const serialized = JSON.stringify(value);
      check(!serialized.includes(forbiddenStudent.name) && !serialized.includes(forbiddenStudent.email), 'Public verification contains private student details');
    }
    publicLink(value.verificationUrl, origin, `/verify/${certificate.id}`);
    return value;
  }

  async function confirmedRevoke(id) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await admin(api(`/certificates/${id}/revoke`), post({}), [200, 202, 503]);
      if (response.body?.certificate?.status === 'revoked') return response.body.certificate;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw new Error('Certificate revocation did not confirm');
  }

  async function cleanup() {
    if (!authenticated) return;
    for (const [id, entry] of ownedCertificates) {
      if (entry.keep && success) continue;
      try {
        const current = await data(admin, `/certificates/${id}`);
        if (current.certificate.status === 'pending' || current.certificate.status === 'failed') {
          await admin(api(`/certificates/${id}/retry`), post({}), [200, 202, 503]);
        }
        const checked = await data(admin, `/certificates/${id}`);
        if (checked.certificate.status === 'issued') await confirmedRevoke(id);
        cleanupChecks++;
      } catch (_error) { cleanupFailures++; console.error(`Cleanup could not confirm certificate ${id}; its audit record remains.`); }
    }
    for (const id of cleanupStudents) {
      try {
        await admin(api(`/students/${id}`), { method: 'DELETE' }, [200, 404]);
        cleanupChecks++;
      } catch (_error) { cleanupFailures++; console.error(`Cleanup could not delete temporary student ${id}.`); }
    }
  }

  try {
    const health = await anonymous('/health');
    check(health.text.trim() === 'ok', 'Public health endpoint is not ready');
    const home = await anonymous('/');
    check(home.headers.get('strict-transport-security')?.includes('max-age='), 'HTTPS response is missing HSTS');
    check(home.headers.get('x-content-type-options') === 'nosniff', 'HTTPS response is missing nosniff');
    await anonymous(api('/students'), {}, 401);
    // One legacy login attempt only: no brute-force or lockout testing against the live server.
    await anonymous(api('/auth/login'), post({ username: 'admin@school-admin.com', password: '3OU4zn3q6Zh9' }), 400);

    const login = await admin(api('/auth/login'), post({ username: email, password }));
    authenticated = true;
    check(login.body?.role === 'admin', 'The supplied account is not an administrator');
    assertCookieSecurity(login.cookieHeaders);
    check(login.headers.get('cache-control')?.includes('no-store'), 'Authentication response must not be cached');
    await admin(api('/account/me'), { csrf: false }, 400);
    await admin(api('/account/me'), { csrf: 'tampered-csrf-token' }, 403);
    const refreshed = await admin(api('/auth/refresh'));
    assertCookieSecurity(refreshed.cookieHeaders, ['accessToken', 'csrfToken']);
    await data(admin, '/account/me');
    const menus = await data(admin, '/access-controls/me');
    check(JSON.stringify(menus).includes('certificates'), 'Administrator menus are missing certificates');
    await data(admin, '/dashboard');
    const classes = (await data(admin, '/classes')).classes;
    const sections = (await data(admin, '/sections')).sections;
    await data(admin, '/departments');

    const config = await data(admin, '/certificates/config');
    check(config.available === true && config.chainId === 31337, 'Expected a ready private demonstration certificate network');
    if (config.rpcUrl) {
      const rpc = new URL(config.rpcUrl);
      check(rpc.protocol === 'https:' && !/^(localhost|127\.|\[::1\]|blockchain$)/i.test(rpc.hostname)
        && !rpc.hostname.endsWith('.localhost'), 'Public certificate configuration exposes a local or insecure RPC URL');
    }

    const placement = {};
    for (const item of classes || []) {
      const allowed = String(item.sections || '').split(',').map((value) => value.trim());
      const section = (sections || []).find((entry) => allowed.includes(entry.name) || allowed.includes(String(entry.id)));
      if (section) { placement.class = item.name; placement.section = section.name; break; }
    }
    const created = await data(admin, '/students', post({ name: temporaryName, email: temporaryEmail, ...placement, roll: 7101 }), 201);
    check(Number.isInteger(created.userId), 'Student creation did not return an ID');
    const temporaryId = created.userId;
    cleanupStudents.add(temporaryId);
    const student = await data(admin, `/students/${temporaryId}`);
    check(student.name === temporaryName && student.email === temporaryEmail, 'Student creation did not preserve identity fields');
    const matched = await data(admin, `/students?name=${encodeURIComponent(temporaryName)}`);
    check(matched.students?.some((item) => item.id === temporaryId), 'Created student was not listed');
    await admin(api(`/students/${temporaryId}`), { method: 'PUT', body: { name: 'Blocked CSRF change' }, csrf: 'tampered-csrf-token' }, 403);
    check((await data(admin, `/students/${temporaryId}`)).name === temporaryName, 'CSRF failure modified student data');
    const updatedName = `Updated Acceptance ${runId}`;
    await data(admin, `/students/${temporaryId}`, { method: 'PUT', body: { name: updatedName } });
    const updated = await data(admin, `/students/${temporaryId}`);
    check(updated.name === updatedName && updated.email === temporaryEmail, 'Partial student update lost omitted identity fields');
    await data(admin, `/students/${temporaryId}/status`, post({ status: 'false' }), 400);
    await data(admin, `/students/${temporaryId}/status`, post({ status: false }));
    check((await data(admin, `/students/${temporaryId}`)).systemAccess === false, 'Student disable did not persist');
    await data(admin, `/students/${temporaryId}/status`, post({ status: true }));

    const temporaryCertificate = await confirmedIssue(temporaryId, `Demo Revocation Check ${runId.slice(0, 8)}`, 'Temporary server acceptance test; no real academic achievement.');
    const checked = await verified(temporaryCertificate, 'issued', updated);
    check(typeof checked.metadataCid === 'string' && /^[A-Za-z0-9]+$/.test(checked.metadataCid), 'Certificate metadata CID is invalid');
    publicLink(checked.metadataUrl, origin, `/ipfs/${checked.metadataCid}`);
    const metadata = await anonymous(`/ipfs/${checked.metadataCid}`);
    check(metadata.body?.certificateId === temporaryCertificate.id && metadata.body?.title === temporaryCertificate.title, 'IPFS metadata differs from the certificate');
    check(metadata.body?.recipientAddress?.toLowerCase() === RECIPIENT.toLowerCase(), 'IPFS recipient differs from the certificate');
    check(!JSON.stringify(metadata.body).includes(updated.name) && !JSON.stringify(metadata.body).includes(updated.email)
      && !('studentId' in metadata.body), 'IPFS metadata leaks private student identity');
    await anonymous(`/ipfs/${checked.metadataCid}`, { method: 'POST' }, 405);
    const revoked = await confirmedRevoke(temporaryCertificate.id);
    const revokedVerification = await verified(revoked, 'revoked', updated);
    await data(admin, `/students/${temporaryId}`, { method: 'DELETE' });
    cleanupStudents.delete(temporaryId);
    await data(admin, `/students/${temporaryId}`, {}, 404);
    check((await data(admin, `/certificates/${temporaryCertificate.id}`)).certificate.studentId === null,
      'Deleting a student must preserve certificate audit history');
    await verified(revoked, 'revoked');

    let demo = (await data(admin, `/students?name=${encodeURIComponent(DEMO_NAME)}`)).students?.find((item) => item.email === DEMO_EMAIL);
    let newDemo = false;
    if (!demo) {
      const saved = await data(admin, '/students', post({ name: DEMO_NAME, email: DEMO_EMAIL, ...placement, roll: 7102 }), 201);
      check(Number.isInteger(saved.userId), 'Demo student creation did not return an ID');
      demo = { id: saved.userId, name: DEMO_NAME, email: DEMO_EMAIL };
      cleanupStudents.add(demo.id);
      newDemo = true;
    }
    const prior = (await data(admin, `/certificates?studentId=${demo.id}`)).certificates || [];
    let display = prior.find((item) => item.title === DEMO_TITLE && item.description === DEMO_DESCRIPTION
      && item.status === 'issued' && item.recipientAddress?.toLowerCase() === RECIPIENT.toLowerCase());
    if (!display) display = await confirmedIssue(demo.id, DEMO_TITLE, DEMO_DESCRIPTION, true);
    const displayVerification = await verified(display, 'issued', demo);
    const displayMetadata = await anonymous(`/ipfs/${displayVerification.metadataCid}`);
    check(displayMetadata.body?.certificateId === display.id, 'Display certificate metadata is unavailable');
    const page = await anonymous(`/verify/${display.id}`);
    check(page.headers.get('content-type')?.includes('text/html'), 'Public verification page is unavailable');

    if (ownedCertificates.has(display.id)) ownedCertificates.get(display.id).keep = true;
    if (newDemo) cleanupStudents.delete(demo.id);
    result = { origin, checks, demoStudentId: demo.id,
      validCertificateURL: publicLink(display.verificationUrl, origin, `/verify/${display.id}`),
      revokedCertificateURL: revokedVerification.verificationUrl };
    success = true;
  } finally {
    await cleanup();
  }
  result.checks = checks;
  result.cleanupChecks = cleanupChecks;
  check(cleanupFailures === 0, `Acceptance checks passed but ${cleanupFailures} cleanup operation(s) need attention`);
  return result;
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('Usage: node scripts/test-server.cjs [https://public-host]\nCredentials: SERVER_TEST_ADMIN_EMAIL/PASSWORD, or .server-deploy/access.json.\nOptional: SERVER_TEST_URL and SERVER_TEST_ACCESS_FILE. Run only after the server is ready.');
    return;
  }
  const config = configuration();
  try {
    const result = await run(config);
    console.log(`PASS: ${result.checks} public HTTPS checks; secure cookies, CSRF, student CRUD, IPFS and on-chain issuance/revocation.`);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const safe = String(error.message).replaceAll(config.email, '[administrator]').replaceAll(config.password, '[redacted]');
    console.error(`Server acceptance failed: ${safe}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main().catch(() => { console.error('Server acceptance could not start; check target and private credential configuration.'); process.exitCode = 1; });
module.exports = { configuration, parseCookie, assertCookieSecurity, publicLink, run };
