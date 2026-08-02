import type { BackendSyncError, RiskLevel } from "../types";
import { resolveBaseUrl, type FetchLike } from "./apiClient";

export const SOFTWARE_SIMULATOR_SOURCE = "software_simulator" as const;

export type SimulatorScenarioId =
  | "sos"
  | "dizziness"
  | "fall"
  | "safe_zone_exit"
  | "data_gap"
  | "medication_confirmed"
  | "agent_failure";

export interface SimulatorEventRequest {
  elder_id: string;
  event_type: "sos" | "voice" | "fall" | "location" | "device_status" | "medication" | "manual_note";
  source: typeof SOFTWARE_SIMULATOR_SOURCE;
  occurred_at: string;
  payload: Record<string, unknown>;
}

export interface SimulatorScenario {
  id: SimulatorScenarioId;
  label: string;
  description: string;
}

export const SIMULATOR_SCENARIOS: readonly SimulatorScenario[] = [
  { id: "sos", label: "SOS", description: "验证紧急事件、规则结果与护工任务" },
  { id: "dizziness", label: "头晕", description: "只发送结构化症状关键词，不发送语音原文" },
  { id: "fall", label: "跌倒事件", description: "发送高置信度软件模拟跌倒" },
  { id: "safe_zone_exit", label: "离开安全区", description: "只发送粗粒度区域标签" },
  { id: "data_gap", label: "数据缺口信号", description: "不修改快照；后端仍按当前快照给出权威风险" },
  { id: "medication_confirmed", label: "晚药确认", description: "发送结构化用药确认事件" },
  { id: "agent_failure", label: "Agent 故障演练", description: "只演示预期 fallback，不伪造真实 Agent 调用" },
] as const;

const payloadFor = (scenarioId: SimulatorScenarioId): Pick<SimulatorEventRequest, "event_type" | "payload"> => {
  switch (scenarioId) {
    case "sos":
      return { event_type: "sos", payload: {} };
    case "dizziness":
      return { event_type: "voice", payload: { symptom_keywords: ["dizziness"] } };
    case "fall":
      return { event_type: "fall", payload: { confidence: 0.9 } };
    case "safe_zone_exit":
      return { event_type: "location", payload: { event_kind: "geofence_exit", zone_label: "安全区外" } };
    case "data_gap":
      return { event_type: "device_status", payload: { data_quality: 0, wear_time_hours: 0 } };
    case "medication_confirmed":
      return { event_type: "medication", payload: { action: "confirmed", dose_period: "evening" } };
    case "agent_failure":
      return { event_type: "manual_note", payload: { simulation: "agent_failure" } };
  }
};

export function buildSimulatorRequest(
  scenarioId: SimulatorScenarioId,
  elderId: string,
  occurredAt: string,
): SimulatorEventRequest {
  const safeElderId = elderId.trim();
  if (!safeElderId) throw new Error("elder_id_required");
  if (!Number.isFinite(Date.parse(occurredAt))) throw new Error("occurred_at_invalid");
  return {
    elder_id: safeElderId,
    ...payloadFor(scenarioId),
    source: SOFTWARE_SIMULATOR_SOURCE,
    occurred_at: new Date(occurredAt).toISOString(),
  };
}

export interface SimulatorCanonicalEvent {
  event_id: number;
  elder_id: string;
  event_type: SimulatorEventRequest["event_type"];
  source: typeof SOFTWARE_SIMULATOR_SOURCE;
  occurred_at: string;
  payload: Record<string, unknown>;
  status: string;
}

export interface SimulatorRiskResult {
  status_level: RiskLevel;
  risk_score: number;
  key_reasons: string[];
  recommended_action: string;
  safety_disclaimer: string;
}

export interface SimulatorTaskResult {
  task_id: number;
  elder_id: string;
  status: string;
  risk_level: RiskLevel;
  recommended_action: string;
}

export interface SimulatorTrace {
  http_status: number;
  event: SimulatorCanonicalEvent;
  risk_result: SimulatorRiskResult;
  task: SimulatorTaskResult | null;
}

