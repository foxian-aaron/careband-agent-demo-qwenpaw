// backend/src/routes/tasks.js
//
// PATCH /api/tasks/:id — transition a caregiver task to a new status and
// return the updated task plus the recomputed risk_result.
//
// Typed errors raised by the workflow carry a numeric `status` and a fixed
// safe `code`; they are mapped here to safe JSON responses. Unexpected errors
// fall through to the terminal errorHandler (safe 500).

import { Router } from "express";

import { updateTaskStatus } from "../eventWorkflow.js";
import { getDb } from "../db.js";

const router = Router();

router.patch("/:id", (req, res, next) => {
  try {
    const status =
      req.body && typeof req.body.status === "string" ? req.body.status : undefined;
    const now = new Date().toISOString();
    const result = updateTaskStatus({
      db: getDb(),
      taskId: req.params.id,
      status,
      now,
    });
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    if (err && Number.isInteger(err.status)) {
      return res.status(err.status).json({ ok: false, error: err.code || "error" });
    }
    next(err);
  }
});

export default router;
