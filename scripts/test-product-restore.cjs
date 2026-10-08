// Real recovery rehearsal. Run only against an isolated local development stack:
// COMPOSE_PROJECT_NAME=school-ci node scripts/test-product-restore.cjs
// The source stack is briefly stopped; its images and volumes are never removed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const { resolveContainerImage } = require('./lib/docker-image.cjs');

const root = path.resolve(__dirname, '..');
const sourceProject = process.env.COMPOSE_PROJECT_NAME;
assert(['school-ci', 'school-review'].includes(sourceProject), 'Use an isolated school-ci or school-review Compose project');
process.umask(0o077);
const runId = randomUUID();
const cloneProject = `${sourceProject}-restore-${runId.slice(0, 8)}`;
const services = ['postgres', 'blockchain', 'ipfs', 'backend', 'frontend'];
const volumeTargets = {
  'blockchain-data': ['blockchain', '/chain-data'],
  'blockchain-deployments': ['blockchain', '/deployments'],
  'ipfs-data': ['ipfs', '/data/ipfs'],
};
const fixture = {
  adminEmail: `restore-admin-${runId}@example.invalid`,
  studentEmail: `restore-student-${runId}@example.invalid`,
  password: `Restore-${randomUUID()}`,
};
const containers = {};
const sourceImages = {};
let temporary, cloneFile, sourceStopped = false, fixtureStarted = false, cloneCreated = false;
let child, interrupted = false, cleaning = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (cleaning) return;
  interrupted = true;
  child?.kill('SIGTERM');
});

function docker(args, { input, inputFile, outputFile, timeout = 180000 } = {}) {
  if (interrupted && !cleaning) return Promise.reject(new Error('Restore rehearsal interrupted'));
  return new Promise((resolve, reject) => {
    const inputFd = inputFile ? fs.openSync(inputFile, 'r') : undefined;
    const outputFd = outputFile ? fs.openSync(outputFile, 'w', 0o600) : undefined;
    let stdout = '', stderr = '', settled = false;
    const process = spawn('docker', args, { cwd: root, env: global.process.env,
      stdio: [inputFd ?? 'pipe', outputFd ?? 'pipe', 'pipe'] });
    child = process;
    const timer = setTimeout(() => process.kill('SIGTERM'), timeout);
    process.stdout?.on('data', (data) => {
      stdout += data;
      if (stdout.length > 8 * 1024 * 1024) process.kill('SIGTERM');
    });
    process.stderr.on('data', (data) => { stderr = (stderr + data).slice(-16000); });
    const finish = (error, code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (inputFd !== undefined) fs.closeSync(inputFd);
      if (outputFd !== undefined) fs.closeSync(outputFd);
      if (child === process) child = undefined;
      if (error) reject(error);
      else if (code !== 0) reject(new Error(`Docker ${args[0]} failed (${code}): ${stderr.trim()}`));
      else resolve(stdout.trim());
    };
    process.on('error', (error) => finish(error));
    process.on('close', (code) => finish(null, code));
    if (inputFd === undefined) process.stdin.end(input);
    process.stdin?.on('error', () => {});
  });
}

const compose = (project, file, ...args) => docker(['compose', '-p', project, ...(file ? ['-f', file] : []), ...args]);
const inspect = async (id) => JSON.parse(await docker(['inspect', id]))[0];
const envMap = (container) => Object.fromEntries(container.Config.Env.map((entry) => {
  const separator = entry.indexOf('=');
  return [entry.slice(0, separator), entry.slice(separator + 1)];
}));

