import { Router } from "express";
import { buildAgentInput } from "../agent/agentInput.js";
import { analyzeAgent } from "../agent/agentService.js";
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
import { agentAnalyzeSchema } from "../validators.js";

export const agentRouter = Router();

agentRouter.post("/analyze", async (req, res, next) => {
  let elder = null;
  let input = null;
  const startedAt = nowIso();

  try {
    const request = agentAnalyzeSchema.parse(req.body);
    elder = getElder(request.elder_id);
    if (!elder) {
      res.status(404).json({ ok: false, error: `Unknown elder_id=${request.elder_id}` });
      return;
    }

    const allEvents = getEventsForElder(request.elder_id);
    if (
      request.source_event_id &&
      !allEvents.some((event) => event.event_id === request.source_event_id)
    ) {
      res.status(404).json({
        ok: false,
        error: "source_event_id does not belong to this elder.",
      });
      return;
    }

    const snapshot = getLatestSnapshot(request.elder_id);
    const baseline = getBaseline(request.elder_id, snapshot?.date);
    const events = getActiveEventsForElder(request.elder_id);
    const riskResult = evaluateRisk({ elder, snapshot, baseline, events });
    input = buildAgentInput({ elder, snapshot, baseline, events, riskResult });
    const configuredProvider =
      process.env.USE_MOCK_AGENT === "true"
        ? "mock"
        : process.env.AGENT_PROVIDER ?? "qwenpaw";
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
      elder_id: request.elder_id,
      source_event_id: request.source_event_id ?? null,
      ...analysis.agent_result,
      agent_source: analysis.meta.provider,
      warning: analysis.meta.warning ?? null,
    });
    const savedRun = insertAgentRun({
      elder_id: request.elder_id,
      source_event_id: request.source_event_id ?? null,
      provider: analysis.meta.provider,
      model: analysis.meta.model,
      started_at: startedAt,
      duration_ms: analysis.meta.duration_ms,
      validation_status: analysis.meta.validation_status,
      fallback_used: analysis.meta.fallback_used,
      error_reason: analysis.meta.warning,
      input_summary: input,
      raw_response_excerpt: analysis.raw_response,
    });

    res.status(201).json({
      ok: true,
      output_id: savedOutput.output_id,
      run_id: savedRun.run_id,
      elder_id: request.elder_id,
      source_event_id: request.source_event_id ?? null,
      agent_result: analysis.agent_result,
      meta: {
        ...analysis.meta,
        run_id: savedRun.run_id,
      },
      created_at: savedOutput.created_at,
    });
  } catch (error) {
    if (elder && input) {
      try {
        insertAgentRun({
          elder_id: elder.elder_id,
          provider: process.env.AGENT_PROVIDER ?? "qwenpaw",
          model: null,
          started_at: startedAt,
          validation_status: "failed",
          fallback_used: false,
          error_reason: error.message,
          input_summary: input,
        });
      } catch {
        // Preserve the original Agent failure when logging is unavailable.
      }
    }
    next(error);
  }
});
