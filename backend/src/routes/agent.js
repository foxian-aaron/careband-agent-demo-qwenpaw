import { Router } from "express";
import { analyzeAndPersistAgent } from "../agent/agentOrchestrator.js";
import { agentAnalyzeSchema } from "../validators.js";

export const agentRouter = Router();

agentRouter.post("/analyze", async (req, res, next) => {
  try {
    const request = agentAnalyzeSchema.parse(req.body);
    const result = await analyzeAndPersistAgent({
      elderId: request.elder_id,
      sourceEventId: request.source_event_id ?? null,
    });
    res.status(201).json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});
