import { buildAgentInput } from "./agentInput.js";
import { analyzeAgent } from "./agentService.js";
import {
  getActiveEventsForElder,
  getBaseline,
  getElder,
  getEventsForElder,
  getLatestSnapshot,
  insertAgentOutput,
  insertAgentRun,
  nowIso,
} from "../db.js";
import { evaluateRisk } from "../rules/riskEngine.js";

const requestError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

export async function analyzeAndPersistAgent({ elderId, sourceEventId = null }) {
  const startedAt = nowIso();
  const configuredProvider =
    process.env.USE_MOCK_AGENT === "true"
      ? "mock"
      : process.env.AGENT_PROVIDER ?? "qwenpaw";
  let elder = null;
  let input = null;

  try {
    elder = getElder(elderId);
    if (!elder) throw requestError(`Unknown elder_id=${elderId}`, 404);

    const allEvents = getEventsForElder(elderId);
    if (sourceEventId && !allEvents.some((event) => event.event_id === sourceEventId)) {
      throw requestError("source_event_id does not belong to this elder.", 404);
    }

    const snapshot = getLatestSnapshot(elderId);
    const baseline = getBaseline(elderId, snapshot?.date);
    const events = getActiveEventsForElder(elderId);
    const riskResult = evaluateRisk({ elder, snapshot, baseline, events });
    input = buildAgentInput({ elder, snapshot, baseline, events, riskResult });

    const policyForcedMock =
      elder.subject_kind === "team_test" &&
      configuredProvider !== "mock" &&
      process.env.ALLOW_TEAM_TEST_REAL_AGENT !== "true";
    const analysis = await analyzeAgent(input, {
      provider: policyForcedMock ? "mock" : configuredProvider,
    });
    if (policyForcedMock) {
      analysis.meta.requested_provider = configuredProvider;
      analysis.meta.policy_forced_mock = true;
      analysis.meta.warning =
        "Real Agent access is disabled for team_test data; deterministic Mock was used.";
    }

    const savedOutput = insertAgentOutput({
      elder_id: elderId,
      source_event_id: sourceEventId,
      ...analysis.agent_result,
      agent_source: analysis.meta.provider,
      warning: analysis.meta.warning ?? null,
    });
    const savedRun = insertAgentRun({
      elder_id: elderId,
      source_event_id: sourceEventId,
      provider: analysis.meta.provider,
      requested_provider: analysis.meta.requested_provider,
      model: analysis.meta.model,
      started_at: startedAt,
      duration_ms: analysis.meta.duration_ms,
      validation_status: analysis.meta.validation_status,
      fallback_used: analysis.meta.fallback_used,
      error_reason: analysis.meta.warning,
      input_summary: input,
      raw_response_excerpt: analysis.raw_response,
    });

    return {
      output_id: savedOutput.output_id,
      run_id: savedRun.run_id,
      elder_id: elderId,
      source_event_id: sourceEventId,
      agent_result: analysis.agent_result,
      meta: {
        ...analysis.meta,
        run_id: savedRun.run_id,
      },
      created_at: savedOutput.created_at,
    };
  } catch (error) {
    if (elder && input) {
      try {
        insertAgentRun({
          elder_id: elder.elder_id,
          source_event_id: sourceEventId,
          provider: configuredProvider,
          requested_provider: configuredProvider,
          model: null,
          started_at: startedAt,
          validation_status: "failed",
          fallback_used: false,
          error_reason: error.message,
          input_summary: input,
        });
      } catch {
        // Preserve the original Agent failure when audit persistence is unavailable.
      }
    }
    throw error;
  }
}
