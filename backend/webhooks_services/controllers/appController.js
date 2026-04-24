import crypto from "crypto";
import { db } from "../db/index.js";
import { apps, usage } from "../db/schema.js";
import { z } from "zod";

const registerAppSchema = z.object({
  app_name: z.string().trim().min(1),
  webhook_url: z.string().trim().url(),
});

export const registerApp = async (req, res) => {
  try {
    const parsed = registerAppSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request body",
        details: parsed.error.flatten(),
      });
    }
    const { app_name, webhook_url } = parsed.data;

    const apiKey = crypto.randomBytes(16).toString("hex");

    await db.insert(apps).values({ app_name, webhook_url, api_key: apiKey });

    console.log("✅ App registered:", { app_name, webhook_url, apiKey });

    res.json({
      success: true,
      message: "App registered successfully",
      app_name,
      webhook_url,
      api_key: apiKey,
    });
  } catch (err) {
    console.error("❌ registerApp error:", err);
    res.status(500).json({ error: "Failed to register app" });
  }
};

export const getAppUsage = async (req, res) => {
  try {
    const rows = await db.select().from(usage);
    res.json(rows || []);
  } catch (error) {
    console.error("getAppUsage error:", error);
    res.status(500).json({ error: "Failed to load app usage" });
  }
};
