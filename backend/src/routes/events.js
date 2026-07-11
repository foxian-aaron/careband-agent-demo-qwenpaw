import { Router } from "express";
import {
  createTaskForRisk,
  getActiveEventsForElder,
  getBaseline,
  getElder,
  getLatestSnapshot,
  insertAuditLog,
  insertEvent,
} from "../db.js";
import { evaluateRisk } from "../rules/riskEngine.js";
import { eventSchema } from "../validators.js";
import { analyzeAndPersistAgent } from "../agent/agentOrchestrator.js";

export const eventsRouter = Router();

eventsRouter.post("/", (req, res, next) => {
  try {
    const eventInput = eventSchema.parse(req.body);
    const elder = getElder(eventInput.elder_id);
    if (!elder) {
      res.status(404).json({ ok: false, error: `找不到 elder_id=${eventInput.elder_id}` });
      return;
    }

    const insertion = insertEvent(eventInput);
    if (!insertion.inserted) {
      const conflictId = insertion.event?.event_id ?? eventInput.event_id;
      res.status(409).json({
        ok: false,
        accepted: false,
        error: `event_id=${conflictId} already exists.`,
        event_id: conflictId,
      });
      return;
    }

    const event = insertion.event;
    const snapshot = getLatestSnapshot(event.elder_id);
    const baseline = getBaseline(event.elder_id, snapshot?.date);
    const events = getActiveEventsForElder(event.elder_id);
    const riskResult = evaluateRisk({ elder, snapshot, baseline, events });
    const task = createTaskForRisk({ elder, event, riskResult });

    if (["high_risk", "urgent"].includes(riskResult.status_level)) {
      insertAuditLog({
        elder_id: event.elder_id,
        action: `risk.${riskResult.status_level}`,
        actor: "rule_engine",
        target_type: "event",
        target_id: event.event_id,
        metadata: {
          status_level: riskResult.status_level,
          risk_score: riskResult.risk_score,
          triggered_rules: riskResult.triggered_rules,
          linked_task_id: task?.task_id ?? null,
        },
      });
    }

    res.status(201).json({
      ok: true,
      accepted: true,
      event,
      risk_result: riskResult,
      task,
      risk_recomputed: true,
      task_id: task?.task_id ?? null,
      agent_dispatch: ["esp32", "nrf"].includes(event.source)
        ? { status: "queued", source_event_id: event.event_id }
        : { status: "client_or_manual", source_event_id: event.event_id },
    });

    if (["esp32", "nrf"].includes(event.source)) {
      setImmediate(() => {
        analyzeAndPersistAgent({ elderId: event.elder_id, sourceEventId: event.event_id }).catch(
          () => {
            insertAuditLog({
              elder_id: event.elder_id,
              action: "agent.dispatch_failed",
              actor: "event_orchestrator",
              target_type: "event",
              target_id: event.event_id,
              metadata: { source: event.source },
            });
          },
        );
      });
    }
  } catch (error) {
    next(error);
  }
});
