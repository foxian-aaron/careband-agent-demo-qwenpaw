// backend/src/routes/import.js
//
// CareBand Stage 9A — CSV DailySnapshot import routes (Issue #23).
//
//   * POST /api/import/daily-snapshots-csv/preview  -> 200 read-only preview
//   * POST /api/import/daily-snapshots-csv          -> 201 confirmed import
//   * GET  /api/import/daily-snapshots-csv/history?elder_id=...&limit=...
//                                                   -> 200 elder-scoped history
//
// The route layer stays thin: parsing, validation and persistence live in
// importService. Typed errors raised there carry a numeric `status` and a fixed
// safe `code` and are mapped here to safe JSON responses. Unexpected errors
// fall through to the terminal errorHandler (safe 500). Raw CSV, stack traces,
// local paths and parser text are never echoed.

import { Router } from "express";

import { getDb } from "../db.js";
import {
  previewDailySnapshots,
  confirmDailySnapshots,
  getImportHistory,
} from "../importService.js";

const router = Router();

// POST .../preview — read-only parse. Never mutates the database.
router.post("/daily-snapshots-csv/preview", (req, res, next) => {
  try {
    const result = previewDailySnapshots({ db: getDb(), body: req.body || {} });
    res.status(200).json(result);
  } catch (err) {
    if (err && Number.isInteger(err.status)) {
      return res
        .status(err.status)
        .json({ ok: false, error: err.code || "error" });
    }
    next(err);
  }
});

// POST .../daily-snapshots-csv — persist the import in one transaction. 201.
router.post("/daily-snapshots-csv", (req, res, next) => {
  try {
    const now = new Date().toISOString();
    const result = confirmDailySnapshots({
      db: getDb(),
      body: req.body || {},
      now,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err && Number.isInteger(err.status)) {
      return res
        .status(err.status)
        .json({ ok: false, error: err.code || "error" });
    }
    next(err);
  }
});

// GET .../history — elder-scoped import_runs, newest first.
router.get("/daily-snapshots-csv/history", (req, res, next) => {
  try {
    const result = getImportHistory({
      db: getDb(),
      elderId: req.query.elder_id,
      limit: req.query.limit,
    });
    res.status(200).json(result);
  } catch (err) {
    if (err && Number.isInteger(err.status)) {
      return res
        .status(err.status)
        .json({ ok: false, error: err.code || "error" });
    }
    next(err);
  }
});

export default router;
