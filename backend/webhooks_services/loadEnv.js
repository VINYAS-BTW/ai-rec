import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, ".env");
const loaded = dotenv.config({ path: envPath, quiet: true });
if (loaded.error && process.env.NODE_ENV !== "test") {
  console.warn("Webhook service: no .env file at", envPath, "- using process.env / defaults");
}
