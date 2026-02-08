/**
 * Load .env from backend/auth/ before any other module runs.
 * Must be imported first in index.js so DATABASE_URL is set when db/index.js loads.
 */
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });
