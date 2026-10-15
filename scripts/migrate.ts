import { Pool } from "pg";
import { readFileSync } from "node:fs";
async function main() {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext('ebg_migrations'))");
    await db.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const applied = await db.query(
      "SELECT version FROM schema_migrations WHERE version=$1",
      ["001"],
    );
    if (!applied.rowCount) {
      await db.query(
        readFileSync("supabase/migrations/001_initial.sql", "utf8"),
      );
      await db.query("INSERT INTO schema_migrations(version) VALUES($1)", [
        "001",
      ]);
    }
    await db.query("COMMIT");
    console.log("Migrations current");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