export type SimulatorApiResult =
  | { status: "ok"; data: SimulatorTrace }
  | { status: "error"; error: BackendSyncError; http_status?: number };

export interface SimulatorRequestOptions {
  baseUrl?: string | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

const RISK_LEVELS = new Set<RiskLevel>([
  "data_insufficient", "stable", "observation", "attention", "high_risk", "urgent",
]);
const EVENT_TYPES = new Set([
  "sos", "voice", "fall", "location", "device_status", "medication", "manual_note",
]);
const EVENT_STATUSES = new Set(["active"]);
const TASK_CREATING_LEVELS = new Set<RiskLevel>(["urgent", "high_risk"]);
const FORBIDDEN_KEYS = new Set([
  "raw_text", "transcript", "transcription", "audio", "recording", "voice_data", "asr_text",
  "lat", "latitude", "lng", "lon", "longitude", "gps", "gps_lat", "gps_lng", "coordinates",
  "coords", "address", "trajectory", "track", "geopoint",
  "status_level", "risk_score", "key_reasons", "recommended_action",
]);
const REQUEST_KEYS = ["elder_id", "event_type", "source", "occurred_at", "payload"] as const;
const DISCLAIMER = "本结果仅为照护风险提示，不构成医疗诊断。";
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
const safeError = (code: string, message: string, status?: number): BackendSyncError =>
  status === undefined ? { code, message } : { code, message, status };
const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const hasForbiddenKey = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) =>
    FORBIDDEN_KEYS.has(key.toLowerCase()) || hasForbiddenKey(child));
};

const isExplicitIsoTime = (value: unknown): value is string =>
  nonEmpty(value) && /(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));

const isLoopbackBaseUrl = (baseUrl: string): boolean => {
  if (baseUrl === "") return true;
  try {
    const parsed = new URL(baseUrl);
    return (
      ["http:", "https:"].includes(parsed.protocol) &&
      ["localhost", "127.0.0.1", "0.0.0.0"].includes(parsed.hostname.toLowerCase()) &&
      parsed.username === "" && parsed.password === "" && parsed.pathname.replace(/\/+$/, "") === ""
    );
  } catch {
    return false;
  }
};

const isSafeRequest = (request: unknown): request is SimulatorEventRequest => {
  if (!isRecord(request)) return false;
  const keys = Object.keys(request).sort();
  const expected = [...REQUEST_KEYS].sort();
  return (
    keys.length === expected.length && keys.every((key, index) => key === expected[index]) &&
    nonEmpty(request.elder_id) && request.elder_id === request.elder_id.trim() &&
    EVENT_TYPES.has(String(request.event_type)) &&
    request.source === SOFTWARE_SIMULATOR_SOURCE &&
    isExplicitIsoTime(request.occurred_at) &&
    isRecord(request.payload) && !hasForbiddenKey(request.payload)
  );
};

