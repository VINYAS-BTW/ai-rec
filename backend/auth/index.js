// Load .env first so DATABASE_URL is set before db/index.js runs (ES modules run imports before other code)
import "./loadEnv.js";

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { connectDB } from "./db/index.js";
import AuthRoute from "./routes/AuthRoute.js";


await connectDB();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(bodyParser.json());

app.use("/auth", AuthRoute);

app.get("/", (req, res) => res.send("pong"));

app.listen(PORT, () =>
  console.log(`✅ Auth service running at http://localhost:${PORT}`)
);
