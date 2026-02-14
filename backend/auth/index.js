// Load .env first so DATABASE_URL is set before db/index.js runs (ES modules run imports before other code)
import "./loadEnv.js";

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import bodyParser from "body-parser";
import { connectDB } from "./db/index.js";
import AuthRoute from "./routes/AuthRoute.js";


await connectDB();

const app = express();
const PORT = process.env.PORT || 8080;

// Rate limit auth (login, signup, OAuth) to reduce brute-force and abuse
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX ?? "50", 10),
  message: { success: false, message: "Too many attempts; try again later." },
  standardHeaders: true,
  legacyHeaders: false,
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
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(bodyParser.json());

app.use("/auth", authLimiter, AuthRoute);

app.get("/", (req, res) => res.send("pong"));

app.listen(PORT, () =>
  console.log(`✅ Auth service running at http://localhost:${PORT}`)
);
