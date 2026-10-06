
const env = {
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_ACCESS_TOKEN_SECRET: process.env.JWT_ACCESS_TOKEN_SECRET,
  JWT_REFRESH_TOKEN_SECRET: process.env.JWT_REFRESH_TOKEN_SECRET,
  CSRF_TOKEN_SECRET: process.env.CSRF_TOKEN_SECRET,
  JWT_ACCESS_TOKEN_TIME_IN_MS: process.env.JWT_ACCESS_TOKEN_TIME_IN_MS,
  JWT_REFRESH_TOKEN_TIME_IN_MS: process.env.JWT_REFRESH_TOKEN_TIME_IN_MS,
  CSRF_TOKEN_TIME_IN_MS: process.env.CSRF_TOKEN_TIME_IN_MS,
  MAIL_FROM_USER: process.env.MAIL_FROM_USER,
  EMAIL_VERIFICATION_TOKEN_SECRET: process.env.EMAIL_VERIFICATION_TOKEN_SECRET,
  EMAIL_VERIFICATION_TOKEN_TIME_IN_MS:
    process.env.EMAIL_VERIFICATION_TOKEN_TIME_IN_MS,
  PASSWORD_SETUP_TOKEN_TIME_IN_MS: process.env.PASSWORD_SETUP_TOKEN_TIME_IN_MS,
  PASSWORD_SETUP_TOKEN_SECRET: process.env.PASSWORD_SETUP_TOKEN_SECRET,
  UI_URL: process.env.UI_URL,
  API_URL: process.env.API_URL,
  COOKIE_DOMAIN: process.env.COOKIE_DOMAIN,
  COOKIE_SECURE: process.env.COOKIE_SECURE,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
};

const assertProductionConfig = (config = env) => {
  if (config.NODE_ENV !== "production") return;
  const requiredSecrets = [
    "JWT_ACCESS_TOKEN_SECRET",
    "JWT_REFRESH_TOKEN_SECRET",
    "CSRF_TOKEN_SECRET",
    "EMAIL_VERIFICATION_TOKEN_SECRET",
    "PASSWORD_SETUP_TOKEN_SECRET",
  ];
  const placeholder = /^(local-compose-|your_|replace-with-|re_your_|change[-_]?me|test[-_])/i;
  const invalid = requiredSecrets.filter((key) => {
    const value = config[key];
    return typeof value !== "string" || value.length < 32 || new Set(value).size < 12 || placeholder.test(value);
  });
  if (invalid.length > 0) {
    throw new Error(`Production secrets must be long random values: ${invalid.join(", ")}`);
  }
  if (new Set(requiredSecrets.map((key) => config[key])).size !== requiredSecrets.length) {
    throw new Error("Production token and CSRF secrets must be distinct");
  }
  if (config.COOKIE_SECURE !== undefined && config.COOKIE_SECURE !== "true") {
    throw new Error("COOKIE_SECURE must be true in production");
  }
  if (config.COOKIE_DOMAIN) throw new Error("Production cookies must be host-only; leave COOKIE_DOMAIN empty");
  for (const key of ["UI_URL", "API_URL"]) {
    let url;
    try { url = new URL(config[key]); } catch (_error) { throw new Error(`${key} must be a valid HTTPS URL`); }
    if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) {
      throw new Error(`${key} must be an HTTPS URL without credentials, query or fragment`);
    }
  }
  for (const key of ["JWT_ACCESS_TOKEN_TIME_IN_MS", "JWT_REFRESH_TOKEN_TIME_IN_MS", "CSRF_TOKEN_TIME_IN_MS",
    "EMAIL_VERIFICATION_TOKEN_TIME_IN_MS", "PASSWORD_SETUP_TOKEN_TIME_IN_MS"]) {
    const value = Number(config[key]);
    if (!Number.isSafeInteger(value) || value < 1000 || value > 30 * 24 * 60 * 60 * 1000) {
      throw new Error(`${key} must be a duration from one second to 30 days`);
    }
  }
  if (Number(config.JWT_REFRESH_TOKEN_TIME_IN_MS) < Number(config.JWT_ACCESS_TOKEN_TIME_IN_MS)
      || Number(config.CSRF_TOKEN_TIME_IN_MS) < Number(config.JWT_ACCESS_TOKEN_TIME_IN_MS)) {
    throw new Error("Refresh and CSRF lifetimes must cover the access-token lifetime");
  }
};

module.exports = { env, assertProductionConfig };
