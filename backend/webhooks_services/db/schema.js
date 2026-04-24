import { pgSchema, serial, text, integer, timestamp, uuid, varchar, numeric, jsonb } from "drizzle-orm/pg-core";

export const webhooksSchema = pgSchema("webhooks");

export const apps = webhooksSchema.table("apps", {
  id: serial("id").primaryKey(),
  app_name: text("app_name"),
  webhook_url: text("webhook_url"),
  api_key: text("api_key"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const usage = webhooksSchema.table("usage", {
  id: serial("id").primaryKey(),
  app_name: text("app_name").notNull().unique(),
  usage_count: integer("usage_count").default(0),
});

export const eventLogs = webhooksSchema.table("event_logs", {
  event_id: uuid("event_id").primaryKey(),
  event_type: varchar("event_type", { length: 64 }).notNull(),
  schema_version: integer("schema_version").notNull().default(1),
  occurred_at: timestamp("occurred_at", { withTimezone: true }).notNull(),
  source_service: varchar("source_service", { length: 128 }).notNull(),
  api_route: varchar("api_route", { length: 256 }),
  project_id: integer("project_id"),
  user_id: varchar("user_id", { length: 255 }),
  app_name: varchar("app_name", { length: 255 }),
  api_key_hash: varchar("api_key_hash", { length: 64 }),
  session_id: varchar("session_id", { length: 255 }),
  correlation_id: varchar("correlation_id", { length: 255 }),
  item_id: varchar("item_id", { length: 255 }),
  item_title: varchar("item_title", { length: 512 }),
  rating_value: numeric("rating_value", { precision: 5, scale: 2 }),
  dwell_time_ms: integer("dwell_time_ms"),
  recommendation_count: integer("recommendation_count"),
  recommendations_preview: jsonb("recommendations_preview"),
  metadata: jsonb("metadata").notNull().default({}),
  inserted_at: timestamp("inserted_at", { withTimezone: true }).defaultNow().notNull(),
});

export const featureSummaries = webhooksSchema.table("feature_summaries", {
  subject_type: varchar("subject_type", { length: 32 }).notNull(),
  subject_id: varchar("subject_id", { length: 255 }).notNull(),
  schema_version: integer("schema_version").notNull().default(1),
  event_count: integer("event_count").notNull().default(0),
  click_count: integer("click_count").notNull().default(0),
  rating_count: integer("rating_count").notNull().default(0),
  skip_count: integer("skip_count").notNull().default(0),
  dwell_count: integer("dwell_count").notNull().default(0),
  served_count: integer("served_count").notNull().default(0),
  rating_sum: numeric("rating_sum", { precision: 12, scale: 2 }).notNull().default(0),
  dwell_sum_ms: integer("dwell_sum_ms").notNull().default(0),
  avg_rating: numeric("avg_rating", { precision: 12, scale: 2 }),
  last_event_at: timestamp("last_event_at", { withTimezone: true }).defaultNow().notNull(),
});

export const eventWindows = webhooksSchema.table("event_windows", {
  subject_type: varchar("subject_type", { length: 32 }).notNull(),
  subject_id: varchar("subject_id", { length: 255 }).notNull(),
  window_start: timestamp("window_start", { withTimezone: true }).notNull(),
  schema_version: integer("schema_version").notNull().default(1),
  event_count: integer("event_count").notNull().default(0),
  click_count: integer("click_count").notNull().default(0),
  rating_count: integer("rating_count").notNull().default(0),
  skip_count: integer("skip_count").notNull().default(0),
  dwell_count: integer("dwell_count").notNull().default(0),
  served_count: integer("served_count").notNull().default(0),
  rating_sum: numeric("rating_sum", { precision: 12, scale: 2 }).notNull().default(0),
  dwell_sum_ms: integer("dwell_sum_ms").notNull().default(0),
  anomaly_score: numeric("anomaly_score", { precision: 12, scale: 2 }),
  last_event_at: timestamp("last_event_at", { withTimezone: true }).defaultNow().notNull(),
});

export const retrainState = webhooksSchema.table("retrain_state", {
  project_id: integer("project_id").primaryKey(),
  feedback_count: integer("feedback_count").notNull().default(0),
  window_started_at: timestamp("window_started_at", { withTimezone: true }).defaultNow().notNull(),
  last_triggered_at: timestamp("last_triggered_at", { withTimezone: true }),
  cooldown_until: timestamp("cooldown_until", { withTimezone: true }),
  trigger_count: integer("trigger_count").notNull().default(0),
  last_event_at: timestamp("last_event_at", { withTimezone: true }).defaultNow().notNull(),
});
