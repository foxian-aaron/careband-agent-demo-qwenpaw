import { z } from "zod";

const nullableNumber = (numberSchema = z.number()) => z.preprocess((value) => {
  if (value === "" || value === undefined || value === null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}, numberSchema.nullable());

const nullableInteger = (numberSchema = z.number().int()) => z.preprocess((value) => {
  if (value === "" || value === undefined || value === null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}, numberSchema.nullable());

const dataQualityNumber = z.preprocess((value) => {
  if (value === "" || value === undefined || value === null) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}, z.number().min(0).max(100));

const validLocalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must use YYYY-MM-DD")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    );
  }, "date must be a real calendar date");

export const SNAPSHOT_SOURCES = [
  "Apple Health Export",
  "CSV Import",
  "Demo Seed",
  "Demo Control",
  "Manual Demo",
];

export const snapshotSchema = z.object({
  snapshot_id: z.string().optional(),
  elder_id: z.string().min(1),
  date: validLocalDate,
  data_source: z.enum(SNAPSHOT_SOURCES).default("Manual Demo"),
  heart_rate_avg: nullableNumber(z.number().min(0)).optional().default(null),
  resting_heart_rate: nullableNumber(z.number().min(0)).optional().default(null),
  steps: nullableInteger(z.number().int().min(0)).optional().default(null),
  active_minutes: nullableNumber(z.number().min(0)).optional().default(null),
  sleep_duration: nullableNumber(z.number().min(0).max(24)).optional().default(null),
  wear_time_hours: nullableNumber(z.number().min(0).max(24)).optional().default(null),
  data_quality: dataQualityNumber,
  created_at: z.string().datetime({ offset: true }).optional(),
});

export const EVENT_TYPES = [
  "sos",
  "fall",
  "voice",
  "medication",
  "location",
  "device_status",
  "manual_note",
];

export const EVENT_SOURCES = [
  "esp32",
  "nrf",
  "mobile_app",
  "dashboard",
  "csv",
  "mock",
  "wearable_api",
];

export const RISK_LEVELS = [
  "data_insufficient",
  "stable",
  "observation",
  "attention",
  "high_risk",
  "urgent",
];

export const TASK_STATUSES = [
  "open",
  "acknowledged",
  "in_progress",
  "resolved",
  "cancelled",
];

const legacyEventMap = {
  sos_long_press: ["sos", "long_press"],
  sos_triple_press: ["sos", "triple_press"],
  fall_detected: ["fall", "detected"],
  inactivity_after_fall: ["fall", "inactivity_after_fall"],
  no_response_after_fall: ["fall", "no_response"],
  voice_symptom: ["voice", "symptom_report"],
  wandering_help: ["voice", "wandering_help"],
  medication_query: ["voice", "medication_query"],
  medication_reminder: ["medication", "reminder"],
  medication_confirmed: ["medication", "confirmed"],
  medication_missed: ["medication", "missed"],
  location_alert: ["location", "alert"],
  geofence_exit: ["location", "geofence_exit"],
  low_activity: ["device_status", "low_activity"],
  night_wakeup: ["device_status", "night_wakeup"],
  system_risk_update: ["device_status", "risk_update"],
  device_low_battery: ["device_status", "low_battery"],
  device_not_worn: ["device_status", "not_worn"],
  caregiver_accepted: ["manual_note", "caregiver_accepted"],
  caregiver_checked: ["manual_note", "caregiver_checked"],
  caregiver_completed: ["manual_note", "caregiver_completed"],
  attention: ["manual_note", "attention"],
  bite: ["manual_note", "bite"],
  image: ["manual_note", "image"],
};

const sourceAliases = {
  demo: "mock",
  demo_control: "dashboard",
  hardware_simulator: "mock",
  voice_simulator: "mock",
  mock_wearable: "mock",
  caregiver: "dashboard",
  system: "dashboard",
  web: "dashboard",
  wearable: "wearable_api",
  hardware: "esp32",
};

const commonPayloadKeys = [
  "action",
  "device_id",
  "simulated_device",
  "original_source",
  "original_event_type",
];

