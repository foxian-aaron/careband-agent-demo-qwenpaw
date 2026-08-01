// backend/src/eventContract.js
//
// CareBand Stage 5 — device-neutral canonical event contract.
//
// Pure module: no database, no logging, no Date.now. normalizeEvent() validates
// a raw client event at the HTTP boundary, applies the minimal alias map, and
// returns a NEW canonical event object. It never trusts client risk fields and
// rejects raw voice/audio, precise location/address/trajectory, and any source
// that is not device-neutral (i.e. any hardware source).
//
// The Stage 4 risk engine (rules/riskEngine.js) owns the four risk fields
// (status_level / risk_score / key_reasons / recommended_action) and has its
// own copy of the alias map; this contract normalizes ONCE at the edge so the
// stored canonical event uses the canonical event_type directly.

// Canonical event types after alias normalization.
const CANONICAL_EVENT_TYPES = new Set([
  "sos",
  "fall",
  "voice",
  "medication",
  "location",
  "device_status",
  "manual_note",
]);

// Device-neutral sources only. Hardware sources (esp32 / nrf / apple_watch /
// wearable_api / ...) are rejected because they are absent from this allowlist.
const DEVICE_NEUTRAL_SOURCES = new Set([
  "software_simulator",
  "dashboard",
  "voice_companion",
  "import",
  "system",
]);

// Minimal alias map applied only here (at the HTTP boundary).
const EVENT_TYPE_ALIASES = {
  sos_long_press: "sos",
  fall_detected: "fall",
  voice_symptom: "voice",
  medication_reminder: "medication",
  medication_confirmed: "medication",
  medication_missed: "medication",
  location_alert: "location",
  geofence_exit: "location",
};

// Medication aliases also stamp a canonical action server-side (the alias
// semantics win over any conflicting client-supplied action). This keeps the
// risk engine's "latest medication confirmed?" rule honest regardless of what
// the client sends.
const MEDICATION_ALIAS_ACTIONS = {
  medication_reminder: "reminder",
  medication_confirmed: "confirmed",
  medication_missed: "missed",
};

// The only top-level keys a client is permitted to send.
const ALLOWED_TOP_LEVEL = new Set([
  "elder_id",
  "event_type",
  "source",
  "occurred_at",
  "payload",
]);

// Payload keys forbidden by the privacy rules (never persisted). Raw voice /
// audio, precise location / address / trajectory, and client-owned risk fields.
const FORBIDDEN_PAYLOAD_KEYS = new Set([
  // raw voice / audio
  "raw_text",
  "transcript",
  "transcription",
  "audio",
  "recording",
  "voice_data",
  "asr_text",
  // precise location / address / trajectory (region-level is allowed)
  "lat",
  "latitude",
  "lng",
  "lon",
  "longitude",
  "gps",
  "gps_lat",
  "gps_lng",
  "coordinates",
  "coords",
  "address",
  "trajectory",
  "track",
  "geopoint",
  // client-owned risk fields (the server recomputes these deterministically)
  "status_level",
  "risk_score",
  "key_reasons",
  "recommended_action",
]);

// Lower-cased view of the forbidden set so the recursive scan below is
// case-insensitive (clients must not bypass privacy rules via casing).
const FORBIDDEN_PAYLOAD_KEYS_LOWER = new Set(
  [...FORBIDDEN_PAYLOAD_KEYS].map((k) => k.toLowerCase()),
);

/**
 * Validation error mapped to HTTP 400 at the route boundary. Carries a fixed
 * safe code; the message never echoes the offending input.
 */
export class ValidationError extends Error {
  constructor(code = "validation_error") {
    super(code);
    this.name = "ValidationError";
    this.status = 400;
    this.code = code;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Recursively detect a forbidden privacy key at ANY depth of an object/array
 * tree, comparing lower-cased keys so casing cannot smuggle a field through.
 */
function containsForbiddenKey(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (containsForbiddenKey(item)) return true;
    }
    return false;
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_PAYLOAD_KEYS_LOWER.has(key.toLowerCase())) return true;
      if (containsForbiddenKey(value[key])) return true;
    }
    return false;
  }
  return false;
}

