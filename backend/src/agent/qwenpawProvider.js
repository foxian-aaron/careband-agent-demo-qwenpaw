// backend/src/agent/qwenpawProvider.js
//
// CareBand Stage 7B — minimal QwenPaw Desktop Provider transport bridge.
// Discovers the local Desktop port, runs ONE /api/console/chat SSE exchange
// against the fixed CareBand Summary Agent, verifies the persisted chat, then
// returns the raw assistant text + provider trace. No retry, no fallback, no
// business-JSON parsing (Stage 8). Base URL is always http://127.0.0.1:<port>
// read dynamically from a port file (never hardcoded, never 8088). Every
// public error carries only a fixed code: message === code; nothing else leaks.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_PORT_FILE = join(homedir(), ".qwenpaw", "desktop_port");
const FIXED_AGENT_ID = "careband_summary_agent";
const FIXED_PROVIDER = "zhipu-cn-codingplan";
const FIXED_MODEL = "glm-5.2";
const SUPPORTED_VERSION = "2.0.1";
const USER_ID = "careband-backend";
const CHANNEL = "console";
const TOOL_TYPES = new Set(["plugin_call", "tool_call", "plugin_call_output", "tool_call_output"]);
const RUN_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

/** Public error type. `message` and `code` are always the same fixed code. */
export class QwenPawProviderError extends Error {
  constructor(code) {
    super(code);
    this.name = "QwenPawProviderError";
    this.code = code;
  }
}

const fail = (code) => new QwenPawProviderError(code);
const isPosInt = (v) => Number.isInteger(v) && v > 0;

function armTimeout(controller, timeoutMs) {
  const t = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof t.unref === "function") t.unref();
  return t;
}

function resolveOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw fail("QWENPAW_CONFIG_INVALID");
  }
  const o = options;
  const portFile = o.portFile === undefined ? DEFAULT_PORT_FILE : o.portFile;
  if (typeof portFile !== "string" || portFile === "") throw fail("QWENPAW_CONFIG_INVALID");
  const timeoutMs = o.timeoutMs === undefined ? 30000 : o.timeoutMs;
  if (!isPosInt(timeoutMs)) throw fail("QWENPAW_CONFIG_INVALID");
  const maxResponseBytes = o.maxResponseBytes === undefined ? 4 * 1024 * 1024 : o.maxResponseBytes;
  if (!isPosInt(maxResponseBytes)) throw fail("QWENPAW_CONFIG_INVALID");
  let runId;
  if (o.runId === undefined) runId = randomUUID();
  else if (typeof o.runId !== "string" || !RUN_ID_RE.test(o.runId)) throw fail("QWENPAW_CONFIG_INVALID");
  else runId = o.runId;
  const agentId = o.agentId === undefined ? FIXED_AGENT_ID : o.agentId;
  if (agentId !== FIXED_AGENT_ID) throw fail("QWENPAW_CONFIG_INVALID");
  const fetchImpl = o.fetchImpl === undefined ? globalThis.fetch : o.fetchImpl;
  if (typeof fetchImpl !== "function") throw fail("QWENPAW_CONFIG_INVALID");
  return { portFile, timeoutMs, maxResponseBytes, runId, agentId, fetchImpl };
}

// Read ASCII port; trim; must be a decimal integer in [1, 65535].
function resolvePort(portFile) {
  let raw;
  try {
    raw = readFileSync(portFile, "utf8");
  } catch {
    throw fail("QWENPAW_CONFIG_INVALID");
  }
  const trimmed = String(raw).trim();
  if (!/^[0-9]+$/.test(trimmed)) throw fail("QWENPAW_CONFIG_INVALID");
  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 8088) throw fail("QWENPAW_CONFIG_INVALID");
  return port;
}