const eventPayloadKeys = {
  sos: [
    ...commonPayloadKeys,
    "button_pattern",
    "button_press_seconds",
    "device_uptime_ms",
    "retry_storage",
    "battery_pct",
    "battery_level",
    "firmware_version",
  ],
  fall: [
    ...commonPayloadKeys,
    "confidence",
    "fall_confidence",
    "no_response_seconds",
  ],
  voice: [...commonPayloadKeys, "transcript_summary", "symptom_keywords", "language"],
  medication: [
    ...commonPayloadKeys,
    "medication_name",
    "scheduled_time",
    "confirmation_source",
    "button_pattern",
  ],
  location: [...commonPayloadKeys, "location_zone", "region", "safe_zone_status"],
  device_status: [
    ...commonPayloadKeys,
    "battery_pct",
    "battery_level",
    "wear_time_hours",
    "night_wakeup_count",
    "activity_drop_percent",
    "previous_value",
    "current_value",
  ],
  manual_note: [
    ...commonPayloadKeys,
    "note",
    "source_type",
    "previous_value",
    "current_value",
  ],
};

const compactText = (value, maxLength) =>
  String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);

const limitedString = (maxLength) => z.string().trim().min(1).max(maxLength);
const nonNegativeNumber = z.number().finite().min(0);
const percentage = z.number().finite().min(0).max(100);
const batteryLevel = z.union([percentage, limitedString(32)]);
const LOCATION_ZONES = ["A 区", "B 区", "C 区", "机构内", "机构外", "澳门"];
const locationZoneAliases = new Map([
  ["a区", "A 区"],
  ["a區", "A 区"],
  ["zone_a", "A 区"],
  ["b区", "B 区"],
  ["b區", "B 区"],
  ["zone_b", "B 区"],
  ["c区", "C 区"],
  ["c區", "C 区"],
  ["zone_c", "C 区"],
  ["机构内", "机构内"],
  ["機構內", "机构内"],
  ["care_center", "机构内"],
  ["机构外", "机构外"],
  ["機構外", "机构外"],
  ["outside_center", "机构外"],
  ["澳门", "澳门"],
  ["澳門", "澳门"],
]);
const safeZoneAliases = new Map([
  ["inside", "inside"],
  ["outside", "outside"],
  ["unknown", "unknown"],
  ["内", "inside"],
  ["內", "inside"],
  ["外", "outside"],
]);
const boundedScalar = z.union([
  z.string().max(160),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const commonPayloadShape = {
  action: limitedString(64).optional(),
  device_id: limitedString(80).optional(),
  simulated_device: limitedString(32).optional(),
  original_source: limitedString(64).optional(),
  original_event_type: limitedString(64).optional(),
};

const eventPayloadSchemas = {
  sos: z
    .object({
      ...commonPayloadShape,
      button_pattern: limitedString(64).optional(),
      button_press_seconds: nonNegativeNumber.max(300).optional(),
      device_uptime_ms: nonNegativeNumber.max(Number.MAX_SAFE_INTEGER).optional(),
      retry_storage: limitedString(32).optional(),
      battery_pct: percentage.optional(),
      battery_level: batteryLevel.optional(),
      firmware_version: limitedString(32).optional(),
    })
    .strict(),
  fall: z
    .object({
      ...commonPayloadShape,
      confidence: percentage.optional(),
      fall_confidence: percentage.optional(),
      no_response_seconds: nonNegativeNumber.max(86400).optional(),
    })
    .strict(),
  voice: z
    .object({
      ...commonPayloadShape,
      transcript_summary: limitedString(160).optional(),
      symptom_keywords: z.array(limitedString(32)).max(12).optional(),
      language: limitedString(32).optional(),
    })
    .strict(),
  medication: z
    .object({
      ...commonPayloadShape,
      medication_name: limitedString(80).optional(),
      scheduled_time: limitedString(64).optional(),
      confirmation_source: limitedString(64).optional(),
      button_pattern: limitedString(64).optional(),
    })
    .strict(),
  location: z
    .object({
      ...commonPayloadShape,
      location_zone: z.enum(LOCATION_ZONES).optional(),
      safe_zone_status: z.enum(["inside", "outside", "unknown"]).optional(),
    })
    .strict(),
  device_status: z
    .object({
      ...commonPayloadShape,
      battery_pct: percentage.optional(),
      battery_level: batteryLevel.optional(),
      wear_time_hours: nonNegativeNumber.max(24).optional(),
      night_wakeup_count: z.number().int().min(0).max(1000).optional(),
      activity_drop_percent: percentage.optional(),
      previous_value: boundedScalar.optional(),
      current_value: boundedScalar.optional(),
    })
    .strict(),
  manual_note: z
    .object({
      ...commonPayloadShape,
      note: limitedString(1000).optional(),
      source_type: limitedString(64).optional(),
      previous_value: boundedScalar.optional(),
      current_value: boundedScalar.optional(),
    })
    .strict(),
};

const payloadStringLimits = {
  action: 64,
  device_id: 80,
  simulated_device: 32,
  original_source: 64,
  original_event_type: 64,
  button_pattern: 64,
  retry_storage: 32,
  firmware_version: 32,
  transcript_summary: 160,
  language: 32,
  medication_name: 80,
  scheduled_time: 64,
  confirmation_source: 64,
  location_zone: 80,
  region: 80,
  safe_zone_status: 32,
  note: 1000,
  source_type: 64,
};

const pickPayload = (eventType, inputPayload) => {
  const allowed = new Set(eventPayloadKeys[eventType] ?? commonPayloadKeys);
  return Object.fromEntries(
    Object.entries(inputPayload).filter(([key, value]) => allowed.has(key) && value !== undefined),
  );
};

const sanitizePayload = (eventType, inputPayload) => {
  const schema = eventPayloadSchemas[eventType];
  if (!schema) return {};

  const picked = pickPayload(eventType, inputPayload);
  const sanitized = {};
  for (const [key, originalValue] of Object.entries(picked)) {
    let value = originalValue;
    const stringLimit = payloadStringLimits[key];
    if (stringLimit) {
      if (typeof value !== "string") continue;
      value = compactText(value, stringLimit);
      if (!value) continue;
    } else if (key === "symptom_keywords") {
      if (!Array.isArray(value)) continue;
      value = [
        ...new Set(
          value
            .filter((item) => typeof item === "string")
            .map((item) => compactText(item, 32))
            .filter(Boolean),
        ),
      ].slice(0, 12);
      if (value.length === 0) continue;
    } else if (["previous_value", "current_value"].includes(key) && typeof value === "string") {
      value = compactText(value, 160);
    }

    const fieldSchema = schema.shape[key];
    const parsed = fieldSchema?.safeParse(value);
    if (parsed?.success && parsed.data !== undefined) sanitized[key] = parsed.data;
  }

  return schema.parse(sanitized);
};

const normalizeLocationZone = (value) => {
  if (typeof value !== "string") return null;
  const key = compactText(value, 80).toLowerCase().replace(/\s+/gu, "");
  return locationZoneAliases.get(key) ?? null;
};

const normalizeSafeZoneStatus = (value) => {
  if (typeof value !== "string") return null;
  return safeZoneAliases.get(compactText(value, 32).toLowerCase()) ?? null;
};

const defaultSeverity = (eventType, action, payload) => {
  if (eventType === "sos") return "urgent";
  if (eventType === "fall") {
    const rawConfidence = Number(payload.confidence ?? payload.fall_confidence ?? 0);
    const confidence = rawConfidence > 1 ? rawConfidence / 100 : rawConfidence;
    return confidence >= 0.8 || action === "detected" ? "urgent" : "watch";
  }
  if (eventType === "voice" || eventType === "medication" || eventType === "location") {
    return "watch";
  }
  return "info";
};

export const normalizeEventInput = (input) => {
  const legacyType = String(input?.event_type ?? "");
  const [mappedType, mappedAction] = legacyEventMap[legacyType] ?? [legacyType, null];
  const eventType = mappedType;
  const rawSource = String(input?.source ?? "mock");
  const sourceCandidate = sourceAliases[rawSource] ?? rawSource;
  const source = sourceCandidate;
  const rawPayload =
    input?.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
      ? { ...input.payload }
      : {};

  if (!rawPayload.action && mappedAction) rawPayload.action = mappedAction;
  if (!rawPayload.action && eventType === "sos") rawPayload.action = "triggered";
  if (eventType === "fall" && legacyType === "fall_detected" && rawPayload.confidence == null) {
    rawPayload.confidence = 1;
  }
  if (rawSource !== source && !rawPayload.original_source) rawPayload.original_source = rawSource;
  if (
    legacyEventMap[legacyType] &&
    eventType === "manual_note" &&
    legacyType !== "manual_note" &&
    !rawPayload.original_event_type
  ) {
    rawPayload.original_event_type = legacyType;
  }
  if (eventType === "location") {
    const locationZone = normalizeLocationZone(rawPayload.location_zone ?? rawPayload.region);
    const safeZoneStatus = normalizeSafeZoneStatus(rawPayload.safe_zone_status);
    delete rawPayload.region;
    if (locationZone) rawPayload.location_zone = locationZone;
    else delete rawPayload.location_zone;
    if (safeZoneStatus) rawPayload.safe_zone_status = safeZoneStatus;
    else delete rawPayload.safe_zone_status;
  }

  const payload = sanitizePayload(eventType, rawPayload);
  let rawText =
    typeof input?.raw_text === "string"
      ? compactText(input.raw_text, eventType === "manual_note" ? 1000 : 500) || null
      : null;

  if (eventType === "voice") {
    const summaryCandidate = [rawPayload.transcript_summary, input?.raw_text, rawPayload.transcript]
      .find((value) => typeof value === "string");
    const transcriptSummary = compactText(
      summaryCandidate,
      160,
    );
    if (transcriptSummary) payload.transcript_summary = transcriptSummary;
    rawText = transcriptSummary || null;
  } else if (eventType === "location") {
    const region = payload.location_zone ?? "";
    const safeZone = payload.safe_zone_status ?? "";
    rawText = `Location region event: ${region || "withheld"}; safe_zone_status=${
      safeZone || "unknown"
    }`;
  }

  return {
    ...input,
    event_type: eventType,
    occurred_at: input?.occurred_at ?? input?.timestamp,
    source,
    raw_text: rawText,
    severity_hint:
      input?.severity_hint ?? defaultSeverity(eventType, payload.action, payload),
    data_quality: input?.data_quality ?? "medium",
    payload,
  };
};

export const eventSchema = z.preprocess(
  normalizeEventInput,
  z.object({
    event_id: z.string().min(1).optional(),
    elder_id: z.string().min(1),
    event_type: z.enum(EVENT_TYPES),
    occurred_at: z.string().datetime({ offset: true }).optional(),
    received_at: z.string().datetime({ offset: true }).optional(),
    source: z.enum(EVENT_SOURCES),
    raw_text: z.string().nullable().optional(),
    severity_hint: z.enum(["info", "watch", "urgent", "critical"]),
    payload: z.record(z.unknown()),
    data_quality: z.enum(["high", "medium", "low"]),
    created_at: z.string().datetime({ offset: true }).optional(),
  }).transform((event) => ({
    ...event,
    payload: eventPayloadSchemas[event.event_type].parse(event.payload),
  })),
);

export const taskPatchSchema = z.preprocess(
  (input) => {
    if (!input || typeof input !== "object") return input;
    const legacyStatuses = { pending: "open", completed: "resolved" };
    return {
      ...input,
      status: legacyStatuses[input.status] ?? input.status,
    };
  },
  z.object({
  status: z.enum(TASK_STATUSES).optional(),
  handled_by: z.string().nullable().optional(),
  handled_note: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  }),
);

export const agentAnalyzeSchema = z.object({
  elder_id: z.string().min(1),
  source_event_id: z.string().nullable().optional(),
}).strict();