async function waitHealthy(ids, timeout = 180000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const states = JSON.parse(await docker(['inspect', ...ids]));
    if (states.every((item) => item.State.Status === 'running'
      && (!item.State.Health || item.State.Health.Status === 'healthy'))) return;
    const failed = states.find((item) => ['dead', 'exited'].includes(item.State.Status));
    if (failed) throw new Error(`Service ${failed.Config.Labels['com.docker.compose.service']} stopped during recovery`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error('Recovered services did not become healthy before the timeout');
}

async function resumeSource() {
  if (!sourceStopped) return;
  await docker(['start', containers.blockchain.Id, containers.ipfs.Id]);
  await waitHealthy([containers.postgres.Id, containers.blockchain.Id, containers.ipfs.Id]);
  await docker(['start', containers.backend.Id, containers.frontend.Id]);
  await waitHealthy(services.map((service) => containers[service].Id));
  sourceStopped = false;
}

// Run API requests inside the selected backend, so neither original nor clone
// depends on a host port or an external URL. Credentials travel through stdin.
async function inBackend(container, mode, expected) {
  const source = `(${async function (mode, fixture, expected) {
    const assert = require('node:assert/strict');
    const { db } = require('./src/config');
    const argon2 = require('argon2');
    assert.notEqual(process.env.NODE_ENV, 'production');
    assert.equal(process.env.CERTIFICATE_DEMO_MODE, 'true');
    const cookies = new Map();
    async function request(route, method = 'GET', body, status = 200) {
      const response = await fetch(`http://127.0.0.1:5007/api/v1${route}`, {
        method, headers: { 'content-type': 'application/json',
          cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
          'x-csrf-token': decodeURIComponent(cookies.get('csrfToken') || '') },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(65000),
      });
      for (const value of response.headers.getSetCookie()) {
        const pair = value.split(';', 1)[0], split = pair.indexOf('=');
        cookies.set(pair.slice(0, split), pair.slice(split + 1));
      }
      const result = await response.json();
      assert.equal(response.status, status, `${method} ${route}: ${JSON.stringify(result)}`);
      return result;
    }
    try {
      if (mode === 'create') {
        const hash = await argon2.hash(fixture.password);
        const admin = await db.query(`INSERT INTO users(name,email,password,role_id,is_active,is_email_verified)
          VALUES('Restore test administrator',$1,$2,1,true,true) RETURNING id`, [fixture.adminEmail, hash]);
        await db.query('INSERT INTO user_profiles(user_id) VALUES($1)', [admin.rows[0].id]);
      }
      const admin = (await db.query('SELECT id FROM users WHERE email=$1', [fixture.adminEmail])).rows[0];
      if (!admin && mode === 'cleanup') return { cleaned: true };
      assert.ok(admin, 'Restore fixture administrator is missing');
      await request('/auth/login', 'POST', { username: fixture.adminEmail, password: fixture.password });
      if (mode === 'create') {
        const config = await request('/certificates/config');
        assert.equal(config.demoMode, true); assert.equal(config.chainId, 31337); assert.equal(config.available, true);
        const student = await request('/students', 'POST', { name: 'Restore rehearsal fixture', email: fixture.studentEmail }, 201);
        const { certificate } = await request('/certificates', 'POST', { studentId: student.userId,
          title: 'Restore rehearsal', description: 'Isolated local recovery test',
          recipientAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' }, 201);
        assert.equal(certificate.status, 'issued');
        assert.equal((await request(`/certificates/verify/${certificate.id}`)).valid, true);
        return { studentId: student.userId, certificateId: certificate.id,
          metadataCid: certificate.metadataCid, contractAddress: config.contractAddress };
      }
      if (mode === 'verify') {
        const student = await request(`/students/${expected.studentId}`);
        assert.equal(student.email, fixture.studentEmail);
        const before = await request(`/certificates/verify/${expected.certificateId}`);
        assert.equal(before.valid, true);
        assert.equal(before.metadataCid, expected.metadataCid);
        assert.equal(before.contractAddress.toLowerCase(), expected.contractAddress.toLowerCase());
        const stored = (await request(`/certificates/${expected.certificateId}`)).certificate;
        assert.equal(stored.studentId, expected.studentId);
        const revoked = (await request(`/certificates/${expected.certificateId}/revoke`, 'POST', {})).certificate;
        assert.equal(revoked.status, 'revoked');
        const after = await request(`/certificates/verify/${expected.certificateId}`);
        assert.equal(after.valid, false); assert.equal(after.status, 'revoked');
        assert.equal(after.metadataCid, expected.metadataCid);
        const frontend = await fetch('http://frontend/health', { signal: AbortSignal.timeout(10000) });
        assert.equal(frontend.status, 200); assert.equal((await frontend.text()).trim(), 'ok');
        return { ...expected, restored: true, revoked: true, frontendHealthy: true };
      }
      if (mode === 'cleanup') {
        const certificates = (await db.query('SELECT id,status FROM student_certificates WHERE created_by=$1', [admin.id])).rows;
        for (const certificate of certificates) {
          if (certificate.status === 'issued') {
            assert.equal((await request(`/certificates/${certificate.id}/revoke`, 'POST', {})).certificate.status, 'revoked');
          }
        }
        await db.query('DELETE FROM student_certificates WHERE created_by=$1', [admin.id]);
        const student = (await db.query('SELECT id FROM users WHERE email=$1 AND role_id=3', [fixture.studentEmail])).rows[0];
        if (student) await request(`/students/${student.id}`, 'DELETE');
        await db.query('DELETE FROM user_profiles WHERE user_id=$1', [admin.id]);
        await db.query('DELETE FROM users WHERE id=$1 AND email=$2', [admin.id, fixture.adminEmail]);
        return { cleaned: true };
      }
      throw new Error('Unknown rehearsal step');
    } finally { await db.end(); }
  }.toString()})(${JSON.stringify(mode)},${JSON.stringify(fixture)},${JSON.stringify(expected)}).then(result => console.log('RESTORE_RESULT:' + JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode=1; });`;
  const output = await docker(['exec', '-i', container, 'node', '-'], { input: source });
  const line = output.split('\n').findLast((value) => value.startsWith('RESTORE_RESULT:'));
  assert.ok(line, 'Backend did not produce a recovery result');
  return JSON.parse(line.slice('RESTORE_RESULT:'.length));
}

// Compose interpolates dollar signs even in JSON/YAML scalar strings.
const escapeCompose = (value) => typeof value === 'string' ? value.replaceAll('$', '$$')
  : Array.isArray(value) ? value.map(escapeCompose)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, escapeCompose(item)])) : value;

function cloneService(source, image, volumes = []) {
  const result = { ...image, pull_policy: 'never', environment: envMap(source), volumes };
  if (source.Config.Entrypoint) result.entrypoint = source.Config.Entrypoint;
  if (source.Config.Cmd) result.command = source.Config.Cmd;
  if (source.Config.User) result.user = source.Config.User;
  if (source.Config.WorkingDir) result.working_dir = source.Config.WorkingDir;
  if (source.HostConfig.Init) result.init = true;
  const health = source.Config.Healthcheck;
  if (health && health.Test?.[0] !== 'NONE') {
    result.healthcheck = { test: health.Test };
    for (const [field, key] of [['Interval', 'interval'], ['Timeout', 'timeout'], ['StartPeriod', 'start_period']]) {
      if (health[field]) result.healthcheck[key] = `${health[field]}ns`;
    }
    if (health.Retries) result.healthcheck.retries = health.Retries;
  }
  return result;
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function main() {
  // Fail closed for remote Docker contexts; this test never uses an SSH server.
  const contextName = await docker(['context', 'show']);
  const context = JSON.parse(await docker(['context', 'inspect', contextName]))[0];
  const endpoint = process.env.DOCKER_CONTEXT ? context.Endpoints.docker.Host
    : process.env.DOCKER_HOST || context.Endpoints.docker.Host;
  assert.ok(endpoint.startsWith('unix://'), 'Recovery rehearsal requires a local Unix-socket Docker daemon');
  for (const service of services) {
    const ids = await compose(sourceProject, null, 'ps', '-q', service);
    assert.match(ids, /^[a-f0-9]{12,64}$/, `Expected one running ${service} container`);
    const container = await inspect(ids);
    assert.equal(container.Config.Labels['com.docker.compose.project'], sourceProject);
    assert.equal(container.Config.Labels['com.docker.compose.service'], service);
    assert.match(container.Image, /^sha256:[a-f0-9]{64}$/);
    containers[service] = container;
    sourceImages[service] = await resolveContainerImage(container, async (args) =>
      JSON.parse(await docker(['image', 'inspect', ...args]))[0]);
  }
  assert.equal(envMap(containers.backend).CERTIFICATE_DEMO_MODE, 'true');
  assert.notEqual(envMap(containers.backend).NODE_ENV, 'production');
  assert.equal(envMap(containers.postgres).POSTGRES_USER, 'postgres');
  assert.equal(envMap(containers.postgres).POSTGRES_DB, 'school_mgmt');
  await waitHealthy(services.map((service) => containers[service].Id));
  assert.equal(await docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${cloneProject}`]), '');
  assert.equal(await docker(['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${cloneProject}`]), '');
  temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'school-restore-'));
  await fsp.chmod(temporary, 0o700);
  fixtureStarted = true;
  const expected = await inBackend(containers.backend.Id, 'create');

  sourceStopped = true;
  await docker(['stop', '--time', '30', containers.frontend.Id, containers.backend.Id]);
  await docker(['stop', '--time', '30', containers.blockchain.Id, containers.ipfs.Id]);
  const dump = path.join(temporary, 'postgres.dump');
  await docker(['exec', containers.postgres.Id, 'pg_dump', '-U', 'postgres', '-d', 'school_mgmt', '--format=custom'], { outputFile: dump });
  const archives = {};
  for (const [name, [service, destination]] of Object.entries(volumeTargets)) {
    const mount = containers[service].Mounts.find((item) => item.Type === 'volume' && item.Destination === destination);
    assert.ok(mount && mount.Name === `${sourceProject}_${name}`, `Expected an isolated ${name} volume`);
    const archive = path.join(temporary, `${name}.tar.gz`);
    await docker(['run', '--rm', '--network', 'none', '--read-only',
      ...(sourceImages.postgres.platform ? ['--platform', sourceImages.postgres.platform] : []),
      '--mount', `type=volume,source=${mount.Name},target=/source,readonly`,
      '--entrypoint', 'tar', sourceImages.postgres.image, '-czf', '-', '-C', '/source', '.'], { outputFile: archive });
    archives[name] = archive;
  }
  const digests = {};
  for (const file of [dump, ...Object.values(archives)]) digests[path.basename(file)] = await sha256(file);
  await fsp.writeFile(path.join(temporary, 'manifest.json'), JSON.stringify({ expected, images: sourceImages, sha256: digests }, null, 2), { mode: 0o600 });
  await resumeSource();
  console.log('PASS: consistent PostgreSQL, chain, deployment and IPFS snapshots; original services restored.');

  // This is a standalone Compose file. No inherited ports or source-volume names
  // can leak into the clone; it publishes no ports and reuses exact image IDs.
  const config = { services: {
    postgres: cloneService(containers.postgres, sourceImages.postgres, ['postgres-data:/var/lib/postgresql/data']),
    blockchain: cloneService(containers.blockchain, sourceImages.blockchain, ['blockchain-data:/chain-data', 'blockchain-deployments:/deployments']),
    ipfs: cloneService(containers.ipfs, sourceImages.ipfs, ['ipfs-data:/data/ipfs']),
    backend: cloneService(containers.backend, sourceImages.backend, [
      { type: 'bind', source: path.join(root, 'seed_db/migrations'), target: '/migrations', read_only: true },
      'blockchain-deployments:/blockchain-deployments:ro',
    ]),
    frontend: cloneService(containers.frontend, sourceImages.frontend),
  }, volumes: { 'postgres-data': {}, 'blockchain-data': {}, 'blockchain-deployments': {}, 'ipfs-data': {} } };
  cloneFile = path.join(temporary, 'compose.restore.json');
  await fsp.writeFile(cloneFile, JSON.stringify(escapeCompose(config), null, 2), { mode: 0o600 });
  await compose(cloneProject, cloneFile, 'config', '--quiet');
  cloneCreated = true;
  await compose(cloneProject, cloneFile, 'create', '--no-build', '--pull', 'never');
  const cloneIds = {};
  for (const service of services) {
    cloneIds[service] = await compose(cloneProject, cloneFile, 'ps', '-aq', service);
    assert.match(cloneIds[service], /^[a-f0-9]{12,64}$/);
  }
  await docker(['start', cloneIds.postgres]);
  await waitHealthy([cloneIds.postgres]);
  assert.equal(await sha256(dump), digests['postgres.dump']);
  await docker(['exec', '-i', cloneIds.postgres, 'pg_restore', '-U', 'postgres', '-d', 'school_mgmt', '--clean', '--if-exists', '--exit-on-error'], { inputFile: dump });
  for (const [name, archive] of Object.entries(archives)) {
    assert.equal(await sha256(archive), digests[path.basename(archive)]);
    await docker(['run', '--rm', '-i', '--network', 'none', '--read-only',
      ...(sourceImages.postgres.platform ? ['--platform', sourceImages.postgres.platform] : []),
      '--mount', `type=volume,source=${cloneProject}_${name},target=/restore`,
      '--entrypoint', 'tar', sourceImages.postgres.image, '-xzf', '-', '-C', '/restore'], { inputFile: archive });
  }
  await docker(['start', cloneIds.blockchain, cloneIds.ipfs]);
  await waitHealthy([cloneIds.blockchain, cloneIds.ipfs]);
  await docker(['start', cloneIds.backend, cloneIds.frontend]);
  await waitHealthy(Object.values(cloneIds));
  const result = await inBackend(cloneIds.backend, 'verify', expected);
  console.log(`PASS: fresh-volume restore verified student ${result.studentId}, certificate ${result.certificateId}, CID ${result.metadataCid}, unchanged contract and successful revocation.`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  cleaning = true;
  const failures = [];
  try { await resumeSource(); } catch (error) { failures.push(`Original service restart: ${error.message}`); }
  if (fixtureStarted && !sourceStopped) {
    try { await inBackend(containers.backend.Id, 'cleanup'); } catch (error) { failures.push(`Original fixture cleanup: ${error.message}`); }
  }
  if (cloneCreated) {
    try { await compose(cloneProject, cloneFile, 'down', '--volumes', '--remove-orphans'); }
    catch (error) { failures.push(`Temporary clone cleanup (${cloneProject}): ${error.message}`); }
  }
  if (temporary && !failures.length) await fsp.rm(temporary, { recursive: true, force: true });
  if (failures.length) {
    for (const failure of failures) console.error(failure);
    console.error(`Private recovery files retained at ${temporary || 'none'}; resolve cleanup before deleting them.`);
    process.exitCode = 1;
  } else if (!process.exitCode) console.log('PASS: clone resources and fixture rows cleaned; source data volumes preserved (test chain history remains).');
});
