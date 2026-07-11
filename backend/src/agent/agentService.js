import { validateAgentOutput } from "./agentOutputValidator.js";
import { runMockAgent } from "./mockAgent.js";
import { runOpenAiAgent } from "./openaiAgent.js";
import { runQwenPawAgent } from "./qwenpawProvider.js";

const modelLabel = (provider) => {
  if (provider === "qwenpaw") return process.env.QWENPAW_MODEL_LABEL ?? "qwen3.6-plus";
  if (provider === "openai") return process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  return "deterministic-mock-v0.2";
};

const normalizeProviderResult = (value) =>
  value && typeof value === "object" && "result" in value
    ? value
    : { result: value, rawResponse: JSON.stringify(value ?? null) };

const sanitizeProviderError = (error) =>
  String(error?.message ?? "unknown error")
    .replace(/\r?\n\(Details:[\s\S]*$/iu, "")
    .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/giu, "Bearer [redacted]")
    .replace(
      /((?:[a-z0-9]+[_-])*(?:api[_-]?key|access[_-]?key(?:[_-]?id)?|secret(?:[_-]?key)?|token|password)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/giu,
      "$1[redacted]",
    )
    .replace(/[A-Za-z]:\\[^\r\n)]+/gu, "[local path]")
    .replace(/\/(?:Users|home|tmp)\/[^\r\n)]+/gu, "[local path]")
    .slice(0, 500);

export async function analyzeAgent(input, options = {}) {
  const requestedProvider = options.provider ?? process.env.AGENT_PROVIDER ?? "qwenpaw";
  const startedAt = Date.now();
  const runners = {
    qwenpaw: (payload, runOptions) => runQwenPawAgent(payload, runOptions),
    openai: (payload, runOptions) => runOpenAiAgent(payload, runOptions),
    ...options.runners,
  };

  if (requestedProvider === "mock") {
    const agentResult = runMockAgent(input);
    validateAgentOutput(agentResult, input.risk_result);
    return {
      agent_result: agentResult,
      meta: {
        provider: "mock",
        requested_provider: "mock",
        model: modelLabel("mock"),
        is_real: false,
        fallback_used: false,
        duration_ms: Date.now() - startedAt,
        validation_status: "valid",
        attempts: 0,
        warning: null,
      },
      raw_response: JSON.stringify(agentResult),
    };
  }

  const runner = runners[requestedProvider];
  if (!runner) throw new Error(`Unsupported Agent provider: ${requestedProvider}`);

  let repairErrors = [];
  let rawResponse = null;
  let lastErrorMessage = "unknown error";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const providerResponse = normalizeProviderResult(
        await runner(input, { ...(options.providerOptions ?? {}), repairErrors }),
      );
      rawResponse = providerResponse.rawResponse ?? JSON.stringify(providerResponse.result);
      const agentResult = validateAgentOutput(providerResponse.result, input.risk_result);
      return {
        agent_result: agentResult,
        meta: {
          provider: requestedProvider,
          requested_provider: requestedProvider,
          model: modelLabel(requestedProvider),
          is_real: true,
          fallback_used: false,
          duration_ms: Date.now() - startedAt,
          validation_status: "valid",
          attempts: attempt,
          warning: null,
          provider_request_id: providerResponse.responseId ?? providerResponse.sessionId ?? null,
        },
        raw_response: rawResponse,
      };
    } catch (error) {
      lastErrorMessage = sanitizeProviderError(error);
      repairErrors = Array.isArray(error?.errors) ? error.errors : [lastErrorMessage];
    }
  }

  const fallback = runMockAgent(input, { fallbackLabel: true });
  validateAgentOutput(fallback, input.risk_result);
  return {
    agent_result: fallback,
    meta: {
      provider: "mock",
      requested_provider: requestedProvider,
      model: modelLabel("mock"),
      is_real: false,
      fallback_used: true,
      duration_ms: Date.now() - startedAt,
      validation_status: "fallback_valid",
      attempts: 2,
      warning: `${requestedProvider} Agent failed; deterministic Mock fallback used: ${lastErrorMessage}`,
    },
    raw_response: rawResponse,
  };
}
