import express from "express";
import { and, desc, eq, gte } from "drizzle-orm";
import { registerWebhook, triggerWebhooks, listWebhooks } from "../controllers/webhookController.js";
import { db } from "../db/index.js";
import { eventWindows, featureSummaries } from "../db/schema.js";

const router = express.Router();

router.post("/register", registerWebhook);
router.get("/", listWebhooks);
router.post("/trigger", triggerWebhooks);

router.get("/metrics", async (req, res) => {
	try {
		const windowMinutes = Math.max(5, parseInt(req.query.window_minutes || "60", 10));
		const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000);
		const subjectType = req.query.subject_type ? String(req.query.subject_type) : null;
		const subjectId = req.query.subject_id ? String(req.query.subject_id) : null;

		const eventTypeTotals = await db
			.select()
			.from(featureSummaries)
			.where(eq(featureSummaries.subject_type, "event_type"));

		const summaryConditions = [];
		if (subjectType) summaryConditions.push(eq(featureSummaries.subject_type, subjectType));
		if (subjectId) summaryConditions.push(eq(featureSummaries.subject_id, subjectId));
		const summaryRows = summaryConditions.length
			? await db.select().from(featureSummaries).where(and(...summaryConditions))
			: await db.select().from(featureSummaries).orderBy(desc(featureSummaries.last_event_at)).limit(20);
		const summaries = summaryRows.filter((row) => String(row.subject_type) !== "event_type");

		const windowConditions = [gte(eventWindows.window_start, cutoff)];
		if (subjectType) windowConditions.push(eq(eventWindows.subject_type, subjectType));
		if (subjectId) windowConditions.push(eq(eventWindows.subject_id, subjectId));
		const recentWindows = await db
			.select()
			.from(eventWindows)
			.where(and(...windowConditions))
			.orderBy(desc(eventWindows.window_start))
			.limit(100);

		const anomalies = recentWindows.filter((row) => Number(row.anomaly_score || 0) > 0);

		res.json({
			window_minutes: windowMinutes,
			event_type_totals: eventTypeTotals,
			summaries,
			recent_windows: recentWindows,
			anomalies,
		});
	} catch (error) {
		console.error("Error fetching stream metrics:", error);
		res.status(500).json({ error: "Failed to load stream metrics" });
	}
});

export default router;
