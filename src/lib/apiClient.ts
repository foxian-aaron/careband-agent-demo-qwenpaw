const env = import.meta.env ?? {};
const isLocalViteDev =
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1"].includes(window.location.hostname) &&
  window.location.port === "5173";
export const API_BASE_URL = env.VITE_API_BASE_URL ?? (isLocalViteDev ? "http://127.0.0.1:3001" : "");

const API_TIMEOUT_MS = Number(env.VITE_API_TIMEOUT_MS ?? 8000);
const AGENT_TIMEOUT_MS = Number(env.VITE_AGENT_TIMEOUT_MS ?? 30000);

const previewText = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 160);

export class ApiRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

export const requestJson = async <T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = API_TIMEOUT_MS,
): Promise<T> => {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`API request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    const text = await response.text();
    throw new Error(
      `API did not return JSON. status=${response.status}, content-type=${contentType || "unknown"}, preview=${previewText(text)}`,
    );
  }

  const payload = (await response.json()) as T & { ok?: boolean; error?: string };
  if (!response.ok || payload.ok === false) {
    throw new ApiRequestError(
      payload.error ?? `API request failed with ${response.status}`,
      response.status,
    );
  }
  return payload;
};

export const apiGetDashboard = () =>
  requestJson<BackendDashboardResponse>(`${API_BASE_URL}/api/dashboard`);

export const apiPostSnapshot = (snapshot: BackendSnapshotInput) =>
  requestJson<{ ok: true; snapshot: BackendSnapshot }>(
    `${API_BASE_URL}/api/snapshots`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    },
  );

const createCsvImportForm = (input: BackendCsvImportInput) => {
  const form = new FormData();
  form.append("file", input.file, input.filename ?? "daily-snapshots.csv");
  form.append("elder_id", input.elderId);
  form.append("source", input.source);
  return form;
};

export const apiPreviewDailySnapshotsCsv = (input: BackendCsvImportInput) =>
  requestJson<BackendCsvImportResponse>(
    `${API_BASE_URL}/api/import/daily-snapshots-csv/preview`,
    {
      method: "POST",
      body: createCsvImportForm(input),
    },
  );

export const apiImportDailySnapshotsCsv = (input: BackendCsvImportInput) =>
  requestJson<BackendCsvImportResponse>(
    `${API_BASE_URL}/api/import/daily-snapshots-csv`,
    {
      method: "POST",
      body: createCsvImportForm(input),
    },
  );

export const apiGetDailySnapshotsCsvHistory = (elderId: string) =>
  requestJson<BackendCsvImportHistoryResponse>(
    `${API_BASE_URL}/api/import/daily-snapshots-csv/history?elder_id=${encodeURIComponent(elderId)}`,
  );

export const apiPostEvent = (event: BackendEventInput) =>
  requestJson<{
    ok: true;
    event: BackendEvent;
    risk_result: BackendRiskResult;
    task: BackendTask | null;
  }>(
    `${API_BASE_URL}/api/events`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    },
  );

export const submitNormalizedEvent = async (event: BackendEventInput) => {
  const eventResponse = await apiPostEvent(event);
  try {
    const agentResponse = await apiAnalyzeAgent({
      elder_id: eventResponse.event.elder_id,
      source_event_id: eventResponse.event.event_id,
    });
    return { eventResponse, agentResponse, agentError: null };
  } catch (error) {
    return {
      eventResponse,
      agentResponse: null,
      agentError: error instanceof Error ? error.message : "Agent request failed.",
    };
  }
};

export const apiPatchTask = (taskId: string, changes: BackendTaskPatch) =>
  requestJson<{ ok: true; task: BackendTask }>(
    `${API_BASE_URL}/api/tasks/${taskId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    },
  );

export const apiAnalyzeAgent = (input: BackendAgentAnalyzeInput) =>
  requestJson<BackendAgentAnalyzeResponse>(
    `${API_BASE_URL}/api/agent/analyze`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    AGENT_TIMEOUT_MS,
  );

export const apiResetDemo = () =>
  requestJson<{ ok: true; reset: Record<string, number>; preserved_elder_ids: string[] }>(
    `${API_BASE_URL}/api/demo/reset`,
    { method: "POST" },
  );

export interface BackendDashboardResponse {
  ok: true;
  generated_at: string;
  elders: BackendDashboardRow[];
}

export interface BackendCsvImportInput {
  elderId: string;
  source: string;
  file: Blob;
  filename?: string;
}

export interface BackendCsvImportPreview {
  warnings?: string[];
  date_range?: { start: string | null; end: string | null };
  quality_summary?: Record<string, unknown>;
  sample_daily_snapshots?: BackendSnapshot[];
  [key: string]: unknown;
}

export interface BackendCsvImportResponse {
  ok: true;
  import_id?: string;
  count: number;
  snapshots: BackendSnapshot[];
  preview?: BackendCsvImportPreview;
}