// Single JSON request with its own timeout. Non-2xx -> HTTP_ERROR; abort ->
// TIMEOUT; other transport failure -> UNAVAILABLE; unparseable JSON -> jsonErrorCode.
async function fetchJson(url, init, ctx, jsonErrorCode) {
  const controller = new AbortController();
  const timer = armTimeout(controller, ctx.timeoutMs);
  let res;
  try {
    res = await ctx.fetchImpl(url, { ...init, redirect: "error", signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    if (controller.signal.aborted) throw fail("QWENPAW_TIMEOUT");
    throw fail("QWENPAW_UNAVAILABLE");
  }
  if (!res.ok) {
    clearTimeout(timer);
    try {
      await res.body?.cancel?.();
    } catch {
      /* best-effort release */
    }
    throw fail("QWENPAW_HTTP_ERROR");
  }
  try {
    const data = await res.json();
    clearTimeout(timer);
    return data;
  } catch {
    clearTimeout(timer);
    if (controller.signal.aborted) throw fail("QWENPAW_TIMEOUT");
    throw fail(jsonErrorCode);
  }
}

// Validate one decoded SSE event; record [DONE] / final text; throw fixed codes
// on malformed JSON, remote failure status, tool activity.
function processEvent(rawEvent, state) {
  const dataLines = [];
  for (const line of rawEvent.split("\n")) {
    if (line.startsWith("data:")) {
      let p = line.slice(5);
      if (p.startsWith(" ")) p = p.slice(1);
      dataLines.push(p);
    }
  }
  if (dataLines.length === 0) return;
  const data = dataLines.join("\n");
  if (data === "[DONE]") {
    state.sawDone = true;
    return;
  }
  let frame;
  try {
    frame = JSON.parse(data);
  } catch {
    throw fail("QWENPAW_SSE_INVALID");
  }
  if (!frame || typeof frame !== "object") throw fail("QWENPAW_SSE_INVALID");
  const status = typeof frame.status === "string" ? frame.status : "";
  if (["failed", "error", "cancelled"].includes(status) || frame.error) throw fail("QWENPAW_REMOTE_FAILED");
  const outputs = Array.isArray(frame.output) ? frame.output : [];
  for (const e of outputs) {
    if (!e || typeof e !== "object") continue;
    const t = typeof e.type === "string" ? e.type : typeof e.object === "string" ? e.object : null;
    if (t && TOOL_TYPES.has(t)) throw fail("QWENPAW_TOOL_ACTIVITY");
  }
  // Only a completed frame's output contributes the final assistant text:
  // the last assistant message whose type/object is absent or "message",
  // whose status is absent or "completed", and whose text is non-empty.
  if (status === "completed") {
    let candidate = null;
    for (const e of outputs) {
      if (!e || typeof e !== "object") continue;
      if (e.role !== undefined && e.role !== "assistant") continue;
      const et = e.type !== undefined ? e.type : e.object;
      if (et !== undefined && et !== "message") continue;
      if (e.status !== undefined && e.status !== "completed") continue;
      const text = typeof e.text === "string"
        ? e.text
        : Array.isArray(e.content)
          ? e.content.filter((p) => p && p.type === "text" && p.delta !== true && typeof p.text === "string").map((p) => p.text).join("")
          : "";
      if (text.length > 0) candidate = text;
    }
    if (candidate !== null) state.finalText = candidate;
    if (frame.object === "response" && Array.isArray(frame.output)) state.sawTerminal = true;
  }
}

// Stream the SSE body with a UTF-8 TextDecoder, enforcing a byte cap.
async function streamChat(res, ctx) {
  if (!res.body || typeof res.body.getReader !== "function") throw fail("QWENPAW_SSE_INVALID");
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let total = 0;
  const state = { sawDone: false, sawTerminal: false, finalText: null };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > ctx.maxResponseBytes) throw fail("QWENPAW_RESPONSE_TOO_LARGE");
      // Normalise CR/CRLF to LF so the \n\n delimiter is stable regardless of
      // how multi-byte UTF-8 landed across chunk boundaries.
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        processEvent(rawEvent, state);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim() !== "") processEvent(buffer, state);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
  if (!state.sawDone && !state.sawTerminal) throw fail("QWENPAW_SSE_INVALID");
  if (state.finalText === null) throw fail("QWENPAW_FINAL_MISSING");
  return state.finalText;
}

/** GET the chat list and return exactly the single chat matching sessionId. */
async function findSessionChat(listUrl, baseHeaders, ctx, sessionId) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const data = await fetchJson(listUrl, { method: "GET", headers: baseHeaders }, ctx, "QWENPAW_CHAT_NOT_VISIBLE");
    const chats = Array.isArray(data) ? data : Array.isArray(data && data.chats) ? data.chats : [];
    const matches = chats.filter((c) => c && c.session_id === sessionId);
    if (matches.length > 1) throw fail("QWENPAW_CHAT_NOT_VISIBLE");
    if (matches.length === 1) return matches;
    if (attempt < 9) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw fail("QWENPAW_CHAT_NOT_VISIBLE");
}

/**
 * Run one CareBand summary exchange through the local QwenPaw Desktop.
 * @param {object} task     opaque task object; serialised verbatim as the user
 *                          message text via JSON.stringify. Never inspected.
 * @param {object} [options]
 * @returns {Promise<object>} provider trace (requested/actual provider, model,
 *                          agentId, sessionId, chatId, responseText, fallback_used).
 */
