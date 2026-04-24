import express from "express";
import { db } from "../db/index.js";
import { apps, usage } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";
import axios from "axios";
import { emitEvent } from "../kafka/producer.js";
import { cacheGetOrSet } from "../utils/cache.js";
import { z } from "zod";

const router = express.Router();
const recommendBodySchema = z.object({
  project_id: z.coerce.number().int().positive(),
  item_title: z.string().trim().min(1).optional(),
  user_id: z.union([z.string(), z.number()]).optional(),
  session_id: z.union([z.string(), z.number()]).optional(),
  correlation_id: z.union([z.string(), z.number()]).optional(),
});

router.post("/", async (req, res) => {
  const apiKey = req.headers["x-api-key"];
  const parsedBody = recommendBodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsedBody.error.flatten(),
    });
  }
  const { project_id, item_title, user_id, session_id, correlation_id } =
    parsedBody.data;

  console.log("📥 Incoming request:", { project_id, item_title, user_id });

  if (!apiKey) {
    console.log("❌ Missing API key");
    return res.status(401).json({ error: "Missing API key" });
  }

  try {
    console.log("🔑 Validating API key...");
    const rows = await db
      .select()
      .from(apps)
      .where(eq(apps.api_key, apiKey))
      .limit(1);
    const app = rows[0] ?? null;
    if (!app) {
      console.log("❌ Invalid API key");
      return res.status(403).json({ error: "Invalid API key" });
    }
    console.log("✅ API key valid for app:", app.app_name);

    const baseUrl = process.env.FASTAPI_URL || "http://localhost:8000";
    const fastapiUrl = `${baseUrl.replace(/\/$/, "")}/project/${project_id}/recommendations`;
    const params = { n: 10 };
    if (item_title) params.item_title = item_title;
    if (user_id) params.user_id = user_id;

    const headers = {};
    if (process.env.BACK2_INTERNAL_KEY) {
      headers["X-Internal-Key"] = process.env.BACK2_INTERNAL_KEY;
    }

    const recData = await cacheGetOrSet(
      { project_id, item_title, user_id },
      async () => {
        console.log("📡 Calling FastAPI:", fastapiUrl, params);
        const recRes = await axios.get(fastapiUrl, { params, headers });
        return recRes.data;
      },
    );
    console.log("✅ FastAPI response:", Object.keys(recData));

    await db
      .insert(usage)
      .values({ app_name: app.app_name, usage_count: 1 })
      .onConflictDoUpdate({
        target: usage.app_name,
        set: { usage_count: sql`${usage.usage_count} + 1` },
      });

    emitEvent({
      event_type: "recommendation_served",
      source_service: "webhooks-service",
      api_route: req.originalUrl,
      project_id: req.project?.id || req.body.project_id || null,
      user_id: user_id || null,
      app_name: app.app_name,
      _raw_api_key: req.rawApiKey || apiKey || null,
      session_id: session_id || req.headers["x-session-id"] || null,
      correlation_id: correlation_id || req.headers["x-correlation-id"] || null,
      recommendation_count: (
        recData.recommendations ||
        recData.data?.recommendations ||
        []
      ).length,
      recommendations_preview: (
        recData.recommendations ||
        recData.data?.recommendations ||
        []
      )
        .slice(0, 5)
        .map((r) => ({
          item_id: r.id || r.item_id || null,
          title: r.title || null,
          score: r.score ?? null,
        })),
      metadata: { request_body_keys: Object.keys(req.body) },
    }).catch(() => {
      /* already logged inside emitEvent */
    });

    res.json({
      success: true,
      app_name: app.app_name,
      model_type: recData.model_type || recData.data?.model_type || "content",
      recommendations:
        recData.recommendations || recData.data?.recommendations || [],
    });

    axios
      .post(app.webhook_url, {
        success: true,
        app_name: app.app_name,
        model_type: recData.model_type || recData.data?.model_type || "content",
        recommendations:
          recData.recommendations || recData.data?.recommendations || [],
      })
      .then(() => console.log(`✅ Webhook sent to ${app.webhook_url}`))
      .catch((err) => console.warn(`⚠️ Webhook push failed: ${err.message}`));
  } catch (err) {
    console.error("🚨 Recommend route error:", err);

    if (err.response) {
      const status = err.response.status;
      const errorData = err.response.data;
      console.error("❌ FastAPI error:", status, errorData);

      if (status === 404) {
        return res.status(404).json({
          error: "Project not found or not ready",
          details:
            errorData?.detail ||
            "The project ID you specified doesn't exist or isn't ready",
        });
      }

      return res.status(status).json({
        error: "Failed to get recommendations",
        details: errorData?.detail || err.message,
      });
    }

    res
      .status(500)
      .json({ error: "Failed to get recommendations", details: err.message });
  }
});

export default router;
