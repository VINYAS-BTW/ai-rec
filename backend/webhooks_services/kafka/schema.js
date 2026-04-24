const CURRENT_SCHEMA_VERSION = 1;
const SUPPORTED_SCHEMA_VERSIONS = new Set([1]);
const VALID_EVENT_TYPES = new Set(["click", "rating", "skip", "dwell", "recommendation_served", "training_completed"]);

function normalizeSchemaVersion(value) {
  const version = Number(value ?? CURRENT_SCHEMA_VERSION);
  if (!Number.isInteger(version) || version < 1) {
    return null;
  }
  return version;
}

/**
 * Validate a fully-enriched event object.
 * @param {object} event
 * @returns {string|null}  null = valid, string = first validation error
 */
function validateEvent(event) {
  if (!event || typeof event !== "object") return "event must be an object";

  if (!event.event_id || typeof event.event_id !== "string")
    return "event_id must be a non-empty string (UUID)";

  if (!VALID_EVENT_TYPES.has(event.event_type))
    return `event_type must be one of: ${[...VALID_EVENT_TYPES].join(", ")}`;

  if (!event.occurred_at || isNaN(Date.parse(event.occurred_at)))
    return "occurred_at must be a valid ISO 8601 UTC string";

  if (!event.source_service || typeof event.source_service !== "string")
    return "source_service is required";

  const schemaVersion = normalizeSchemaVersion(event.schema_version);
  if (!schemaVersion || !SUPPORTED_SCHEMA_VERSIONS.has(schemaVersion)) {
    return `schema_version must be one of: ${[...SUPPORTED_SCHEMA_VERSIONS].join(", ")}`;
  }

  // rating-specific rule
  if (event.event_type === "rating") {
    if (event.rating_value === null || event.rating_value === undefined)
      return "rating_value is required for rating events";
    const min = parseFloat(process.env.EVENT_RATING_MIN || "1");
    const max = parseFloat(process.env.EVENT_RATING_MAX || "5");
    if (typeof event.rating_value !== "number" || event.rating_value < min || event.rating_value > max)
      return `rating_value must be a number between ${min} and ${max}`;
  }

  // click-specific rule
  if (event.event_type === "click") {
    if (!event.item_id) return "item_id is required for click events";
  }

  if (event.event_type === "skip") {
    if (!event.item_id) return "item_id is required for skip events";
  }

  if (event.event_type === "dwell") {
    if (!event.item_id) return "item_id is required for dwell events";
    const dwellValue = event.dwell_time_ms ?? event.dwell_time_seconds;
    const dwellNumeric = Number(dwellValue);
    if (!Number.isFinite(dwellNumeric) || dwellNumeric <= 0) {
      return "dwell_time_ms or dwell_time_seconds must be a positive number";
    }
  }

  return null; // valid
}

export {
  CURRENT_SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  normalizeSchemaVersion,
  validateEvent,
  VALID_EVENT_TYPES,
};