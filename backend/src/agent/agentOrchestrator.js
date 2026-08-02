import { analyzeAgent } from "./agentService.js";
import { getElderDashboard } from "../dashboardService.js";

export class AgentRequestError extends Error {
  constructor(code, status) {
    super(code);
    this.name = "AgentRequestError";
    this.code = code;
    this.status = status;
  }
}

const fail = (code, status) => new AgentRequestError(code, status);

const assertSourceEvent = (db, elderId, sourceEventId) => {
  if (sourceEventId === null) return;
  const row = db
    .prepare("SELECT elder_id FROM events WHERE event_id = ?")
    .get(sourceEventId);
  if (!row || row.elder_id !== elderId) throw fail("source_event_not_found", 404);
};

const buildServerInput = (dashboard) => ({
  daily_snapshot: dashboard.latest_snapshot,
  personal_baseline: null,
  active_events: dashboard.active_events,
  risk_result: dashboard.risk_result,
});

const safeRunPayload = (meta, durationMs, sourceEventId) => ({
  requested_provider: meta.requested_provider,
  actual_provider: meta.actual_provider,
  provider: meta.provider,
  model: meta.model,
  fallback_used: meta.fallback_used,
  validation_status: meta.validation_status,
  attempts: meta.attempts,
  failure_reason: meta.failure_reason,
  provider_request_ids: Array.isArray(meta.provider_request_ids)
    ? meta.provider_request_ids.filter((value) => typeof value === "string")
    : [],
  duration_ms: durationMs,
  source_event_id: sourceEventId,
});

export async function analyzeAndPersistAgent({
  db,
  elderId,
  sourceEventId = null,
  now = new Date().toISOString(),
  agentOptions = {},
}) {
  const dashboard = getElderDashboard(db, elderId, now);
  if (!dashboard) throw fail("elder_not_found", 404);
  assertSourceEvent(db, elderId, sourceEventId);

  const input = buildServerInput(dashboard);
  const startedAt = Date.now();
  const analysis = await analyzeAgent(input, {
    ...agentOptions,
    provider: agentOptions.provider ?? "qwenpaw",
  });
  const durationMs = Math.max(0, Date.now() - startedAt);
  // Keep the persisted Agent output itself identical to the strict
  // additionalProperties=false schema. Request linkage belongs in the run
  // trace and the HTTP envelope, not inside the model output object.
  const outputPayload = analysis.agent_result;
  const runPayload = safeRunPayload(analysis.meta, durationMs, sourceEventId);

  const persist = db.transaction(() => {
    const outputInfo = db
      .prepare("INSERT INTO agent_outputs (elder_id, payload, created_at) VALUES (?, ?, ?)")
      .run(elderId, JSON.stringify(outputPayload), now);
    const runInfo = db
      .prepare("INSERT INTO agent_runs (elder_id, payload, created_at) VALUES (?, ?, ?)")
      .run(elderId, JSON.stringify(runPayload), now);
    return {
      output_id: Number(outputInfo.lastInsertRowid),
      run_id: Number(runInfo.lastInsertRowid),
    };
  });
  const saved = persist();

  return {
    ...saved,
    elder_id: elderId,
    source_event_id: sourceEventId,
    risk_result: dashboard.risk_result,
    agent_result: analysis.agent_result,
    meta: runPayload,
    created_at: now,
  };
}
