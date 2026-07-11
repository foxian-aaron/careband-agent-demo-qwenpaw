import { randomUUID } from "node:crypto";

import { agentOutputJsonSchema } from "./agentOutputValidator.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:8088";

const buildTaskText = (input, repairErrors = []) =>
  [
    "You are the CareBand summary Agent for an elder-care demo.",
    "Return JSON only. Do not wrap it in Markdown or prose.",
    "The deterministic rule engine already decided status_level, risk_score, key_reasons, and recommended_action.",
    "Copy those four fields exactly. You may only summarize and explain the human follow-up for each audience.",
    "Do not diagnose a disease, prescribe medication, change a dose, or claim clinical certainty.",
    `Output JSON Schema: ${JSON.stringify(agentOutputJsonSchema)}`,
    repairErrors.length
      ? `The previous response failed validation. Correct these errors: ${repairErrors.join("; ")}`
      : "",
    `CareBand task payload: ${JSON.stringify(input)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

const parseSsePayloads = (text) => {
  const payloads = [];
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      payloads.push(JSON.parse(data));
    } catch {
      // Ignore transport-level keepalive or malformed intermediate events.
    }
  }
  return payloads;
};

const extractFinalText = (payload) => {
  const output = Array.isArray(payload?.output) ? payload.output : [];
  const lastMessage = output.at(-1);
  const content = Array.isArray(lastMessage?.content) ? lastMessage.content : [];
  return content
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n")
    .trim();
};

const extractFailure = (payload) => {
  const state = String(payload?.status ?? payload?.event ?? payload?.type ?? "").toLowerCase();
  const error = payload?.error ?? payload?.detail ?? null;
  if (!state.includes("fail") && !error) return null;
  const code = error?.code ?? payload?.code ?? "QWENPAW_FAILED";
  const message = error?.message ?? payload?.message ?? String(error ?? "Agent run failed");
  return `${code}: ${message}`;
};

export async function runQwenPawAgent(input, options = {}) {
  const baseUrl = (options.baseUrl ?? process.env.QWENPAW_BASE_URL ?? DEFAULT_BASE_URL).replace(
    /\/$/u,
    "",
  );
  const agentId = options.agentId ?? process.env.QWENPAW_AGENT_ID ?? "careband_summary_agent";
  const timeoutMs = Number(
    options.timeoutMs ?? process.env.QWENPAW_TIMEOUT_MS ?? process.env.AGENT_TIMEOUT_MS ?? 30000,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const sessionId = `careband:${input.elder_profile?.elder_id ?? "unknown"}:${randomUUID()}`;

  try {
    const response = await fetch(`${baseUrl}/api/agent/process`, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        "X-Agent-Id": agentId,
      },
      body: JSON.stringify({
        session_id: sessionId,
        user_id: "careband-backend",
        channel: "console",
        input: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: buildTaskText(input, options.repairErrors ?? []),
              },
            ],
          },
        ],
        request_context: {
          task_type: "careband_elder_state_summary",
          tools_allowed: [],
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`QwenPaw returned HTTP ${response.status}`);
    }

    const rawSse = await response.text();
    const payloads = parseSsePayloads(rawSse);
    const failure = payloads.map(extractFailure).find(Boolean);
    if (failure) throw new Error(`QwenPaw Agent failed: ${failure}`);

    const rawResponse = payloads
      .toReversed()
      .map(extractFinalText)
      .find(Boolean);
    if (!rawResponse) throw new Error("QwenPaw response did not contain final text output");

    let result;
    try {
      result = JSON.parse(rawResponse);
    } catch (error) {
      throw new Error(`QwenPaw final output was not JSON-only: ${error.message}`);
    }

    return { result, rawResponse, agentId, sessionId };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`QwenPaw request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
