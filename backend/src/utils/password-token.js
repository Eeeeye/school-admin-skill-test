const { createHmac, timingSafeEqual } = require("node:crypto");
const { env } = require("../config/env");

// Bind a setup/reset link to the current credential state. A successful password
// change replaces the salted hash, invalidating every previously issued link.
const passwordTokenFingerprint = (user, purpose) => createHmac(
  "sha256", env.PASSWORD_SETUP_TOKEN_SECRET
).update(JSON.stringify([user.id, user.email, user.password ?? null, purpose])).digest("hex");

const matchesPasswordToken = (user, purpose, fingerprint) => {
  if (typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint)) {
    return false;
  }
  const expected = passwordTokenFingerprint(user, purpose);
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(fingerprint, "hex"));
};

module.exports = { passwordTokenFingerprint, matchesPasswordToken };
