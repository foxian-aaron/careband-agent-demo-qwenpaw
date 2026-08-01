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
