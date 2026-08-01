// src/lib/backendMapping.ts — Stage 6B untrusted dashboard -> product state.
// Only subject_kind === "elder" elders (E001-E004) map; server risk_result is the
// single risk authority (missing/invalid field -> whole response rejected). Unknown
// event types drop. Events/tasks use the owning row's elderId (nested forged id
// ignored). Raw payload strings, voice text and precise location are never restored.

import type {
  BackendOperationalSummary,
  BackendSyncPayload,
  CareEvent,
  CareTask,
  DailySnapshot,
  ElderProfile,
  MedicationStatus,
  OperationalState,
  RiskDimensions,
  RiskLevel,
  RiskResult,
} from "../types";

export class InvalidBackendPayloadError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "InvalidBackendPayloadError";
    this.code = code;
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
// Server data_quality is 0-100; frontend dataCompleteness is 0-1.
const norm = (raw: unknown): number => {
  const n = num(raw);
  return n === undefined ? 0 : Math.min(1, Math.max(0, n > 1 ? n / 100 : n));
};

const MEDS = new Set(["confirmed", "not_confirmed", "delayed", "not_required"]);
const med = (v: unknown): MedicationStatus =>
  typeof v === "string" && MEDS.has(v) ? (v as MedicationStatus) : "not_required";
const ZONES = new Set(["inside", "outside", "unknown"]);
const zone = (v: unknown): "inside" | "outside" | "unknown" =>
  typeof v === "string" && ZONES.has(v) ? (v as "inside" | "outside" | "unknown") : "unknown";
const LEVELS = new Set(["data_insufficient", "stable", "observation", "attention", "high_risk", "urgent"]);
const level = (v: unknown): RiskLevel | undefined =>
  typeof v === "string" && LEVELS.has(v) ? (v as RiskLevel) : undefined;

const ALL_INSUFFICIENT: RiskDimensions = {
  vitals: "data_insufficient", activity: "data_insufficient", sleep: "data_insufficient",
  medication: "data_insufficient", safety: "data_insufficient",
};

// elder profile (server core fields + mock-only display supplement)
const mapProfile = (elder: Obj, mock: Record<string, ElderProfile>): ElderProfile | null => {
  const elderId = str(elder.elder_id);
  if (!elderId) return null;
  const m = mock[elderId];
  return {
    elderId,
    name: str(elder.name) ?? m?.name ?? elderId,
    age: num(elder.age) ?? m?.age ?? 0,
    gender: m?.gender,
    room: str(elder.room) ?? m?.room ?? "",
    floor: m?.floor ?? "",
    chronicConditions: m?.chronicConditions ?? [],
    riskTags: strArr(elder.risk_tags),
    caregiverId: m?.caregiverId ?? "",
    familyContactId: m?.familyContactId ?? "",
  };
};

// snapshot (null -> honest data-insufficient placeholder)
const insufficientSnapshot = (elderId: string, date: string, at: string): DailySnapshot => ({
  elderId, date, heartRate: null, stepsToday: null, activeMinutes: null, sleepDuration: null,
  medicationMorning: "not_required", medicationEvening: "not_required", wearTimeHours: 0,
  locationZone: "数据不足", safeZoneStatus: "unknown", fallDetected: false,
  dataCompleteness: 0, lastSyncedAt: at,
});

const mapSnapshot = (raw: unknown, elderId: string, date: string, at: string): DailySnapshot => {
  if (!isObj(raw)) return insufficientSnapshot(elderId, date, at);
  return {
    elderId, date: str(raw.snapshot_date) ?? date,
    heartRate: num(raw.heart_rate) ?? null, stepsToday: num(raw.steps) ?? null,
    activeMinutes: num(raw.active_minutes) ?? null, sleepDuration: num(raw.sleep_duration) ?? null,
    medicationMorning: med(raw.medication_morning), medicationEvening: med(raw.medication_evening),
    wearTimeHours: num(raw.wear_time_hours) ?? 0, locationZone: str(raw.location_zone) ?? "数据不足",
    safeZoneStatus: zone(raw.safe_zone_status), fallDetected: raw.fall_detected === true,
    dataCompleteness: norm(raw.data_quality), lastSyncedAt: at,
  };
};

