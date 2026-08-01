import { runQwenPawAgent } from "./qwenpawProvider.js";
import {
  AgentOutputValidationError,
  parseAndValidateAgentOutput,
  validateAgentOutput,
} from "./agentOutputValidator.js";
import { runMockAgent } from "./mockAgent.js";

const ALLOWED_AGENT_INPUTS = [
  "daily_snapshot",
  "personal_baseline",
  "active_events",
  "risk_result",
];

const SAFE_FAILURE_REASONS = new Set([
  "QWENPAW_CONFIG_INVALID",
  "QWENPAW_TIMEOUT",
  "QWENPAW_UNAVAILABLE",
  "QWENPAW_HTTP_ERROR",
  "QWENPAW_VERSION_UNSUPPORTED",
  "QWENPAW_AGENT_NOT_READY",
  "QWENPAW_SSE_INVALID",
  "QWENPAW_REMOTE_FAILED",
  "QWENPAW_TOOL_ACTIVITY",
  "QWENPAW_RESPONSE_TOO_LARGE",
  "QWENPAW_FINAL_MISSING",
  "QWENPAW_CHAT_NOT_VISIBLE",
  "QWENPAW_IDENTITY_INVALID",
]);

const agentTask = (input) => Object.fromEntries(
  ALLOWED_AGENT_INPUTS
    .filter((key) => Object.prototype.hasOwnProperty.call(input ?? {}, key))
    .map((key) => [key, input[key]]),
);

const attemptOptions = (providerOptions, attempt) => {
  const result = { ...providerOptions };
  if (typeof result.runId === "string") {
    const suffix = `-a${attempt}`;
    result.runId = `${result.runId.slice(0, 128 - suffix.length)}${suffix}`;
  }
  return result;
};

const failureReason = (error) => {
  if (error instanceof AgentOutputValidationError) return "QWENPAW_OUTPUT_INVALID";
  if (SAFE_FAILURE_REASONS.has(error?.code)) return error.code;
  return "QWENPAW_PROVIDER_FAILED";
};

const requestId = (trace) => trace?.chatId ?? trace?.sessionId ?? null;

const assertQwenPawTrace = (trace) => {
  if (
    !trace ||
    trace.actual_provider !== "qwenpaw" ||
    trace.provider !== "zhipu-cn-codingplan" ||
    trace.model !== "glm-5.2" ||
    trace.fallback_used !== false ||
    typeof trace.responseText !== "string"
  ) {
    const error = new Error("QWENPAW_IDENTITY_INVALID");
    error.code = "QWENPAW_IDENTITY_INVALID";
    throw error;
  }
};

const mockResult = (input, requestedProvider, fallback, attempts, reason, ids) => {
  const agentResult = runMockAgent(agentTask(input), { fallbackLabel: fallback });
  validateAgentOutput(agentResult, input?.risk_result);
  return {
    agent_result: agentResult,
    meta: {
      requested_provider: requestedProvider,
      actual_provider: "mock",
      provider: "deterministic-mock",
      model: "deterministic-mock-v0.3",
      fallback_used: fallback,
      validation_status: fallback ? "fallback_valid" : "valid",
      attempts,
      failure_reason: reason,
      provider_request_ids: ids,
    },
  };
};

export async function analyzeAgent(input, options = {}) {
  const requestedProvider = options.provider ?? "qwenpaw";
  if (requestedProvider === "mock") {
    return mockResult(input, "mock", false, 0, null, []);
  }
  if (requestedProvider !== "qwenpaw") {
    throw new Error("AGENT_PROVIDER_UNSUPPORTED");
  }

  const runner = options.runners?.qwenpaw ?? runQwenPawAgent;
  const providerIds = [];
  let lastReason = "QWENPAW_PROVIDER_FAILED";
  const task = agentTask(input);

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const trace = await runner(task, attemptOptions(options.providerOptions ?? {}, attempt));
      const id = requestId(trace);
      if (id !== null) providerIds.push(id);
      assertQwenPawTrace(trace);
      const agentResult = parseAndValidateAgentOutput(trace.responseText, input?.risk_result);
      return {
        agent_result: agentResult,
        meta: {
          requested_provider: "qwenpaw",
          actual_provider: "qwenpaw",
          provider: trace.provider,
          model: trace.model,
          fallback_used: false,
          validation_status: "valid",
          attempts: attempt,
          failure_reason: null,
          provider_request_ids: providerIds,
        },
      };
    } catch (error) {
      lastReason = failureReason(error);
    }
  }

  return mockResult(input, "qwenpaw", true, 2, lastReason, providerIds);
}
