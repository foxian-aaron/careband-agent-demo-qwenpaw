import OpenAI from "openai";
import { agentOutputJsonSchema } from "./agentOutputValidator.js";
import { runMockAgent } from "./mockAgent.js";

const agentTimeoutMs = () => {
  const configured = Number(process.env.AGENT_TIMEOUT_MS ?? 30000);
  return Number.isFinite(configured) && configured > 0 ? configured : 30000;
};

const withTimeout = async (promise, timeoutMs) => {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Agent request timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
};

export const buildOpenAiPromptInput = (input, { repairErrors = [] } = {}) =>
  JSON.stringify(
    {
      elder_profile: input.elder_profile,
      daily_snapshot: input.daily_snapshot,
      baseline: input.baseline,
      events: input.events,
      risk_result: input.risk_result,
      hard_safety_rule:
        "Copy status_level, risk_score, key_reasons, and recommended_action exactly from risk_result. Explain care-risk signals only. Do not invent a medical diagnosis, disease, prescription, or clinical conclusion.",
      ...(repairErrors.length
        ? {
            validation_repair_errors: repairErrors,
            repair_instruction:
              "Correct every listed validation error while copying the four deterministic rule fields exactly.",
          }
        : {}),
    },
    null,
    2,
  );

export async function runOpenAiAgent(input, options = {}) {
  const timeout = agentTimeoutMs();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout });
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const response = await withTimeout(
    client.responses.create({
      model,
      instructions:
        "You are an elderly-care AI Agent for a demo. Copy status_level, risk_score, key_reasons, and recommended_action exactly from the deterministic risk result. Generate concise, non-diagnostic caregiver, family, and institution summaries from daily aggregate data. Return only JSON matching the schema.",
      input: buildOpenAiPromptInput(input, options),
      text: {
        format: {
          type: "json_schema",
          name: "careband_agent_output",
          strict: true,
          schema: agentOutputJsonSchema,
        },
      },
    }),
    timeout,
  );

  const text = response.output_text;
  if (!text) throw new Error("OpenAI response did not include output_text.");

  return {
    result: JSON.parse(text),
    rawResponse: text,
    responseId: response.id ?? null,
  };
}

export async function analyzeWithFallback(input) {
  if (!process.env.OPENAI_API_KEY || process.env.USE_MOCK_AGENT === "true") {
    return { ...runMockAgent(input), agent_source: "mock" };
  }

  try {
    const response = await runOpenAiAgent(input);
    return {
      ...response.result,
      agent_source: "openai",
    };
  } catch (error) {
    return {
      ...runMockAgent(input),
      agent_source: "mock",
      warning: `OpenAI call failed; mock Agent fallback used: ${error.message}`,
    };
  }
}