// An ISO 8601 date-time must carry an explicit timezone: a trailing "Z" or a
// trailing "+/-HH:MM" offset. Naive local times (no timezone) are rejected so
// the server never silently misinterprets them.
const ISO_TZ_PATTERN = /(Z$)|([+-]\d{2}:\d{2}$)/;

/**
 * Validate that a value is a parseable ISO 8601 date-time carrying an explicit
 * timezone, and return it normalized to a UTC ISO string.
 *
 * @throws {ValidationError} when the value is absent, has no timezone, or is
 *   not a real date (e.g. "not-a-date", "2026-13-45T12:00:00Z").
 */
function parseIsoDateTime(value) {
  if (typeof value !== "string") {
    throw new ValidationError("validation_error");
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new ValidationError("validation_error");
  }
  if (!ISO_TZ_PATTERN.test(trimmed)) {
    throw new ValidationError("validation_error");
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    throw new ValidationError("validation_error");
  }
  return new Date(ms).toISOString();
}

/**
 * Normalize a raw client event into a canonical event object.
 *
 * @param {object} input - raw client event
 * @returns {{elder_id:string,event_type:string,source:string,occurred_at:string,payload:object}}
 * @throws {ValidationError} on any invalid / forbidden input
 */
export function normalizeEvent(input) {
  if (!isPlainObject(input)) {
    throw new ValidationError("validation_error");
  }

  // Top level: reject ANY key outside the allowed set. This catches top-level
  // client risk fields, top-level raw_text, and any other extraneous field.
  for (const key of Object.keys(input)) {
    if (!ALLOWED_TOP_LEVEL.has(key)) {
      throw new ValidationError("validation_error");
    }
  }

  const { elder_id, event_type, source, occurred_at, payload } = input;

  // elder_id — required, non-empty string.
  if (typeof elder_id !== "string" || elder_id.trim() === "") {
    throw new ValidationError("validation_error");
  }

  // event_type — required; apply the alias map, then require a canonical type.
  if (typeof event_type !== "string" || event_type.trim() === "") {
    throw new ValidationError("validation_error");
  }
  const canonicalType = Object.prototype.hasOwnProperty.call(
    EVENT_TYPE_ALIASES,
    event_type,
  )
    ? EVENT_TYPE_ALIASES[event_type]
    : event_type;
  if (!CANONICAL_EVENT_TYPES.has(canonicalType)) {
    throw new ValidationError("validation_error");
  }

  // source — must be one of the device-neutral sources (allowlist rejects
  // hardware sources).
  if (typeof source !== "string" || !DEVICE_NEUTRAL_SOURCES.has(source)) {
    throw new ValidationError("validation_error");
  }

  // occurred_at — required; must be a parseable ISO 8601 date-time carrying an
  // explicit timezone (trailing Z or +/-HH:MM). Normalized to a UTC ISO string
  // so downstream consumers always see one canonical representation.
  const normalizedOccurredAt = parseIsoDateTime(occurred_at);

  // payload — optional; defaults to {}. Must be a plain object with no
  // forbidden privacy keys.
  const safePayload = payload === undefined ? {} : payload;
  if (!isPlainObject(safePayload)) {
    throw new ValidationError("validation_error");
  }
  // Recursively reject forbidden privacy keys at ANY depth and in ANY case, so
  // nested / case-variant raw voice, precise location, address, trajectory, or
  // client risk fields can never be persisted.
  if (containsForbiddenKey(safePayload)) {
    throw new ValidationError("validation_error");
  }

  // Return a NEW object with a copied payload so the input is never mutated and
  // no forbidden reference can leak downstream. Medication aliases stamp a
  // canonical action server-side, overriding any conflicting client value.
  const normalizedPayload = { ...safePayload };
  if (Object.prototype.hasOwnProperty.call(MEDICATION_ALIAS_ACTIONS, event_type)) {
    normalizedPayload.action = MEDICATION_ALIAS_ACTIONS[event_type];
  }

  return {
    elder_id,
    event_type: canonicalType,
    source,
    occurred_at: normalizedOccurredAt,
    payload: normalizedPayload,
  };
}

export { CANONICAL_EVENT_TYPES, DEVICE_NEUTRAL_SOURCES };
