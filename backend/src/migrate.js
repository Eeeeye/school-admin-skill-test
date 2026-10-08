const fs = require("node:fs/promises");
const path = require("node:path");

// One connection and an advisory lock serialize migrations across app replicas.
// Each file and its tracking record commit together; failed upgrades roll back.
async function migrate(db, directory = process.env.DB_MIGRATIONS_DIR || path.resolve(__dirname, "../../seed_db/migrations")) {
  const files = (await fs.readdir(directory)).filter((file) => /^\d+.*\.sql$/.test(file)).sort();
  const client = await db.connect();
  try {
    await client.query("SELECT pg_advisory_lock(723091)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    for (const file of files) {
      const applied = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
      if (applied.rowCount) continue;
      const sql = await fs.readFile(path.join(directory, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`Applied database migration: ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    let releaseError;
    try { await client.query("SELECT pg_advisory_unlock(723091)"); }
    catch (error) { releaseError = error; }
    // Never recycle a session that may still own the migration lock.
    client.release(releaseError);
  }
}

module.exports = { migrate };

if (require.main === module) {
  require("dotenv").config();
  const { db } = require("./config");
  migrate(db).catch((error) => {
    console.error("Database migration failed:", error.message);
    process.exitCode = 1;
  }).finally(() => db.end());
}
