const { DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD, DEMO_ADMIN_HASH } = require("../security/demo-credentials");

function readAdminInput(environment) {
  const email = environment.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = environment.BOOTSTRAP_ADMIN_PASSWORD;
  const name = environment.BOOTSTRAP_ADMIN_NAME?.trim() || "School Administrator";
  if (!email || email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("BOOTSTRAP_ADMIN_EMAIL must be a valid email of at most 100 characters");
  if (typeof password !== "string" || password.length < 16 || password.length > 128 || new Set(password).size < 8
      || password === DEMO_ADMIN_PASSWORD || /^(replace[-_ ]?with|change[-_ ]?me|your[-_ ]|password)/i.test(password)) {
    throw new Error("BOOTSTRAP_ADMIN_PASSWORD must be a non-placeholder password of 16 to 128 characters; use a generated secret");
  }
  if (name.length > 100) throw new Error("BOOTSTRAP_ADMIN_NAME must be at most 100 characters");
  if (environment.NODE_ENV === "production" && email === DEMO_ADMIN_EMAIL) throw new Error("Choose a production administrator email different from the default demonstration account");
  return { email, password, name };
}

async function bootstrapAdmin({ db, environment = process.env, hash, verify }) {
  const input = readAdminInput(environment);
  const argon2 = (!hash || !verify) ? require("argon2") : null;
  hash ||= argon2.hash;
  verify ||= argon2.verify;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(732941, 2)");
    const { rows: roles } = await client.query("SELECT id FROM roles WHERE id = 1 AND lower(name) = 'admin' AND is_active = TRUE FOR SHARE");
    if (!roles.length) throw new Error("An active reserved Admin role (ID 1) is required; initialize the database first");
    const { rows: existing } = await client.query("SELECT id, role_id, name, email, password, is_active, is_email_verified FROM users WHERE lower(email) = $1 FOR UPDATE", [input.email]);
    if (existing.length > 1) throw new Error("Ambiguous administrator email; resolve duplicate case variants first");
    const account = existing[0];
    if (account && account.role_id !== 1) throw new Error("Refusing to promote an existing non-administrator account");
    const samePassword = account?.password && await verify(account.password, input.password).catch(() => false);
    const changed = !account || !samePassword || account.name !== input.name || account.email !== input.email
      || !account.is_active || !account.is_email_verified;
    let adminId = account?.id;
    if (!account) {
      const passwordHash = await hash(input.password);
      const { rows } = await client.query(`INSERT INTO users(name, email, password, role_id, is_active, is_email_verified)
        VALUES ($1, $2, $3, 1, TRUE, TRUE) RETURNING id`, [input.name, input.email, passwordHash]);
      adminId = rows[0].id;
    } else if (changed) {
      await client.query(`UPDATE users SET name = $1, email = $2, password = $3, is_active = TRUE,
        is_email_verified = TRUE, updated_dt = NOW() WHERE id = $4`,
      [input.name, input.email, samePassword ? account.password : await hash(input.password), adminId]);
    }
    // Preserve historical foreign keys while disabling the seeded account and
    // removing its public fixed password. Local startup never runs this script.
    const { rows: retired } = await client.query(`UPDATE users SET is_active = FALSE, password = NULL, updated_dt = NOW()
      WHERE id <> $1 AND (lower(email) = $2 OR password = $3) AND (is_active = TRUE OR password IS NOT NULL) RETURNING id`,
    [adminId, DEMO_ADMIN_EMAIL, DEMO_ADMIN_HASH]);
    const revokeIds = [...retired.map((row) => row.id), ...(changed ? [adminId] : [])];
    // Revoke stale sessions even when the default account was already disabled.
    const { rowCount: revokedSessions } = await client.query(`DELETE FROM user_refresh_tokens
      WHERE user_id = ANY($1::int[]) OR user_id IN (SELECT id FROM users WHERE lower(email) = $2 AND id <> $3)`,
    [revokeIds, DEMO_ADMIN_EMAIL, adminId]);
    await client.query("COMMIT");
    return { adminId, created: !account, updated: Boolean(account && changed), retiredDefaultAccounts: retired.length, revokedSessions };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  require("dotenv").config();
  const { db } = require("../config/db");
  bootstrapAdmin({ db }).then((result) => {
    console.log(JSON.stringify({ status: "Administrator initialized", ...result }));
  }).catch((error) => {
    // Database errors can contain statement parameters; never print the error object.
    console.error("Administrator initialization failed:", error.code ? "Database operation failed" : error.message);
    process.exitCode = 1;
  }).finally(() => db.end());
}

module.exports = { bootstrapAdmin, readAdminInput };
