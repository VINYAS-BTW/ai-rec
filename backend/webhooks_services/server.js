import "./loadEnv.js";
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { db, ready } from "./db/index.js";
import webhookRoutes from "./routes/webhooks.js";
import appRoutes from "./routes/apps.js";
import recommendRoutes from "./routes/recommend.js";

const app = express();
const PORT = process.env.PORT || 3001;

// Prevent process from exiting on unhandled errors (log instead)
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

app.use(cors());
app.use(bodyParser.json());

app.use("/api/webhooks", webhookRoutes);
app.use("/api/apps", appRoutes);
app.use("/api/recommend", recommendRoutes);

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