import { Router } from "express";
import {
  createTaskForRisk,
  getActiveEventsForElder,
  getBaseline,
  getElder,
  getLatestSnapshot,
  insertEvent,
} from "../db.js";
import { evaluateRisk } from "../rules/riskEngine.js";
import { eventSchema } from "../validators.js";

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

    res.status(201).json({
      ok: true,
      accepted: true,
      event,
      risk_result: riskResult,
      task,
      risk_recomputed: true,
      task_id: task?.task_id ?? null,
    });
  } catch (error) {
    next(error);
  }
});
