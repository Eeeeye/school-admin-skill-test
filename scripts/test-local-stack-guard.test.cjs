const test = require('node:test');
const assert = require('node:assert/strict');
const { assertLocalTestStack } = require('./lib/local-stack.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function fixture(change = {}) {
  const services = ['backend', 'frontend', 'postgres', 'blockchain', 'ipfs'];
  const calls = [];
  const containers = Object.fromEntries(services.map((service, i) => [String(i + 1).repeat(12), {
    Config: { Labels: { 'com.docker.compose.project': 'school-review', 'com.docker.compose.service': service },
      Env: ['NODE_ENV=development', 'CERTIFICATE_DEMO_MODE=true'] },
    State: { Running: true }, NetworkSettings: { Ports: { '80/tcp': [{ HostIp: '127.0.0.1', HostPort: '5173' }] } },
  }]));
  const settings = { endpoint: 'unix:///tmp/docker.sock', ...change };
  settings.mutate?.(containers);
  return { calls, options: {
    origin: settings.origin || 'http://localhost:5173',
    env: { COMPOSE_PROJECT_NAME: 'school-review', ...settings.env },
    docker(args) {
      calls.push(args);
      if (args.join(' ') === 'context show') return 'default';
      if (args[0] === 'context') return JSON.stringify([{ Endpoints: { docker: { Host: settings.endpoint } } }]);
      if (args[0] === 'compose') return String(services.indexOf(args.at(-1)) + 1).repeat(12);
      if (args[0] === 'inspect') return JSON.stringify([containers[args[1]]]);
      throw new Error(`Unexpected Docker command: ${args.join(' ')}`);
    },
  } };
}

test('accepts a running, isolated, local demonstration stack', () => {
  const f = fixture();
  assert.equal(assertLocalTestStack(f.options), 'school-review');
  assert(f.calls.every(args => ['context', 'compose', 'inspect'].includes(args[0])));
});
test('rejects missing or production projects before invoking Docker', () => {
  for (const project of [undefined, '', 'school-demo']) {
    const f = fixture({ env: { COMPOSE_PROJECT_NAME: project } });
    assert.throws(() => assertLocalTestStack(f.options), /isolated COMPOSE_PROJECT_NAME/);
    assert.equal(f.calls.length, 0);
  }
});
test('rejects remote origins and unrelated URLs before invoking Docker', () => {
  for (const origin of ['https://school-demo.eeeeye.online', 'http://localhost:5173/app', 'http://user@localhost:5173']) {
    const f = fixture({ origin });
    assert.throws(() => assertLocalTestStack(f.options), /local HTTP frontend origin/);
    assert.equal(f.calls.length, 0);
  }
});
test('rejects remote Docker contexts and DOCKER_HOST overrides before container operations', () => {
  for (const change of [{ endpoint: 'ssh://server' }, { env: { DOCKER_HOST: 'tcp://server:2375' } }]) {
    const f = fixture(change);
    assert.throws(() => assertLocalTestStack(f.options), /local Unix-socket/);
    assert(f.calls.every(args => args[0] === 'context'));
  }
});
test('honors DOCKER_CONTEXT precedence over DOCKER_HOST', () => {
  const f = fixture({ endpoint: 'ssh://server', env: { DOCKER_CONTEXT: 'remote', DOCKER_HOST: 'unix:///tmp/local.sock' } });
  assert.throws(() => assertLocalTestStack(f.options), /local Unix-socket/);
});
test('rejects a container from a different Compose project', () => {
  const f = fixture({ mutate: c => { c['111111111111'].Config.Labels['com.docker.compose.project'] = 'school-demo'; } });
  assert.throws(() => assertLocalTestStack(f.options));
});
test('rejects a production or non-demo backend even on a local daemon', () => {
  for (const env of [['NODE_ENV=production', 'CERTIFICATE_DEMO_MODE=true'], ['NODE_ENV=development', 'CERTIFICATE_DEMO_MODE=false']]) {
    const f = fixture({ mutate: c => { c['111111111111'].Config.Env = env; } });
    assert.throws(() => assertLocalTestStack(f.options));
  }
});
test('rejects an origin pointing at another frontend or a public binding', () => {
  for (const binding of [{ HostIp: '127.0.0.1', HostPort: '8888' }, { HostIp: '0.0.0.0', HostPort: '5173' }]) {
    const f = fixture({ mutate: c => { c['222222222222'].NetworkSettings.Ports['80/tcp'] = [binding]; } });
    assert.throws(() => assertLocalTestStack(f.options), /isolated frontend loopback port/);
  }
});

test('failed preflight does not run the restart script cleanup against another project', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'school-guard-'));
  try {
    const marker = path.join(directory, 'docker-invoked');
    fs.writeFileSync(path.join(directory, 'docker'), '#!/bin/sh\nprintf invoked > "$SCHOOL_GUARD_MARKER"\nexit 1\n', { mode: 0o700 });
    const result = spawnSync(process.execPath, [path.join(__dirname, 'test-product-resilience.cjs')], {
      env: { ...process.env, PATH: directory, COMPOSE_PROJECT_NAME: 'school-demo',
        PRODUCT_URL: 'http://localhost:5173', SCHOOL_GUARD_MARKER: marker },
      encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /isolated COMPOSE_PROJECT_NAME/);
    assert.equal(fs.existsSync(marker), false, 'Invalid targets must not trigger cleanup Docker commands');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
