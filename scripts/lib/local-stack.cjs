const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

// Destructive rehearsals must target a named local test stack, never whichever
// Docker context or Compose project happens to be active in the shell.
function assertLocalTestStack({ root, origin, env = process.env, docker } = {}) {
  const project = env.COMPOSE_PROJECT_NAME;
  assert(['school-ci', 'school-review'].includes(project),
    'Use an isolated COMPOSE_PROJECT_NAME=school-ci or school-review for restart tests');
  const url = new URL(origin);
  assert(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/',
  'Restart tests require the local HTTP frontend origin');
  const run = docker || ((args) => execFileSync('docker', args, {
    cwd: root, env, encoding: 'utf8', timeout: 15000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim());
  const contextName = run(['context', 'show']);
  const context = JSON.parse(run(['context', 'inspect', contextName]))[0];
  const endpoint = env.DOCKER_CONTEXT ? context.Endpoints.docker.Host
    : env.DOCKER_HOST || context.Endpoints.docker.Host;
  assert(endpoint.startsWith('unix://'), 'Restart tests require a local Unix-socket Docker daemon');
  const containers = {};
  for (const service of ['backend', 'frontend', 'postgres', 'blockchain', 'ipfs']) {
    const id = run(['compose', '-p', project, 'ps', '-q', service]);
    assert.match(id, /^[a-f0-9]{12,64}$/, `Expected one running ${service} container`);
    const container = JSON.parse(run(['inspect', id]))[0];
    assert.equal(container.Config.Labels['com.docker.compose.project'], project);
    assert.equal(container.Config.Labels['com.docker.compose.service'], service);
    assert.equal(container.State.Running, true, `${service} must already be running`);
    containers[service] = container;
  }
  const backendEnv = Object.fromEntries(containers.backend.Config.Env.map((entry) => {
    const split = entry.indexOf('=');
    return [entry.slice(0, split), entry.slice(split + 1)];
  }));
  assert.notEqual(backendEnv.NODE_ENV, 'production', 'Never restart a production backend from a test');
  assert.equal(backendEnv.CERTIFICATE_DEMO_MODE, 'true');
  const port = url.port || '80';
  assert((containers.frontend.NetworkSettings.Ports['80/tcp'] || []).some((binding) =>
    binding.HostPort === port && ['127.0.0.1', '::1'].includes(binding.HostIp)),
  'PRODUCT_URL must match the isolated frontend loopback port');
  return project;
}

module.exports = { assertLocalTestStack };