export async function runQwenPawAgent(task, options = {}) {
  if (task === undefined || task === null) throw fail("QWENPAW_CONFIG_INVALID");
  const ctx = resolveOptions(options);
  let userText;
  try {
    userText = JSON.stringify(task);
  } catch {
    throw fail("QWENPAW_CONFIG_INVALID");
  }
  if (typeof userText !== "string") throw fail("QWENPAW_CONFIG_INVALID");
  const port = resolvePort(ctx.portFile);
  const baseUrl = `http://127.0.0.1:${port}`;
  const baseHeaders = { "X-Agent-Id": ctx.agentId };
  const sessionId = `careband-runtime:${ctx.runId}`;

  // --- preflight: version + agent readiness ---
  const ver = await fetchJson(`${baseUrl}/api/version`, { method: "GET", headers: baseHeaders }, ctx, "QWENPAW_VERSION_UNSUPPORTED");
  if (!ver || typeof ver !== "object" || ver.version !== SUPPORTED_VERSION) throw fail("QWENPAW_VERSION_UNSUPPORTED");

  const agentsData = await fetchJson(`${baseUrl}/api/agents`, { method: "GET", headers: baseHeaders }, ctx, "QWENPAW_AGENT_NOT_READY");
  const agentList = Array.isArray(agentsData) ? agentsData : Array.isArray(agentsData && agentsData.agents) ? agentsData.agents : [];
  const agent = agentList.find((a) => a && (a.agent_id === ctx.agentId || a.id === ctx.agentId));
  if (!agent) throw fail("QWENPAW_AGENT_NOT_READY");
  const activeModel = agent.active_model || {};
  if (activeModel.provider_id !== FIXED_PROVIDER || activeModel.model !== FIXED_MODEL) throw fail("QWENPAW_AGENT_NOT_READY");

  // --- chat: exactly one POST, no retry ---
  const chatBody = { session_id: sessionId, user_id: USER_ID, channel: CHANNEL, stream: true, input: [{ role: "user", content: [{ type: "text", text: userText }] }] };
  const chatHeaders = { ...baseHeaders, Accept: "text/event-stream", "Content-Type": "application/json" };
  const controller = new AbortController();
  const timer = armTimeout(controller, ctx.timeoutMs);
  let res;
  try {
    res = await ctx.fetchImpl(`${baseUrl}/api/console/chat`, { method: "POST", headers: chatHeaders, body: JSON.stringify(chatBody), redirect: "error", signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    if (controller.signal.aborted) throw fail("QWENPAW_TIMEOUT");
    throw fail("QWENPAW_UNAVAILABLE");
  }
  if (!res.ok) {
    clearTimeout(timer);
    try {
      await res.body?.cancel?.();
    } catch {
      /* best-effort release */
    }
    throw fail("QWENPAW_HTTP_ERROR");
  }
  let finalText;
  try {
    finalText = await streamChat(res, ctx);
  } catch (err) {
    if (err instanceof QwenPawProviderError) throw err;
    if (controller.signal.aborted) throw fail("QWENPAW_TIMEOUT");
    throw fail("QWENPAW_SSE_INVALID");
  } finally {
    clearTimeout(timer);
  }

  // --- visible trail: list + detail + rename + re-verify identity ---
  const listUrl = `${baseUrl}/api/chats?user_id=${USER_ID}&channel=${CHANNEL}`;
  const matches = await findSessionChat(listUrl, baseHeaders, ctx, sessionId);
  const chatId = matches[0].id !== undefined ? matches[0].id : matches[0].chat_id;
  if (chatId === undefined) throw fail("QWENPAW_CHAT_NOT_VISIBLE");

  const detail = await fetchJson(`${baseUrl}/api/chats/${encodeURIComponent(chatId)}`, { method: "GET", headers: baseHeaders }, ctx, "QWENPAW_CHAT_NOT_VISIBLE");
  const messages = Array.isArray(detail && detail.messages) ? detail.messages : Array.isArray(detail) ? detail : [];
  const messageText = (m) => typeof m?.text === "string"
    ? m.text
    : Array.isArray(m?.content)
      ? m.content.filter((p) => p && p.type === "text" && typeof p.text === "string").map((p) => p.text).join("")
      : null;
  const hasUserText = messages.some((m) => m && m.role === "user" && messageText(m) === userText);
  const hasAssistantText = messages.some((m) => m && m.role === "assistant" && messageText(m) === finalText);
  if (!hasUserText || !hasAssistantText) throw fail("QWENPAW_CHAT_NOT_VISIBLE");

  const title = `[${ctx.runId}][runtime] CareBand Summary`;
  await fetchJson(`${baseUrl}/api/chats/${encodeURIComponent(chatId)}`, { method: "PUT", headers: { ...baseHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ name: title }) }, ctx, "QWENPAW_CHAT_NOT_VISIBLE");
  const reMatches = await findSessionChat(listUrl, baseHeaders, ctx, sessionId);
  const still = reMatches.find((c) => c && (c.id === chatId || c.chat_id === chatId));
  if (!still || still.session_id !== sessionId) throw fail("QWENPAW_CHAT_NOT_VISIBLE");

  return {
    requested_provider: "qwenpaw",
    actual_provider: "qwenpaw",
    provider: FIXED_PROVIDER,
    model: FIXED_MODEL,
    agentId: ctx.agentId,
    sessionId,
    chatId,
    responseText: finalText,
    fallback_used: false,
  };
}
