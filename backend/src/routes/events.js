// backend/src/routes/events.js
//
// POST /api/events — validate -> persist canonical event -> recompute risk ->
// create an open caregiver task when urgent/high_risk. Responds 201 on success.
//
// Typed errors raised by the contract / workflow carry a numeric `status` and
// a fixed safe `code`; they are mapped here to safe JSON responses. Unexpected
// errors fall through to the terminal errorHandler (safe 500).

import { Router } from "express";

import { normalizeEvent } from "../eventContract.js";
import { ingestEvent } from "../eventWorkflow.js";
import { getDb } from "../db.js";

const router = Router();

router.post("/", (req, res, next) => {
  try {
    const body = req.body || {};
    const now = new Date().toISOString();

    // Build the raw input from the full body so that extraneous top-level keys
    // are rejected by the contract (not silently dropped). Fill occurred_at at
    // the HTTP boundary when the client did not provide one.
    const input = { ...body };
    if (typeof input.occurred_at !== "string" || input.occurred_at.trim() === "") {
      input.occurred_at = now;
    }

    const canonical = normalizeEvent(input);
    const result = ingestEvent({
      db: getDb(),
      elderId: canonical.elder_id,
      canonicalEvent: canonical,
      now,
    });
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    if (err && Number.isInteger(err.status)) {
      return res.status(err.status).json({ ok: false, error: err.code || "error" });
    }
    next(err);
  }
});

export default router;
