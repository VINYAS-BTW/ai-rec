/**
 * Test DB connection using a service's .env file.
 *
 * Run from a backend folder (so "pg" is available):
 *   cd backend/auth && node ../../scripts/test-db-connection.mjs
 *   cd backend/webhooks_services && node ../../scripts/test-db-connection.mjs
 *
 * Or from repo root with a path (requires pg in that service):
 *   node scripts/test-db-connection.mjs backend/auth
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const arg = process.argv[2];
let envPathFinal;
if (!arg) {
  envPathFinal = path.join(process.cwd(), ".env");
} else {
  const base = path.isAbsolute(arg) ? arg : path.join(repoRoot, arg);
  envPathFinal = base.endsWith(".env") ? base : path.join(base, ".env");
}

const loaded = dotenv.config({ path: envPathFinal });
if (loaded.error) {
  console.error("Could not load .env from:", envPathFinal);
  console.error("Error:", loaded.error.message);
  process.exit(1);
}

let url = (process.env.DATABASE_URL || "").trim();
if (!url) {
  console.error("DATABASE_URL is not set in", envPathFinal);
  process.exit(1);
}

// Mask URL for logs: postgresql://user:****@host:5432/dbname
const mask = (u) => {
  try {
    const match = u.match(/^(postgresql:\/\/)([^:]+):([^@]+)@([^/]+)(\/.*)?$/);
    if (match) return `${match[1]}${match[2]}:****@${match[4]}${match[5] || ""}`;
    return u.slice(0, 30) + "…";
  } catch {
    return "(invalid url)";
  }
};

console.log("Env file:", envPathFinal);
console.log("DATABASE_URL:", url === process.env.DATABASE_URL ? "set" : "set (trimmed)");
console.log("Masked URL:", mask(url));
console.log("Length:", url.length);
if (url !== url.trimEnd() || url.includes("\r")) {
  console.warn("WARNING: URL had trailing/CR characters — these were trimmed. Fix .env line endings (use LF, not CRLF).");
}

const pool = new pg.Pool({ connectionString: url });
pool.connect()
  .then((client) => {
    console.log("✅ Connection successful.");
    client.release();
    pool.end();
  })
  .catch((err) => {
    console.error("❌ Connection failed:");
    console.error("   Code:", err.code || "(none)");
    console.error("   Message:", err.message);
    if (err.code === "ENOTFOUND") {
      console.error("\n   → DNS could not resolve the host. Try: different network, Neon 'direct' connection string, or check VPN/firewall.");
    }
    pool.end();
    process.exit(1);
  });
