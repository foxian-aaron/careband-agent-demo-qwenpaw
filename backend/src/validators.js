import { z } from "zod";

const nullableNumber = z.preprocess((value) => {
  if (value === "" || value === undefined || value === null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}, z.number().nullable());

const nullableInteger = z.preprocess((value) => {
  if (value === "" || value === undefined || value === null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric) : value;
}, z.number().int().nullable());

const dataQualityNumber = z.preprocess((value) => {
  if (value === "" || value === undefined || value === null) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}, z.number().min(0).max(100));

export const snapshotSchema = z.object({
  snapshot_id: z.string().optional(),
  elder_id: z.string().min(1),
  date: z.string().min(8),
  data_source: z.string().min(1).default("Manual Demo"),
  heart_rate_avg: nullableNumber.optional().default(null),
  resting_heart_rate: nullableNumber.optional().default(null),
  steps: nullableInteger.optional().default(null),
  active_minutes: nullableNumber.optional().default(null),
  sleep_duration: nullableNumber.optional().default(null),
  wear_time_hours: nullableNumber.optional().default(null),
  data_quality: dataQualityNumber,
  created_at: z.string().optional(),
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
  "ai_glasses",
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
  hardware_simulator: "mock",
  voice_simulator: "mock",
  mock_wearable: "mock",
  caregiver: "dashboard",
  system: "dashboard",
  web: "dashboard",
  wearable: "wearable_api",
  hardware: "esp32",
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
  const payload = { ...(input?.payload ?? {}) };

  if (!payload.action && mappedAction) payload.action = mappedAction;
  if (!payload.action && eventType === "sos") payload.action = "triggered";
  if (eventType === "fall" && legacyType === "fall_detected" && payload.confidence == null) {
    payload.confidence = 1;
  }
  if (rawSource !== source && !payload.original_source) payload.original_source = rawSource;
  if (
    legacyEventMap[legacyType] &&
    eventType === "manual_note" &&
    legacyType !== "manual_note" &&
    !payload.original_event_type
  ) {
    payload.original_event_type = legacyType;
  }

  return {
    ...input,
    event_type: eventType,
    occurred_at: input?.occurred_at ?? input?.timestamp,
    source,
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
  }),
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
