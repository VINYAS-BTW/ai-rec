// .env is loaded by auth/index.js from backend/auth/ before this file is imported — do not use dotenv/config here (cwd can override)
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

export async function connectDB() {
  try {
    const client = await pool.connect();
    await client.query("CREATE SCHEMA IF NOT EXISTS auth;");
    await client.query(`
      CREATE TABLE IF NOT EXISTS auth.users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`
      ALTER TABLE auth.users
      ALTER COLUMN password DROP NOT NULL;
    `).catch(() => { /* column may already be nullable */ });
    client.release();
    console.log("PostgreSQL connected for auth (schema: auth)");
  } catch (err) {
    const msg = err?.message || String(err);
    const code = err?.code;
    console.error("PostgreSQL connection error:", msg || "(no message)");
    if (code) console.error("  Code:", code);
    if (!msg && err) console.error("  Error:", err);
    if (code === "ENOTFOUND" || (msg && msg.includes("getaddrinfo ENOTFOUND"))) {
      console.error("  → Hostname could not be resolved (DNS). Use the same DATABASE_URL as back2/webhooks (e.g. Neon direct connection) in backend/auth/.env");
    }
    if (code === "ECONNREFUSED" || (msg && msg.includes("ECONNREFUSED"))) {
      console.error("  → Connection refused. Check DATABASE_URL in backend/auth/.env matches your Neon (or Postgres) URL.");
    }
    if (msg && (msg.includes("certificate") || msg.includes("SSL") || msg.includes("TLS"))) {
      console.error("  → SSL issue. Ensure backend/auth/.env has the same DATABASE_URL as back2 (with ?sslmode=require or as from Neon).");
    }
    process.exit(1);
  }
}
