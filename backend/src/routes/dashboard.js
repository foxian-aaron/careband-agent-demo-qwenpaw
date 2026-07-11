import { Router } from "express";
import {
  getActiveEventsForElder,
  getBaseline,
  getEventsForElder,
  getLatestAgentOutput,
  getLatestAgentRun,
  getLatestSnapshot,
  getRecentSnapshots,
  getTasksForElder,
  listElders,
} from "../db.js";
import { evaluateRisk } from "../rules/riskEngine.js";

export const dashboardRouter = Router();

const toPublicAgentRunMeta = (run) =>
  run
    ? {
        run_id: run.run_id,
        source_event_id: run.source_event_id,
        provider: run.provider,
        requested_provider: run.requested_provider,
        model: run.model,
        started_at: run.started_at,
        duration_ms: run.duration_ms,
        validation_status: run.validation_status,
        fallback_used: run.fallback_used,
        created_at: run.created_at,
      }
    : null;

const agentOutputMatchesRisk = (output, risk) =>
  Boolean(output) &&
  output.status_level === risk.status_level &&
  Number(output.risk_score) === Number(risk.risk_score) &&
  output.recommended_action === risk.recommended_action &&
  JSON.stringify(output.key_reasons ?? []) === JSON.stringify(risk.key_reasons ?? []);

dashboardRouter.get("/", (_req, res) => {
  const elders = listElders().map((elder) => {
    const snapshot = getLatestSnapshot(elder.elder_id);
    const baseline = getBaseline(elder.elder_id, snapshot?.date);
    const events = getEventsForElder(elder.elder_id);
    const activeEvents = getActiveEventsForElder(elder.elder_id);
    const riskResult = evaluateRisk({ elder, snapshot, baseline, events: activeEvents });
    const latestAgentOutput = getLatestAgentOutput(elder.elder_id);
    const agentOutputIsCurrent = agentOutputMatchesRisk(latestAgentOutput, riskResult);

    return {
      elder,
      baseline,
      latest_snapshot: snapshot,
      recent_snapshots: getRecentSnapshots(elder.elder_id, 7),
      events,
      active_events: activeEvents,
      risk_result: riskResult,
      tasks: getTasksForElder(elder.elder_id),
      latest_agent_output: agentOutputIsCurrent ? latestAgentOutput : null,
      latest_agent_run: agentOutputIsCurrent
        ? toPublicAgentRunMeta(getLatestAgentRun(elder.elder_id))
        : null,
      latest_agent_output_stale: Boolean(latestAgentOutput) && !agentOutputIsCurrent,
    };
  });

  const operationalElders = elders.filter((entry) => entry.elder.subject_kind !== "team_test");
  const activeTaskCount = operationalElders.reduce(
    (count, entry) =>
      count + entry.tasks.filter((task) => !["resolved", "cancelled"].includes(task.status)).length,
    0,
  );

  res.json({
    ok: true,
    generated_at: new Date().toISOString(),
    elders,
    operational_summary: {
      included_subject_kind: "elder",
      elder_count: operationalElders.length,
      urgent_count: operationalElders.filter(
        (entry) => entry.risk_result.status_level === "urgent",
      ).length,
      high_risk_count: operationalElders.filter(
        (entry) => entry.risk_result.status_level === "high_risk",
      ).length,
      active_task_count: activeTaskCount,
    },
  });
});
