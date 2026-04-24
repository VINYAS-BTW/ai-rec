import "./loadEnv.js";
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { db, ready } from "./db/index.js";
import webhookRoutes from "./routes/webhooks.js";
import appRoutes from "./routes/apps.js";
import recommendRoutes from "./routes/recommend.js";
import { eq } from "drizzle-orm";
import { connectProducer, disconnectProducer } from "./kafka/producer.js";
import eventRoutes from "./routes/events/index.js";

const app = express();
const PORT = process.env.PORT || 3001;

async function apiKeyMiddleware(req, res, next) {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey) {
    return res.status(401).json({ error: "Missing API key" });
  }

  try {
    const rows = await db
      .select()
      .from((await import("./db/schema.js")).apps)
      .where(eq((await import("./db/schema.js")).apps.api_key, apiKey))
      .limit(1);
    const appRow = rows[0] ?? null;
    if (!appRow) {
      return res.status(403).json({ error: "Invalid API key" });
    }

    req.appContext = { name: appRow.app_name, webhook_url: appRow.webhook_url };
    req.rawApiKey = apiKey;
    next();
  } catch (error) {
    console.error("API key middleware error:", error);
    res.status(500).json({ error: "Failed to validate API key" });
  }
}

// Prevent process from exiting on unhandled errors (log instead)
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

// Explicit origins so browser gets a concrete Access-Control-Allow-Origin (avoids CORS errors)
const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  ...(process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim())
    : []),
];
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Internal-Key"],
  }),
);
app.use(bodyParser.json());

app.use("/api/webhooks", webhookRoutes);
app.use("/api/apps", appRoutes);
app.use("/api/recommend", recommendRoutes);
app.use("/api/events", apiKeyMiddleware, eventRoutes);

app.get("/", (req, res) => res.send("Webhook service running 🚀"));
app.get("/health", (req, res) => res.json({ ok: true, service: "webhooks" }));

// Keep server reference so process stays alive; start after DB is ready
let server;

async function startServer() {
  await connectProducer();
  await ready;

  server = app.listen(PORT, () => {
    console.log(`Webhook service running at http://localhost:${PORT}`);
  });
}

async function gracefulShutdown(signal) {
  console.info(`[server] ${signal} — starting graceful shutdown`);
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await disconnectProducer();
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

startServer().catch((err) => {
  console.error("Webhook service failed to start:", err.message);
  if (err.code) console.error("Code:", err.code);
  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is not set. Create backend/webhooks_services/.env with DATABASE_URL=postgresql://...",
    );
  } else if (err.code === "ENOTFOUND" || err.message.includes("getaddrinfo")) {
    console.error(
      "Database host could not be resolved. Check network and that Neon/PostgreSQL is reachable.",
    );
  }
  process.exit(1);
});