export interface BackendImportRun {
  import_id: string;
  elder_id: string;
  source_type: string;
  file_name: string | null;
  status: string;
  snapshot_count: number;
  date_start: string | null;
  date_end: string | null;
  quality_summary: Record<string, unknown>;
  warnings: string[];
  created_at: string;
}

export interface BackendCsvImportHistoryResponse {
  ok: true;
  imports: BackendImportRun[];
}

export interface BackendDashboardRow {
  elder: BackendElder;
  baseline: BackendBaseline;
  latest_snapshot: BackendSnapshot | null;
  recent_snapshots?: BackendSnapshot[];
  events: BackendEvent[];
  risk_result: BackendRiskResult | null;
  tasks: BackendTask[];
  latest_agent_output: BackendAgentOutput | null;
  latest_agent_run?: BackendAgentRun | null;
}

export interface BackendElder {
  elder_id: string;
  name: string;
  age: number;
  room: string;
  risk_tags: string[];
  subject_kind?: "elder" | "team_test";
  created_at: string;
}

export interface BackendBaseline {
  elder_id: string;
  avg_steps_7d: number;
  avg_sleep_7d: number;
  avg_active_minutes_7d: number;
  resting_hr_baseline: number;
  baseline_confidence: number;
  baseline_label?: string;
  usable_days?: number;
}

export interface BackendSnapshot {
  snapshot_id: string;
  elder_id: string;
  date: string;
  data_source: string;
  heart_rate_avg: number | null;
  resting_heart_rate: number | null;
  steps: number | null;
  active_minutes: number | null;
  sleep_duration: number | null;
  wear_time_hours: number | null;
  data_quality: number;
  created_at: string;
}

export type BackendSnapshotInput = Omit<BackendSnapshot, "snapshot_id" | "created_at"> & {
  snapshot_id?: string;
  created_at?: string;
};

export interface BackendEvent {
  event_id: string;
  elder_id: string;
  event_type: string;
  timestamp: string;
  source: string;
  raw_text: string | null;
  payload: Record<string, unknown>;
  status?: "open" | "resolved";
  resolved_at?: string | null;
  resolved_by?: string | null;
  linked_task_id?: string | null;
  created_at: string;
}

export interface BackendEventInput {
  event_id?: string;
  elder_id: string;
  event_type: string;
  timestamp?: string;
  source?: string;
  raw_text?: string | null;
  payload?: Record<string, unknown>;
}

export interface BackendRiskResult {
  elder_id: string;
  status_level:
    | "data_insufficient"
    | "stable"
    | "observation"
    | "attention"
    | "high_risk"
    | "urgent";
  risk_score: number;
  key_reasons: string[];
  triggered_rules: string[];
  recommended_action: string;
  data_quality: number;
  safety_disclaimer: string;
}

export interface BackendTask {
  task_id: string;
  elder_id: string;
  source_event_id: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  task_title: string;
  task_reason: string;
  recommended_action: string;
  status: "open" | "acknowledged" | "in_progress" | "resolved" | "cancelled";
  handled_by: string | null;
  handled_note: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface BackendTaskPatch {
  status?: "open" | "acknowledged" | "in_progress" | "resolved" | "cancelled";
  handled_by?: string | null;
  handled_note?: string | null;
  completed_at?: string | null;
}

export interface BackendAgentAnalyzeInput {
  elder_id: string;
  source_event_id?: string | null;
}

export interface BackendAgentResult {
  status_level: BackendRiskResult["status_level"];
  risk_score: number;
  caregiver_summary: string;
  family_summary: string;
  institution_summary: string;
  recommended_action: string;
  safety_disclaimer: string;
  key_reasons: string[];
}

export interface BackendAgentMeta {
  provider: "qwenpaw" | "openai" | "mock";
  requested_provider: "qwenpaw" | "openai" | "mock";
  model: string;
  is_real: boolean;
  fallback_used: boolean;
  duration_ms: number;
  validation_status: "valid" | "fallback_valid" | "failed";
  attempts: number;
  warning?: string | null;
  run_id?: string;
}

export interface BackendAgentAnalyzeResponse {
  ok: true;
  output_id: string;
  run_id: string;
  elder_id: string;
  source_event_id?: string | null;
  agent_result: BackendAgentResult;
  meta: BackendAgentMeta;
  created_at: string;
}

export interface BackendAgentOutput {
  output_id: string;
  elder_id: string;
  source_event_id?: string | null;
  status_level: BackendRiskResult["status_level"];
  risk_score: number;
  caregiver_summary: string;
  family_summary: string;
  institution_summary: string;
  recommended_action: string;
  safety_disclaimer: string;
  key_reasons: string[];
  agent_source: "mock" | "qwenpaw" | "openai";
  warning?: string | null;
  created_at: string;
}

export interface BackendAgentRun {
  run_id: string;
  elder_id: string;
  source_event_id?: string | null;
  provider: "mock" | "qwenpaw" | "openai";
  model?: string | null;
  duration_ms?: number | null;
  validation_status: "valid" | "fallback_valid" | "failed";
  fallback_used: boolean;
  error_reason?: string | null;
  created_at: string;
}
