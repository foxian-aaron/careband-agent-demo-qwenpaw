// src/lib/apiClient.ts — Stage 6B read-only dashboard fetch with static-preview
// fallback. Except on GitHub Pages, explicit VITE_API_BASE_URL wins (trailing slash stripped so the
// request is /api/dashboard, never //api/dashboard). On localhost/127.0.0.1/0.0.0.0
// the base is same-origin "" and the Vite dev/preview /api proxy forwards to
// http://127.0.0.1:3001. Any non-local host without an explicit base URL is a
// static preview (no /api request made). Errors use short safe codes; response
// bodies, HTML, file paths, stacks, tokens and credentials are never echoed.

import type { BackendSyncError } from "../types";

export type { BackendSyncError };
export type FetchLike = typeof fetch;
export type FetchDashboardResult =
  | { status: "connected"; data: unknown }
  | { status: "mock"; error: BackendSyncError };

const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);
const DEFAULT_TIMEOUT_MS = 6000;
const safeEnv = (): Record<string, string | undefined> => {
  try {
    const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
    return env && typeof env === "object"
      ? (env as Record<string, string | undefined>)
      : {};
  } catch {
    return {};
  }
};
const currentHostname = (): string => {
  try {
    return typeof window !== "undefined" && window.location ? window.location.hostname : "";
  } catch {
    return "";
  }
};

export interface ResolveBaseUrlInput {
  env?: Record<string, string | undefined>;
  hostname?: string;
}
/** Resolve the dashboard API base URL; null means static preview (no request). */
export function resolveBaseUrl(input: ResolveBaseUrlInput = {}): string | null {
  const hostname = (input.hostname ?? currentHostname()).toLowerCase();
  // GitHub Pages is always the static Mock preview, even if a build-time API
  // URL was accidentally configured.
  if (hostname.endsWith(".github.io")) return null;
  const explicit = (input.env ?? safeEnv())?.VITE_API_BASE_URL;
  if (typeof explicit === "string" && explicit.trim() !== "") {
    return explicit.trim().replace(/\/+$/, "");
  }
  // Local dev/preview: same-origin base (""). The browser GETs /api/dashboard on
  // its own origin (no CORS) and the Vite /api proxy forwards to 127.0.0.1:3001.
  return typeof hostname === "string" && LOCALHOST_HOSTS.has(hostname) ? "" : null;
}

const safeError = (code: string, message: string, status?: number): BackendSyncError =>
  status !== undefined ? { code, message, status } : { code, message };
