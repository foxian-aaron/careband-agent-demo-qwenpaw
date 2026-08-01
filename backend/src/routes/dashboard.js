// backend/src/routes/dashboard.js
//
// Stage 6A — global dashboard READ API.
//
//   * GET /api/dashboard -> 200 { ok, generated_at, rows, operational_summary }
//
// `rows` carries one unified row per subject (sorted by elder_id, including the
// team test subject). `operational_summary` counts only subject_kind = "elder"
// (TEST001 is never counted) with elder_count / urgent_count / high_risk_count
// / active_task_count / status_distribution, all recomputed server-side.

import { Router } from "express";

import { getDb } from "../db.js";
import { getDashboardSummary } from "../dashboardService.js";

const router = Router();

router.get("/", (_req, res, next) => {
  try {
    res.status(200).json({ ok: true, ...getDashboardSummary(getDb()) });
  } catch (err) {
    next(err);
  }
});

export default router;
