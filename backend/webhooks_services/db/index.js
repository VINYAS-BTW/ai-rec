import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

// Trim in case .env has Windows CRLF or trailing space (invalid hostname → ENOTFOUND)
let connectionString = (process.env.DATABASE_URL || "postgresql://localhost:5432/neondb").trim();
if (connectionString.includes("sslmode=require") && !connectionString.includes("sslmode=verify-full")) {
  connectionString = connectionString.replace(/sslmode=require/g, "sslmode=verify-full");
}
const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });

const ready = (async () => {
  const client = await pool.connect();
  try {
    await client.query("CREATE SCHEMA IF NOT EXISTS webhooks;");
    await client.query(`
      CREATE TABLE IF NOT EXISTS webhooks.apps (
        id SERIAL PRIMARY KEY,
        app_name TEXT,
        webhook_url TEXT,
        api_key TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS webhooks.usage (
        id SERIAL PRIMARY KEY,
        app_name TEXT UNIQUE,
        usage_count INTEGER DEFAULT 0
      );
    `);
    console.log("✅ PostgreSQL ready: schema webhooks (tables apps & usage)");
  } finally {
    client.release();
  }
  return pool;
})();

export { ready };
