const DEMO_ADMIN_EMAIL = "admin@school-admin.com";
const DEMO_ADMIN_PASSWORD = "3OU4zn3q6Zh9";
const DEMO_ADMIN_HASH = "$argon2id$v=19$m=65536,t=3,p=4$21a+bDbESEI60WO1wRKnvQ$i6OrxqNiHvwtf1Xg3bfU5+AXZG14fegW3p+RSMvq1oU";

async function assertSafeProductionAdmin(db, environment = process.env, verifyPassword) {
  if (environment.NODE_ENV !== "production") return;
  const { rows } = await db.query("SELECT id, email, password FROM users WHERE role_id = 1 AND is_active = TRUE");
  if (!rows.length) throw new Error("No active production administrator. Run npm run bootstrap:admin first.");
  const verify = verifyPassword || require("argon2").verify;
  for (const row of rows) {
    const knownPassword = row.password && await verify(row.password, DEMO_ADMIN_PASSWORD).catch(() => false);
    if (row.email.toLowerCase() === DEMO_ADMIN_EMAIL || row.password === DEMO_ADMIN_HASH || knownPassword) {
      throw new Error("Default demonstration administrator credentials are still active. Run npm run bootstrap:admin before public startup.");
    }
  }
}

module.exports = { DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD, DEMO_ADMIN_HASH, assertSafeProductionAdmin };
