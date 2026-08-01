// backend/src/routes/elders.js
//
// Stage 6A — elders READ API.
//
//   * GET /api/elders                 -> 200 { ok, elders:[...] }
//   * GET /api/elders/:elderId        -> 200 { ok, elder:{...} } | 404
//   * GET /api/elders/:elderId/dashboard
//                                       -> 200 unified row { ok, elder,
//                                                latest_snapshot, events,
//                                                active_events, risk_result,
//                                                tasks, latest_agent_output,
//                                                latest_agent_run } | 404
//
// The route layer stays thin: all row mapping and risk computation live in
// dashboardService. Unexpected errors fall through to the terminal errorHandler.

import { Router } from "express";

import { getDb } from "../db.js";
import { listElders, getElder, getElderDashboard } from "../dashboardService.js";

const router = Router();

// List every subject (elders + team test) with the fixed 7-field shape.
router.get("/", (_req, res, next) => {
  try {
    res.status(200).json({ ok: true, elders: listElders(getDb()) });
  } catch (err) {
    next(err);
  }
});

// A single elder by id.
router.get("/:elderId", (req, res, next) => {
  try {
    const elder = getElder(getDb(), req.params.elderId);
    if (!elder) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    res.status(200).json({ ok: true, elder });
  } catch (err) {
    next(err);
  }
});

// Full per-elder dashboard view (read-only aggregation + recomputed risk).
router.get("/:elderId/dashboard", (req, res, next) => {
  try {
    const now = new Date().toISOString();
    const dashboard = getElderDashboard(getDb(), req.params.elderId, now);
    if (!dashboard) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    res.status(200).json({ ok: true, ...dashboard });
  } catch (err) {
    next(err);
  }
});

export default router;