export interface FetchDashboardOptions {
  baseUrl?: string | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/** GET /api/dashboard once. Requires JSON content-type, HTTP success and ok===true. */
export async function fetchDashboard(
  options: FetchDashboardOptions = {},
): Promise<FetchDashboardResult> {
  const baseUrl = options.baseUrl !== undefined ? options.baseUrl : resolveBaseUrl();
  if (baseUrl === null) {
    return {
      status: "mock",
      error: safeError("static_preview", "静态预览，使用本地 Mock 数据"),
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer =
    controller && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/api/dashboard`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller ? controller.signal : undefined,
    });
  } catch (err) {
    if (controller && err instanceof Error && err.name === "AbortError") {
      return { status: "mock", error: safeError("timeout", "请求超时，使用本地 Mock 数据") };
    }
    return { status: "mock", error: safeError("network", "网络错误，使用本地 Mock 数据") };
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!response.ok) {
    return {
      status: "mock",
      error: safeError("http_error", "服务器返回错误状态，使用本地 Mock 数据", response.status),
    };
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return {
      status: "mock",
      error: safeError("bad_content_type", "响应非 JSON，使用本地 Mock 数据"),
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: "mock", error: safeError("bad_json", "响应解析失败，使用本地 Mock 数据") };
  }

  if (
    typeof body !== "object" ||
    body === null ||
    (body as { ok?: unknown }).ok !== true
  ) {
    return {
      status: "mock",
      error: safeError("invalid_payload", "响应结构无效，使用本地 Mock 数据"),
    };
  }
  return { status: "connected", data: body };
}

// ---------------------------------------------------------------------------
// Stage 6C — safe JSON writes: POST /api/events, PATCH /api/tasks/:id
// ---------------------------------------------------------------------------

export type WriteResult =
  | { status: "ok" }
  | { status: "error"; error: BackendSyncError };

export interface WriteOptions {
  baseUrl?: string | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/**
 * Shared safe JSON write helper. Requires HTTP success, application/json
 * content-type and body.ok === true. Response bodies, paths, stacks and
 * credentials are never echoed back — only a short safe error code/message.
 */
const safeJsonWrite = async (
  method: string,
  url: string,
  body: Record<string, unknown>,
  options: WriteOptions,
): Promise<WriteResult> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer =
    controller && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined,
    });
  } catch (err) {
    if (controller && err instanceof Error && err.name === "AbortError") {
      return { status: "error", error: safeError("timeout", "写入请求超时") };
    }
    return { status: "error", error: safeError("network", "网络错误，写入失败") };
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!response.ok) {
    return {
      status: "error",
      error: safeError("http_error", "服务器返回错误状态，写入失败", response.status),
    };
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return { status: "error", error: safeError("bad_content_type", "响应非 JSON，写入失败") };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return { status: "error", error: safeError("bad_json", "响应解析失败，写入失败") };
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { ok?: unknown }).ok !== true
  ) {
    return { status: "error", error: safeError("invalid_payload", "响应结构无效，写入失败") };
  }
  return { status: "ok" };
};

/** POST /api/events with a safe JSON body. Static preview (null base) never fetches. */
export async function postEvent(
  body: Record<string, unknown>,
  options: WriteOptions = {},
): Promise<WriteResult> {
  const baseUrl = options.baseUrl !== undefined ? options.baseUrl : resolveBaseUrl();
  if (baseUrl === null) {
    return { status: "error", error: safeError("static_preview", "静态预览，无法写入") };
  }
  return safeJsonWrite("POST", `${baseUrl}/api/events`, body, options);
}

/** PATCH /api/tasks/:id with a safe JSON body. Static preview never fetches. */
export async function patchTask(
  taskId: string,
  body: Record<string, unknown>,
  options: WriteOptions = {},
): Promise<WriteResult> {
  const baseUrl = options.baseUrl !== undefined ? options.baseUrl : resolveBaseUrl();
  if (baseUrl === null) {
    return { status: "error", error: safeError("static_preview", "静态预览，无法写入") };
  }
  return safeJsonWrite(
    "PATCH",
    `${baseUrl}/api/tasks/${encodeURIComponent(taskId)}`,
    body,
    options,
  );
}

// ---------------------------------------------------------------------------
// Stage 9B — TEST001-only CSV DailySnapshot import client
// ---------------------------------------------------------------------------

export const MAX_CSV_BYTES = 64 * 1024;
const CSV_TEST_SUBJECT = "TEST001";

export interface BackendCsvSnapshot {
  elder_id: string;
  date: string;
  data_source: string;
  heart_rate_avg?: number | null;
  resting_heart_rate?: number | null;
  steps?: number | null;
  active_minutes?: number | null;
  sleep_duration?: number | null;
  wear_time_hours?: number | null;
  data_quality?: number | null;
}

export interface BackendDateRange {
  start: string;
  end: string;
}

export interface BackendCsvImportPreview {
  ok: true;
  count: number;
  snapshots: BackendCsvSnapshot[];
  date_range: BackendDateRange;
  quality_summary: Record<string, unknown>;
  warnings: string[];
}

export interface BackendCsvImportConfirmation {
  ok: true;
  import_run_id: number;
  imported: number;
  date_range: BackendDateRange;
}

export interface BackendCsvImportRun {
  import_run_id: number;
  elder_id: string;
  created_at: string;
  source: string | null;
  file_name: string;
  row_count: number | null;
  date_range: BackendDateRange | null;
  quality_summary: Record<string, unknown> | null;
}

export interface BackendCsvImportHistory {
  ok: true;
  elder_id: "TEST001";
  limit: number;
  runs: BackendCsvImportRun[];
}

export type CsvApiResult<T> =
  | { status: "ok"; data: T }
  | { status: "error"; error: BackendSyncError };

export type CsvDecodeResult =
  | { status: "ok"; text: string }
  | { status: "error"; error: BackendSyncError };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const isRequiredBoundedNumber = (
  value: unknown,
  minimum: number,
  maximum: number,
  integer = false,
) => (
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= minimum &&
  value <= maximum &&
  (!integer || Number.isInteger(value))
);

const isBoundedNumber = (
  value: unknown,
  minimum: number,
  maximum: number,
  integer = false,
) => value === null || isRequiredBoundedNumber(value, minimum, maximum, integer);

const isDate = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

const isDateRange = (value: unknown): value is BackendDateRange =>
  isRecord(value) &&
  hasExactKeys(value, ["start", "end"]) &&
  isDate(value.start) &&
  isDate(value.end) &&
  value.start <= value.end;

const SNAPSHOT_KEYS = [
  "elder_id",
  "date",
  "data_source",
  "heart_rate_avg",
  "resting_heart_rate",
  "steps",
  "active_minutes",
  "sleep_duration",
  "wear_time_hours",
  "data_quality",
] as const;

const QUALITY_KEYS = [
  "rows",
  "avg_data_quality",
  "min_data_quality",
  "max_data_quality",
  "low_quality_rows",
] as const;

const isQualitySummary = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) &&
  hasExactKeys(value, QUALITY_KEYS) &&
  isRequiredBoundedNumber(value.rows, 1, 366, true) &&
  isBoundedNumber(value.avg_data_quality, 0, 100) &&
  isBoundedNumber(value.min_data_quality, 0, 100) &&
  isBoundedNumber(value.max_data_quality, 0, 100) &&
  isRequiredBoundedNumber(value.low_quality_rows, 0, 366, true);

const isSnapshot = (row: unknown): row is BackendCsvSnapshot =>
  isRecord(row) &&
  hasExactKeys(row, SNAPSHOT_KEYS) &&
  row.elder_id === CSV_TEST_SUBJECT &&
  isDate(row.date) &&
  row.data_source === "CSV Import" &&
  isBoundedNumber(row.heart_rate_avg, 20, 250) &&
  isBoundedNumber(row.resting_heart_rate, 20, 200) &&
  isBoundedNumber(row.steps, 0, 200000, true) &&
  isBoundedNumber(row.active_minutes, 0, 1440) &&
  isBoundedNumber(row.sleep_duration, 0, 24) &&
  isBoundedNumber(row.wear_time_hours, 0, 24) &&
  isBoundedNumber(row.data_quality, 0, 100);

export function formatCsvWarning(warning: string): string | null {
  const missing = warning.match(/^([1-9]\d{0,2}) row\(s\) contain one or more missing measurements$/);
  if (missing && Number(missing[1]) <= 366) return `${missing[1]} 行包含缺失测量值`;
  const lowQuality = warning.match(/^([1-9]\d{0,2}) row\(s\) have data_quality below 50$/);
  if (lowQuality && Number(lowQuality[1]) <= 366) return `${lowQuality[1]} 行数据质量低于 50`;
  return null;
}

const isPreview = (value: unknown): value is BackendCsvImportPreview =>
  isRecord(value) &&
  hasExactKeys(value, ["ok", "count", "snapshots", "date_range", "quality_summary", "warnings"]) &&
  value.ok === true &&
  Number.isInteger(value.count) &&
  typeof value.count === "number" &&
  value.count >= 1 &&
  value.count <= 366 &&
  Array.isArray(value.snapshots) &&
  value.snapshots.length === value.count &&
  value.snapshots.every(isSnapshot) &&
  isDateRange(value.date_range) &&
  isQualitySummary(value.quality_summary) &&
  Array.isArray(value.warnings) &&
  value.warnings.length <= 366 &&
  value.warnings.every((warning) => typeof warning === "string" && formatCsvWarning(warning) !== null);

const isConfirmation = (value: unknown): value is BackendCsvImportConfirmation =>
  isRecord(value) &&
  hasExactKeys(value, ["ok", "import_run_id", "imported", "date_range"]) &&
  value.ok === true &&
  Number.isInteger(value.import_run_id) &&
  typeof value.import_run_id === "number" &&
  value.import_run_id > 0 &&
  Number.isInteger(value.imported) &&
  typeof value.imported === "number" &&
  value.imported >= 1 &&
  value.imported <= 366 &&
  isDateRange(value.date_range);

const IMPORT_RUN_KEYS = [
  "import_run_id",
  "elder_id",
  "created_at",
  "source",
  "file_name",
  "row_count",
  "date_range",
  "quality_summary",
] as const;

const isImportRun = (run: unknown): run is BackendCsvImportRun =>
  isRecord(run) &&
  hasExactKeys(run, IMPORT_RUN_KEYS) &&
  Number.isInteger(run.import_run_id) &&
  typeof run.import_run_id === "number" &&
  run.import_run_id > 0 &&
  run.elder_id === CSV_TEST_SUBJECT &&
  typeof run.created_at === "string" &&
  run.created_at.length <= 64 &&
  (run.source === null || run.source === "csv_import") &&
  run.file_name === "daily_snapshots.csv" &&
  (run.row_count === null || isBoundedNumber(run.row_count, 1, 366, true)) &&
  (run.date_range === null || isDateRange(run.date_range)) &&
  (run.quality_summary === null || isQualitySummary(run.quality_summary));

const isHistory = (value: unknown): value is BackendCsvImportHistory =>
  isRecord(value) &&
  hasExactKeys(value, ["ok", "elder_id", "limit", "runs"]) &&
  value.ok === true &&
  value.elder_id === CSV_TEST_SUBJECT &&
  value.limit === 20 &&
  Array.isArray(value.runs) &&
  value.runs.length <= 20 &&
  value.runs.every(isImportRun);

export function validateCsvText(csvText: string): BackendSyncError | null {
  if (typeof csvText !== "string" || csvText.trim() === "") {
    return safeError("invalid_csv", "请选择非空 CSV 文件");
  }
  if (new TextEncoder().encode(csvText).byteLength > MAX_CSV_BYTES) {
    return safeError("csv_too_large", "CSV 文件超过 64 KiB 限制");
  }
  return null;
}

export function decodeUtf8Csv(bytes: ArrayBuffer): CsvDecodeResult {
  try {
    return { status: "ok", text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { status: "error", error: safeError("invalid_encoding", "CSV 必须使用 UTF-8 编码") };
  }
}

export const isLocalCsvBaseUrl = (baseUrl: string, pageHostname = currentHostname()) => {
  const hostname = pageHostname.toLowerCase();
  if (hostname !== "" && !LOCALHOST_HOSTS.has(hostname)) return false;
  if (baseUrl === "") {
    return true;
  }
  try {
    const url = new URL(baseUrl);
    return ["http:", "https:"].includes(url.protocol) && LOCALHOST_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
};

const csvApiRequest = async <T>(
  method: "GET" | "POST",
  path: string,
  body: Record<string, unknown> | null,
  options: WriteOptions,
  validate: (value: unknown) => value is T,
): Promise<CsvApiResult<T>> => {
  const baseUrl = options.baseUrl !== undefined ? options.baseUrl : resolveBaseUrl();
  if (baseUrl === null) {
    return { status: "error", error: safeError("static_preview", "静态预览不可导入") };
  }
  if (!isLocalCsvBaseUrl(baseUrl)) {
    return { status: "error", error: safeError("local_only", "CSV 导入仅允许连接本机服务") };
  }
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = controller && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(`${baseUrl}${path}`, {
      method,
      headers: body
        ? { "content-type": "application/json", accept: "application/json" }
        : { accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller?.signal,
    });
  } catch (error) {
    if (controller && error instanceof Error && error.name === "AbortError") {
      return { status: "error", error: safeError("timeout", "导入请求超时") };
    }
    return { status: "error", error: safeError("network", "导入服务暂时不可用") };
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!response.ok) {
    return {
      status: "error",
      error: safeError("http_error", "服务器拒绝导入请求", response.status),
    };
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return { status: "error", error: safeError("bad_content_type", "导入响应格式错误") };
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return { status: "error", error: safeError("bad_json", "导入响应解析失败") };
  }
  if (!validate(parsed)) {
    return { status: "error", error: safeError("invalid_payload", "导入响应结构无效") };
  }
  return { status: "ok", data: parsed };
};

export async function previewDailySnapshotsCsv(
  csvText: string,
  options: WriteOptions = {},
): Promise<CsvApiResult<BackendCsvImportPreview>> {
  const validationError = validateCsvText(csvText);
  if (validationError) return { status: "error", error: validationError };
  return csvApiRequest(
    "POST",
    "/api/import/daily-snapshots-csv/preview",
    { elder_id: CSV_TEST_SUBJECT, csv_text: csvText },
    options,
    isPreview,
  );
}

export async function confirmDailySnapshotsCsv(
  csvText: string,
  options: WriteOptions = {},
): Promise<CsvApiResult<BackendCsvImportConfirmation>> {
  const validationError = validateCsvText(csvText);
  if (validationError) return { status: "error", error: validationError };
  return csvApiRequest(
    "POST",
    "/api/import/daily-snapshots-csv",
    { elder_id: CSV_TEST_SUBJECT, csv_text: csvText },
    options,
    isConfirmation,
  );
}

export async function fetchDailySnapshotsCsvHistory(
  options: WriteOptions = {},
): Promise<CsvApiResult<BackendCsvImportHistory>> {
  return csvApiRequest(
    "GET",
    "/api/import/daily-snapshots-csv/history?elder_id=TEST001&limit=20",
    null,
    options,
    isHistory,
  );
}
