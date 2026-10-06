// Isolated schema; invoke with ADMIN_BOOTSTRAP_TEST=true using a local DB only.
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { Pool } = require("pg");
const argon2 = require("argon2");
const { bootstrapAdmin } = require("./src/scripts/bootstrap-admin");
const { assertSafeProductionAdmin, DEMO_ADMIN_EMAIL, DEMO_ADMIN_HASH } = require("./src/security/demo-credentials");

if (process.env.ADMIN_BOOTSTRAP_TEST !== "true" || process.env.NODE_ENV === "production") {
  throw new Error("This integration test requires ADMIN_BOOTSTRAP_TEST=true and a local non-production environment");
}
const schema = `bootstrap_test_${randomBytes(8).toString("hex")}`;
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const isolated = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
const environment = { NODE_ENV: "production", BOOTSTRAP_ADMIN_EMAIL: "private-admin@example.test",
  BOOTSTRAP_ADMIN_PASSWORD: randomBytes(24).toString("base64url"), BOOTSTRAP_ADMIN_NAME: "Private Admin" };

async function main() {
  await db.query(`CREATE SCHEMA ${schema}`);
  await isolated.query(`CREATE TABLE roles(id INTEGER PRIMARY KEY,name TEXT,is_active BOOLEAN);
    CREATE TABLE users(id SERIAL PRIMARY KEY,name TEXT,email TEXT UNIQUE,password TEXT,role_id INTEGER,
      is_active BOOLEAN,is_email_verified BOOLEAN,updated_dt TIMESTAMPTZ);
    CREATE TABLE user_refresh_tokens(user_id INTEGER,token TEXT);
    INSERT INTO roles VALUES(1,'Admin',true),(3,'Student',true)`);
  await isolated.query("INSERT INTO users(name,email,password,role_id,is_active,is_email_verified) VALUES('Demo',$1,$2,1,true,true)", [DEMO_ADMIN_EMAIL, DEMO_ADMIN_HASH]);
  await assert.rejects(assertSafeProductionAdmin(isolated, environment), /Default demonstration/);
  const first = await bootstrapAdmin({ db: isolated, environment });
  assert.equal(first.created, true);
  assert.equal(first.retiredDefaultAccounts, 1);
  const initial = (await isolated.query("SELECT * FROM users WHERE id=$1", [first.adminId])).rows[0];
  assert.equal(await argon2.verify(initial.password, environment.BOOTSTRAP_ADMIN_PASSWORD), true);
  await isolated.query("INSERT INTO user_refresh_tokens VALUES($1,'existing-session')", [first.adminId]);
  const second = await bootstrapAdmin({ db: isolated, environment });
  assert.equal(second.updated, false);
  assert.equal(second.created, false);
  assert.equal((await isolated.query("SELECT password FROM users WHERE id=$1", [first.adminId])).rows[0].password, initial.password);
  assert.equal((await isolated.query("SELECT * FROM user_refresh_tokens")).rowCount, 1);
  environment.BOOTSTRAP_ADMIN_PASSWORD = randomBytes(24).toString("base64url");
  const rotated = await bootstrapAdmin({ db: isolated, environment });
  assert.equal(rotated.updated, true);
  assert.equal(rotated.revokedSessions, 1);
  await assertSafeProductionAdmin(isolated, environment);
  const retired = (await isolated.query("SELECT is_active,password FROM users WHERE email=$1", [DEMO_ADMIN_EMAIL])).rows[0];
  assert.deepEqual(retired, { is_active: false, password: null });
  await isolated.query("INSERT INTO users(name,email,role_id,is_active,is_email_verified) VALUES('Student','student@example.test',3,true,true)");
  await assert.rejects(bootstrapAdmin({ db: isolated, environment: { ...environment, BOOTSTRAP_ADMIN_EMAIL: "student@example.test" } }), /Refusing to promote/);
  assert.equal((await isolated.query("SELECT role_id FROM users WHERE email='student@example.test'")).rows[0].role_id, 3);
  console.log("PASS: real PostgreSQL bootstrap, default-account retirement, idempotence, password rotation/session revocation and privilege protection.");
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  await isolated.end();
  await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await db.end();
});