// events: [mapped eventType, safe title]. Unknown server event_type has no entry
// and is dropped entirely (never faked as system_risk_update).
const EVENTS: Record<string, [CareEvent["eventType"], string]> = {
  sos: ["sos", "SOS 求助事件"], sos_long_press: ["sos", "SOS 求助事件"],
  fall_detected: ["fall_detected", "跌倒检测事件"], fall: ["fall_detected", "跌倒检测事件"],
  voice_symptom: ["voice_symptom", "语音症状反馈"], voice: ["voice_symptom", "语音症状反馈"],
  medication_reminder: ["medication_reminder", "用药提醒"],
  medication_confirmed: ["medication_confirmed", "用药已确认"], medication_missed: ["medication_confirmed", "用药已确认"],
  location: ["location_alert", "位置区域提醒"], location_alert: ["location_alert", "位置区域提醒"],
  device_status: ["device_status", "设备状态更新"], manual_note: ["manual_note", "人工照护记录"],
  night_wakeup: ["night_wakeup", "夜间离床记录"], low_activity: ["low_activity", "活动量下降记录"],
  caregiver_accepted: ["caregiver_accepted", "护工已接单"], caregiver_checked: ["caregiver_checked", "护工已查看"],
  caregiver_completed: ["caregiver_completed", "护工已完成跟进"], system_risk_update: ["system_risk_update", "系统风险更新"],
};
const eventEntry = (raw: Obj): [CareEvent["eventType"], string] | undefined => {
  const type = str(raw.event_type);
  if (type !== "medication") return type ? EVENTS[type] : undefined;
  const action = isObj(raw.payload) ? str(raw.payload.action) : undefined;
  if (action === "confirmed") return ["medication_confirmed", "用药已确认"];
  return ["medication_reminder", action === "missed" ? "用药未确认" : "用药提醒"];
};
// software_simulator preserved verbatim; unknown sources default to system.
const SOURCES: Record<string, CareEvent["source"]> = {
  caregiver: "caregiver", software_simulator: "software_simulator", system: "system",
  dashboard: "system", mock_wearable: "mock_wearable", demo: "demo",
};
const sourceOf = (v: unknown): CareEvent["source"] =>
  typeof v === "string" && SOURCES[v] ? SOURCES[v] : "system";
const eventTs = (e: Obj): string => {
  for (const k of ["occurred_at", "timestamp", "created_at"]) {
    const ts = str(e[k]);
    if (ts) return ts;
  }
  return "";
};
const eventStatus = (v: unknown): CareEvent["status"] => {
  const s = typeof v === "string" ? v : "";
  return s === "active" || s === "open" ? "open" : s === "acknowledged" ? "acknowledged" : "resolved";
};

// fallbackElderId is the owning row's elderId; a nested forged elder_id is ignored.
const mapEvent = (raw: unknown, fallbackElderId: string, index: number): CareEvent | null => {
  if (!isObj(raw)) return null;
  const entry = eventEntry(raw);
  if (!entry) return null; // unknown event_type -> dropped, not faked
  return {
    eventId: String(raw.event_id !== undefined ? `EVT-SRV-${raw.event_id}` : `EVT-SRV-${fallbackElderId}-${index}`),
    elderId: fallbackElderId, eventType: entry[0], timestamp: eventTs(raw),
    title: entry[1], source: sourceOf(raw.source), status: eventStatus(raw.status),
    // rawText intentionally omitted — never restore raw voice/payload text.
  };
};

