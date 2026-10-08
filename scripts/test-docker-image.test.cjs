const assert = require('node:assert/strict');
const test = require('node:test');
const { resolveContainerImage } = require('./lib/docker-image.cjs');

const digest = (character) => `sha256:${character.repeat(64)}`;
const configId = digest('a');
const indexId = digest('b');
const manifestId = digest('c');
const containerd = () => ({
  Image: configId,
  Config: { Image: 'school-review-frontend:latest' },
  ImageManifestDescriptor: {
    digest: manifestId,
    platform: { os: 'linux', architecture: 'arm64', variant: 'v8' },
  },
});
const absent = () => { throw new Error(`Error response from daemon: No such image: ${configId}`); };

test('classic image storage reuses the immutable container image, never its tag', async () => {
  const calls = [];
  const result = await resolveContainerImage({ Image: configId, Config: { Image: 'moved:latest' } }, async (args) => {
    calls.push(args);
    return { Id: configId };
  });
  assert.deepEqual(result, { image: configId });
  assert.deepEqual(calls, [[configId]]);
});

test('an addressable index retains the original container platform', async () => {
  const source = containerd();
  source.Image = indexId;
  const result = await resolveContainerImage(source, async () => ({ Id: indexId }));
  assert.deepEqual(result, { image: indexId, platform: 'linux/arm64/v8' });
});

test('containerd resolves a tag once and verifies the pinned index manifest', async () => {
  const calls = [];
  const result = await resolveContainerImage(containerd(), async (args) => {
    calls.push(args);
    if (args[0] === configId) return absent();
    if (args[0] === 'school-review-frontend:latest') return { Id: indexId };
    assert.deepEqual(args, ['--platform', 'linux/arm64/v8', indexId]);
    return { Id: manifestId, Descriptor: { digest: manifestId } };
  });
  assert.deepEqual(result, { image: indexId, platform: 'linux/arm64/v8' });
  assert.deepEqual(calls, [[configId], ['school-review-frontend:latest'], ['--platform', 'linux/arm64/v8', indexId]]);
});

test('a moved tag cannot substitute a different image during recovery', async () => {
  await assert.rejects(resolveContainerImage(containerd(), async (args) => {
    if (args[0] === configId) return absent();
    if (args[0] === 'school-review-frontend:latest') return { Id: indexId };
    return { Id: digest('d'), Descriptor: { digest: digest('d') } };
  }), /no longer matches the running container manifest/);
});

test('missing source manifest or platform fails before consulting a mutable tag', async () => {
  for (const descriptor of [undefined, { digest: manifestId }, { platform: { os: 'linux', architecture: 'arm64' } }]) {
    const calls = [];
    await assert.rejects(resolveContainerImage({ ...containerd(), ImageManifestDescriptor: descriptor }, async (args) => {
      calls.push(args);
      return absent();
    }), /no verifiable manifest\/platform/);
    assert.deepEqual(calls, [[configId]]);
  }
});

test('missing descriptor on the resolved index fails closed', async () => {
  await assert.rejects(resolveContainerImage(containerd(), async (args) => {
    if (args[0] === configId) return absent();
    return { Id: indexId };
  }), /no longer matches/);
});

test('permission errors are not treated as absent images', async () => {
  let calls = 0;
  await assert.rejects(resolveContainerImage(containerd(), async () => {
    calls++;
    throw new Error('permission denied while trying to connect to Docker');
  }), /permission denied/);
  assert.equal(calls, 1);
});

test('invalid immutable identities and unexpected direct resolution are rejected', async () => {
  await assert.rejects(resolveContainerImage({ Image: 'latest' }, async () => assert.fail()), /immutable SHA-256/);
  await assert.rejects(resolveContainerImage({ Image: configId }, async () => ({ Id: indexId })), /different image identity/);
  await assert.rejects(resolveContainerImage(containerd(), async (args) => {
    if (args[0] === configId) return absent();
    return { Id: 'latest' };
  }), /immutable SHA-256/);
});