function parseTrace(
  body: unknown,
  httpStatus: number,
  request: SimulatorEventRequest,
): SimulatorTrace | null {
  if (!isRecord(body) || body.ok !== true || !isRecord(body.event) || !isRecord(body.risk_result)) return null;
  const event = body.event;
  const risk = body.risk_result;
  const eventId = event.event_id;
  if (!Number.isInteger(eventId) || (eventId as number) <= 0) return null;
  if (event.elder_id !== request.elder_id || event.event_type !== request.event_type) return null;
  if (event.source !== SOFTWARE_SIMULATOR_SOURCE || event.occurred_at !== request.occurred_at) return null;
  if (!isRecord(event.payload) || hasForbiddenKey(event.payload) || !EVENT_STATUSES.has(String(event.status))) return null;
  if (!sameJson(event.payload, request.payload)) return null;
  if (risk.elder_id !== request.elder_id || !RISK_LEVELS.has(risk.status_level as RiskLevel)) return null;
  if (!Number.isInteger(risk.risk_score) || (risk.risk_score as number) < 0 || (risk.risk_score as number) > 100) return null;
  if (!Array.isArray(risk.key_reasons) || !risk.key_reasons.every(nonEmpty) || !nonEmpty(risk.recommended_action) || risk.safety_disclaimer !== DISCLAIMER) return null;

  let task: SimulatorTaskResult | null = null;
  if (body.task === null && TASK_CREATING_LEVELS.has(risk.status_level as RiskLevel)) return null;
  if (body.task !== null) {
    if (!TASK_CREATING_LEVELS.has(risk.status_level as RiskLevel)) return null;
    if (!isRecord(body.task) || !Number.isInteger(body.task.task_id) || (body.task.task_id as number) <= 0) return null;
    if (body.task.elder_id !== request.elder_id || body.task.status !== "open") return null;
    if (body.task.risk_level !== risk.status_level || body.task.recommended_action !== risk.recommended_action) return null;
    task = {
      task_id: body.task.task_id as number,
      elder_id: body.task.elder_id,
      status: body.task.status,
      risk_level: body.task.risk_level as RiskLevel,
      recommended_action: body.task.recommended_action,
    };
  }

  return {
    http_status: httpStatus,
    event: {
      event_id: eventId as number,
      elder_id: event.elder_id,
      event_type: event.event_type as SimulatorEventRequest["event_type"],
      source: SOFTWARE_SIMULATOR_SOURCE,
      occurred_at: event.occurred_at,
      payload: { ...event.payload },
      status: event.status as string,
    },
    risk_result: {
      status_level: risk.status_level as RiskLevel,
      risk_score: risk.risk_score as number,
      key_reasons: [...risk.key_reasons] as string[],
      recommended_action: risk.recommended_action,
      safety_disclaimer: DISCLAIMER,
    },
    task,
  };
}

export async function submitSimulatorEvent(
  request: SimulatorEventRequest,
  options: SimulatorRequestOptions = {},
): Promise<SimulatorApiResult> {
  const baseUrl = options.baseUrl !== undefined ? options.baseUrl : resolveBaseUrl();
  if (baseUrl === null) {
    return { status: "error", error: safeError("static_preview", "静态预览不会发送事件，请在本地完整模式运行") };
  }
  if (!isLoopbackBaseUrl(baseUrl)) {
    return { status: "error", error: safeError("non_local_backend", "软件模拟器只允许连接本机后端") };
  }
  if (!isSafeRequest(request)) {
    return { status: "error", error: safeError("invalid_request", "事件请求不符合软件模拟契约") };
  }
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutMs = options.timeoutMs ?? 6000;
  const timer = controller && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(`${baseUrl}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(request),
      signal: controller?.signal,
    });
  } catch (error) {
    if (controller && error instanceof Error && error.name === "AbortError") {
      return { status: "error", error: safeError("timeout", "事件请求超时") };
    }
    return { status: "error", error: safeError("network", "无法连接本地后端") };
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!response.ok) {
    return { status: "error", http_status: response.status, error: safeError("http_error", "后端拒绝了事件请求", response.status) };
  }
  if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return { status: "error", http_status: response.status, error: safeError("bad_content_type", "后端响应不是 JSON") };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: "error", http_status: response.status, error: safeError("bad_json", "后端 JSON 无法解析") };
  }
  const trace = parseTrace(body, response.status, request);
  return trace
    ? { status: "ok", data: trace }
    : { status: "error", http_status: response.status, error: safeError("invalid_payload", "后端响应不符合事件契约") };
}

export function agentExerciseStatus(scenarioId: SimulatorScenarioId) {
  return scenarioId === "agent_failure"
    ? {
        state: "failure_exercise" as const,
        real_agent_called: false,
        fallback_used: false,
        expected_on_real_failure: "显式 Mock fallback",
        message: "本阶段仅演练故障显示，未调用真实 QwenPaw Agent。",
      }
    : {
        state: "not_run" as const,
        real_agent_called: false,
        fallback_used: false,
        expected_on_real_failure: null,
        message: "Stage 14 仅验证事件、规则和任务链路，未运行 Agent。",
      };
}