// tasks (title/reason/action only from server risk fields)
const TASK_PRIORITY: Record<string, CareTask["priority"]> = {
  urgent: "urgent", high_risk: "high", attention: "medium",
  observation: "low", stable: "low", data_insufficient: "low",
};
const TASK_TITLE: Record<string, string> = {
  urgent: "紧急处理任务", high_risk: "高风险关注任务", attention: "需关注任务",
  observation: "观察任务", stable: "常规照护任务", data_insufficient: "数据确认任务",
};
const TASK_STATUS: Record<string, CareTask["status"]> = {
  open: "pending", pending: "pending", in_progress: "in_progress",
  resolved: "completed", completed: "completed", cancelled: "completed",
};
// elderId is the owning row's elderId; a nested forged elder_id is ignored.
const mapTask = (raw: unknown, elderId: string, index: number): CareTask | null => {
  if (!isObj(raw)) return null;
  const lv = level(raw.risk_level) ?? "data_insufficient";
  const reasons = strArr(raw.key_reasons);
  const createdAt = str(raw.created_at) ?? "";
  return {
    taskId: String(raw.task_id !== undefined ? `TASK-SRV-${raw.task_id}` : `TASK-SRV-${index}`),
    elderId,
    sourceEventId: raw.linked_event_id !== undefined ? `EVT-SRV-${raw.linked_event_id}` : undefined,
    priority: TASK_PRIORITY[lv] ?? "low", title: TASK_TITLE[lv] ?? "照护关注任务",
    reason: reasons.length > 0 ? reasons.join("；") : "服务器风险更新",
    recommendedAction: str(raw.recommended_action) ?? "", assignedTo: "",
    status: TASK_STATUS[str(raw.status) ?? ""] ?? "pending", createdAt,
    updatedAt: str(raw.updated_at) ?? createdAt,
  };
};

const deriveState = (tasks: CareTask[]): OperationalState => {
  const s = tasks.map((t) => t.status);
  if (s.includes("pending")) return "pending";
  if (s.includes("in_progress")) return "in_progress";
  if (s.includes("completed")) return "follow_up";
  return "normal";
};

// risk_result (authoritative; every field strictly validated, never defaulted)
const requireStrArr = (raw: unknown, field: string): string[] => {
  if (!Array.isArray(raw) || !raw.every((x) => typeof x === "string")) {
    throw new InvalidBackendPayloadError("invalid_payload", `${field} 必须为字符串数组`);
  }
  return raw;
};
const requireNonEmpty = (raw: unknown, field: string): string => {
  const s = str(raw);
  if (s === undefined) throw new InvalidBackendPayloadError("invalid_payload", `${field} 不能为空`);
  return s;
};
// data_quality: only null or a finite number; undefined/missing/string/bool/NaN reject.
const requireDq = (raw: unknown, elderId: string): number => {
  if (raw === null) return 0;
  const n = num(raw);
  if (n === undefined) {
    throw new InvalidBackendPayloadError("invalid_payload", `${elderId} 的 data_quality 必须为 null 或有限数值`);
  }
  return Math.min(1, Math.max(0, n > 1 ? n / 100 : n));
};
const mapRisk = (raw: unknown, elderId: string): RiskResult => {
  if (!isObj(raw)) throw new InvalidBackendPayloadError("invalid_payload", `${elderId} 缺少权威风险结果`);
  const lv = level(raw.status_level);
  if (!lv) throw new InvalidBackendPayloadError("invalid_payload", `${elderId} 的 status_level 非法`);
  const score = num(raw.risk_score);
  if (score === undefined) throw new InvalidBackendPayloadError("invalid_payload", `${elderId} 的 risk_score 必须为有限数值`);
  const keyReasons = requireStrArr(raw.key_reasons, `${elderId} 的 key_reasons`);
  const triggeredRules = requireStrArr(raw.triggered_rules, `${elderId} 的 triggered_rules`);
  const recommendedAction = requireNonEmpty(raw.recommended_action, `${elderId} 的 recommended_action`);
  const disclaimer = requireNonEmpty(raw.safety_disclaimer, `${elderId} 的 safety_disclaimer`);
  const dq = requireDq(raw.data_quality, elderId);
  return {
    elderId, riskLevel: lv, riskScore: score, dimensions: ALL_INSUFFICIENT,
    keyReasons, triggeredRules, recommendedAction, dataCompleteness: dq,
    confidence: dq, medicalDisclaimer: disclaimer,
  };
};

