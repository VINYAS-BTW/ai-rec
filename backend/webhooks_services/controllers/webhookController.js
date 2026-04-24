import axios from "axios";
import { db } from "../db/index.js";
import { apps } from "../db/schema.js";
import { z } from "zod";

const registerWebhookSchema = z.object({
  app_name: z.string().trim().min(1),
  webhook_url: z.string().trim().url(),
});

const triggerWebhookSchema = z.object({
  event: z.string().trim().min(1),
  data: z.unknown().optional(),
});

export const registerWebhook = async (req, res) => {
  try {
    const parsed = registerWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request body",
        details: parsed.error.flatten(),
      });
    }
    const { app_name, webhook_url } = parsed.data;

    const [row] = await db
      .insert(apps)
      .values({ app_name, webhook_url })
      .returning({ id: apps.id });
    res.json({ id: row?.id ?? null, message: "Webhook registered successfully" });
  } catch (err) {
    console.error("registerWebhook error:", err);
    res.status(500).json({ error: err.message });
  }
};

export const listWebhooks = async (req, res) => {
  try {
    const rows = await db.select().from(apps);
    res.json(rows);
  } catch (err) {
    console.error("listWebhooks error:", err);
    res.status(500).json({ error: err.message });
  }
};

export const triggerWebhooks = async (req, res) => {
  try {
    const parsed = triggerWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request body",
        details: parsed.error.flatten(),
      });
    }
    const { event, data } = parsed.data;
    const rows = await db.select({ webhook_url: apps.webhook_url }).from(apps);

    const results = [];
    for (const { webhook_url } of rows) {
      try {
        await axios.post(webhook_url, { event, data });
        results.push({ webhook_url, status: "success" });
      } catch (error) {
        results.push({ webhook_url, status: "failed", error: error.message });
      }
    }
    res.json({ message: "Webhooks triggered", results });
  } catch (err) {
    console.error("triggerWebhooks error:", err);
    res.status(500).json({ error: err.message });
  }
};
