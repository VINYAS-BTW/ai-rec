import "./loadEnv.js";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import bodyParser from "body-parser";
import { db, ready } from "./db/index.js";
import webhookRoutes from "./routes/webhooks.js";
import appRoutes from "./routes/apps.js";
import recommendRoutes from "./routes/recommend.js";

const app = express();
const PORT = process.env.PORT || 3001;

// Rate limiters: recommend is stricter (per-min), apps/webhooks per 15 min
const recommendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RECOMMEND_RATE_LIMIT_MAX ?? "60", 10),
  message: { error: "Too many requests; try again in a minute." },
  standardHeaders: true,
  legacyHeaders: false,
});
const apiAppsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.API_APPS_RATE_LIMIT_MAX ?? "100", 10),
  message: { error: "Too many requests; try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
const apiWebhooksLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.API_WEBHOOKS_RATE_LIMIT_MAX ?? "50", 10),
  message: { error: "Too many requests; try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

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
  ...(process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim()) : []),
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
  })
);
app.use(bodyParser.json());

app.use("/api/webhooks", apiWebhooksLimiter, webhookRoutes);
app.use("/api/apps", apiAppsLimiter, appRoutes);
app.use("/api/recommend", recommendLimiter, recommendRoutes);

app.get("/", (req, res) => res.send("Webhook service running 🚀"));
app.get("/health", (req, res) => res.json({ ok: true, service: "webhooks" }));

// Keep server reference so process stays alive; start after DB is ready
let server;
ready
  .then(() => {
    server = app.listen(PORT, () => {
      console.log(`Webhook service running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Webhook service failed to start:", err.message);
    if (err.code) console.error("Code:", err.code);
    if (!process.env.DATABASE_URL) {
      console.error("DATABASE_URL is not set. Create backend/webhooks_services/.env with DATABASE_URL=postgresql://...");
    } else if (err.code === "ENOTFOUND" || err.message.includes("getaddrinfo")) {
      console.error("Database host could not be resolved. Check network and that Neon/PostgreSQL is reachable.");
    }
    process.exit(1);
  });