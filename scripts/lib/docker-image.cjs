const DIGEST = /^sha256:[a-f0-9]{64}$/;
const PLATFORM_PART = /^[a-z0-9][a-z0-9._-]*$/;

function sourcePlatform(descriptor) {
  if (!descriptor?.platform) return undefined;
  const { os, architecture, variant } = descriptor.platform;
  const parts = [os, architecture, ...(variant ? [variant] : [])];
  if (parts.some((part) => typeof part !== 'string' || !PLATFORM_PART.test(part))) {
    throw new Error('Container image platform is invalid');
  }
  return parts.join('/');
}

/**
 * Resolve an immutable, locally usable reference for an existing container.
 * inspectImage(args) runs `docker image inspect ...args` and returns its single
 * parsed image object. It must not pull images or silently substitute a tag.
 * Returns { image, platform? }, suitable for a pull_policy: never Compose service.
 */
async function resolveContainerImage(container, inspectImage) {
  const sourceImage = container?.Image;
  if (typeof sourceImage !== 'string' || !DIGEST.test(sourceImage)) {
    throw new Error('Container image must identify an immutable SHA-256 digest');
  }
  const descriptor = container.ImageManifestDescriptor;
  const platform = sourcePlatform(descriptor);
  let direct;
  try {
    direct = await inspectImage([sourceImage]);
  } catch (error) {
    // Only an absent image warrants resolution through the original name.
    // Permission, daemon and transport errors must not be mistaken for absence.
    if (!/no such image|image .* not found/i.test(error.message || '')) throw error;
  }
  if (direct) {
    if (direct.Id !== sourceImage) {
      throw new Error('Immutable image inspection returned a different image identity');
    }
    return { image: sourceImage, ...(platform ? { platform } : {}) };
  }

  // With Docker's containerd store, Container.Image can be a config digest
  // while only the surrounding image index is addressable. Resolve the tag
  // once, then verify its immutable index still contains this exact manifest.
  if (!platform || !DIGEST.test(descriptor?.digest || '')) {
    throw new Error('Original image is unavailable and the container has no verifiable manifest/platform');
  }
  const configuredImage = container.Config?.Image;
  if (typeof configuredImage !== 'string' || !configuredImage.trim()) {
    throw new Error('Original image is unavailable and the container has no configured image reference');
  }
  const candidate = await inspectImage([configuredImage]);
  if (!DIGEST.test(candidate?.Id || '')) {
    throw new Error('Resolved image does not have an immutable SHA-256 identity');
  }
  const pinned = await inspectImage(['--platform', platform, candidate.Id]);
  if (pinned?.Descriptor?.digest !== descriptor.digest) {
    throw new Error('Configured image no longer matches the running container manifest; preserve the original image before recovery');
  }
  return { image: candidate.Id, platform };
}

module.exports = { resolveContainerImage };
