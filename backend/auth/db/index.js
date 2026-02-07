import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/neondb",
});

export const db = drizzle(pool, { schema });
await db.execute(`
  ALTER TABLE auth.users
  ALTER COLUMN password DROP NOT NULL;
`);




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
    client.release();
    console.log("✅ PostgreSQL connected for auth (schema: auth)");
  } catch (err) {
    console.error("PostgreSQL connection error:", err.message);
    process.exit(1);
  }
}
