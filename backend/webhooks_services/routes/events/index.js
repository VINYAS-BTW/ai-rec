import express from "express";
import { emitEvent } from "../../kafka/producer.js";

const router = express.Router();

// ─── Shared enrichment helper ─────────────────────────────────────────────────

function buildPartialEvent(req, eventType, extra = {}) {
  return {
    event_type: eventType,
    source_service: "webhooks-service",
    api_route: req.originalUrl,
    // Identity — pull from verified API-key context attached by apiKeyMiddleware
    project_id: req.project?.id || req.body.project_id || null,
    user_id: req.body.user_id || null,
    app_name: req.appContext?.name || req.body.app_name || null,
    // Raw key is hashed inside emitEvent(); never logged elsewhere
    _raw_api_key: req.rawApiKey || null,
    session_id: req.body.session_id || req.headers["x-session-id"] || null,
    correlation_id: req.body.correlation_id || req.headers["x-correlation-id"] || null,
    metadata: req.body.metadata || {},
    ...extra,
  };
}


router.post("/click", async (req, res, next) => {
  try {
    const { item_id, item_title } = req.body;

    // Fast early rejection before touching Kafka
    if (!item_id) {
      return res.status(400).json({ error: "item_id is required for click events" });
    }

    const partial = buildPartialEvent(req, "click", { item_id, item_title: item_title || null });

    // throwOnValidation=true → emitEvent throws with .status=400 on schema failure
    const eventId = await emitEvent(partial, { throwOnValidation: true });

    return res.status(202).json({ status: "accepted", event_id: eventId });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.post("/skip", async (req, res, next) => {
  try {
    const { item_id, item_title } = req.body;
    if (!item_id) {
      return res.status(400).json({ error: "item_id is required for skip events" });
    }

    const partial = buildPartialEvent(req, "skip", { item_id, item_title: item_title || null });
    const eventId = await emitEvent(partial, { throwOnValidation: true });
    return res.status(202).json({ status: "accepted", event_id: eventId });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.post("/dwell", async (req, res, next) => {
  try {
    const { item_id, item_title, dwell_time_ms, dwell_time_seconds } = req.body;
    if (!item_id) {
      return res.status(400).json({ error: "item_id is required for dwell events" });
    }

    const dwellMs = dwell_time_ms != null ? Number(dwell_time_ms) : (dwell_time_seconds != null ? Number(dwell_time_seconds) * 1000 : NaN);
    if (!Number.isFinite(dwellMs) || dwellMs <= 0) {
      return res.status(400).json({ error: "dwell_time_ms or dwell_time_seconds must be a positive number" });
    }

    const partial = buildPartialEvent(req, "dwell", {
      item_id,
      item_title: item_title || null,
      dwell_time_ms: Math.round(dwellMs),
    });
    const eventId = await emitEvent(partial, { throwOnValidation: true });
    return res.status(202).json({ status: "accepted", event_id: eventId });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// ─── POST /api/events/rating ──────────────────────────────────────────────────

router.post("/rating", async (req, res, next) => {
  try {
    const { item_id, item_title, rating_value } = req.body;

    if (!item_id) {
      return res.status(400).json({ error: "item_id is required for rating events" });
    }
    if (rating_value === undefined || rating_value === null) {
      return res.status(400).json({ error: "rating_value is required" });
    }
    const ratingNum = parseFloat(rating_value);
    if (isNaN(ratingNum)) {
      return res.status(400).json({ error: "rating_value must be a number" });
    }

    const partial = buildPartialEvent(req, "rating", {
      item_id,
      item_title: item_title || null,
      rating_value: ratingNum,
    });

    // Schema validator enforces min/max range; throws 400 if out of range
    const eventId = await emitEvent(partial, { throwOnValidation: true });

    return res.status(202).json({ status: "accepted", event_id: eventId });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

export default router;