import { Router } from "express";

import { analyzeAndPersistAgent, AgentRequestError } from "../agent/agentOrchestrator.js";
import { getDb } from "../db.js";

const ALLOWED_KEYS = new Set(["elder_id", "source_event_id"]);

const parseRequest = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AgentRequestError("validation_error", 400);
  }
  if (Object.keys(body).some((key) => !ALLOWED_KEYS.has(key))) {
    throw new AgentRequestError("validation_error", 400);
  }
  if (
    typeof body.elder_id !== "string" || body.elder_id.trim() === "" ||
    body.elder_id !== body.elder_id.trim() || body.elder_id.length > 64
  ) {
    throw new AgentRequestError("validation_error", 400);
  }
  const sourceEventId = body.source_event_id ?? null;
  if (sourceEventId !== null && (!Number.isInteger(sourceEventId) || sourceEventId <= 0)) {
    throw new AgentRequestError("validation_error", 400);
  }
  return { elderId: body.elder_id, sourceEventId };
};

export function createAgentRouter({ agentOptions = {} } = {}) {
  const router = Router();
  router.post("/analyze", async (req, res, next) => {
    try {
      const { elderId, sourceEventId } = parseRequest(req.body);
      const result = await analyzeAndPersistAgent({
        db: getDb(),
        elderId,
        sourceEventId,
        agentOptions,
      });
      res.status(201).json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof AgentRequestError) {
        return res.status(error.status).json({ ok: false, error: error.code });
      }
      next(error);
    }
  });
  return router;
}