const mapSummary = (raw: unknown): BackendOperationalSummary => {
  if (!isObj(raw)) {
    return { elderCount: 0, urgentCount: 0, highRiskCount: 0, activeTaskCount: 0, statusDistribution: {} };
  }
  const dist = isObj(raw.status_distribution)
    ? (Object.fromEntries(Object.entries(raw.status_distribution).filter(([, v]) => typeof v === "number")) as Record<string, number>)
    : {};
  return {
    elderCount: num(raw.elder_count) ?? 0, urgentCount: num(raw.urgent_count) ?? 0,
    highRiskCount: num(raw.high_risk_count) ?? 0, activeTaskCount: num(raw.active_task_count) ?? 0,
    statusDistribution: dist,
  };
};

// Only the four formal demo elders are accepted; others (E005, E999) are skipped
// even when subject_kind === "elder".
const ALLOWED_ELDERS = new Set(["E001", "E002", "E003", "E004"]);

/**
 * Map a Stage 6A dashboard response into a pure, reducer-ready payload. Throws
 * InvalidBackendPayloadError on top-level structural failure or when a mapped
 * elder (subject_kind === "elder") lacks an authoritative risk_result. Does not
 * mutate the input.
 */
export function mapDashboard(data: unknown, mockProfiles: Record<string, ElderProfile>): BackendSyncPayload {
  if (!isObj(data)) throw new InvalidBackendPayloadError("invalid_payload", "响应不是对象");
  if (data.ok !== true) throw new InvalidBackendPayloadError("invalid_payload", "响应 ok 不为 true");
  const generatedAt = str(data.generated_at);
  if (!generatedAt) throw new InvalidBackendPayloadError("invalid_payload", "缺少 generated_at");
  if (Number.isNaN(Date.parse(generatedAt))) throw new InvalidBackendPayloadError("invalid_payload", "generated_at 不是有效的日期时间");
  if (!Array.isArray(data.rows)) throw new InvalidBackendPayloadError("invalid_payload", "rows 不是数组");
  if (!isObj(data.operational_summary)) throw new InvalidBackendPayloadError("invalid_payload", "缺少 operational_summary");

  const syncDate = generatedAt.slice(0, 10);
  const profiles: Record<string, ElderProfile> = {};
  const snapshots: Record<string, DailySnapshot> = {};
  const events: CareEvent[] = [];
  const tasks: CareTask[] = [];
  const operationalStates: Record<string, OperationalState> = {};
  const riskMap: Record<string, RiskResult> = {};

  for (const rowRaw of arr(data.rows)) {
    if (!isObj(rowRaw) || !isObj(rowRaw.elder)) continue;
    const elderRaw = rowRaw.elder as Obj;
    if (elderRaw.subject_kind !== "elder") continue; // exclude TEST001 etc.

    const profile = mapProfile(elderRaw, mockProfiles);
    if (!profile) continue;
    const elderId = profile.elderId;
    if (!ALLOWED_ELDERS.has(elderId)) continue; // only formal demo elders
    if (profiles[elderId]) throw new InvalidBackendPayloadError("invalid_payload", `${elderId} 重复`);

    // Authoritative risk is mandatory and strictly validated: any mapped elder
    // whose risk_result is missing or has an invalid field rejects the response.
    const risk = mapRisk(rowRaw.risk_result, elderId);

    profiles[elderId] = profile;
    riskMap[elderId] = risk;
    snapshots[elderId] = rowRaw.latest_snapshot == null
      ? insufficientSnapshot(elderId, syncDate, generatedAt)
      : mapSnapshot(rowRaw.latest_snapshot, elderId, syncDate, generatedAt);

    const elderEvents = arr(rowRaw.events).map((e, i) => mapEvent(e, elderId, i)).filter((e): e is CareEvent => e !== null);
    events.push(...elderEvents);
    const elderTasks = arr(rowRaw.tasks).map((t, i) => mapTask(t, elderId, i)).filter((t): t is CareTask => t !== null);
    tasks.push(...elderTasks);
    operationalStates[elderId] = deriveState(elderTasks);
  }

  if ([...ALLOWED_ELDERS].some((id) => !profiles[id])) {
    throw new InvalidBackendPayloadError("invalid_payload", "正式长者数据不完整");
  }

  return {
    generatedAt, profiles, snapshots, events, tasks, operationalStates, riskMap,
    operationalSummary: mapSummary(data.operational_summary),
  };
}
