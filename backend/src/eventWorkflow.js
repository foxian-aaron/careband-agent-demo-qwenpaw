// backend/src/eventWorkflow.js
//
// CareBand Stage 5 — caregiver task workflow around canonical events.
//
// Reuses the existing getDb() handle and the Stage 4 evaluateRisk() rule
// engine directly. No repository framework, no new dependencies. All write
// paths run inside a SQLite transaction, and every timestamp is passed in by
// the caller (the HTTP boundary) — core functions never read Date.now.

import { evaluateRisk } from "./rules/riskEngine.js";
import { ValidationError } from "./eventContract.js";

// Allowed caregiver task statuses.
const TASK_STATUSES = [
  "open",
  "acknowledged",
  "in_progress",
  "resolved",
  "cancelled",
];

const TASK_TERMINAL = new Set(["resolved", "cancelled"]);

// Allowed forward transitions + same-status idempotency. Terminal states may
// only repeat themselves and never recover.
const TASK_TRANSITIONS = {
  open: new Set(["open", "acknowledged", "in_progress", "resolved", "cancelled"]),
  acknowledged: new Set([
    "acknowledged",
    "in_progress",
    "resolved",
    "cancelled",
  ]),
  in_progress: new Set(["in_progress", "resolved", "cancelled"]),
  resolved: new Set(["resolved"]),
  cancelled: new Set(["cancelled"]),
};

// Risk levels that trigger creation of an open caregiver task.
const TASK_CREATING_LEVELS = new Set(["urgent", "high_risk"]);

/**
 * Not-found error mapped to HTTP 404 at the route boundary.
 */
export class NotFoundError extends Error {
  constructor(code = "not_found") {
    super(code);
    this.name = "NotFoundError";
    this.status = 404;
    this.code = code;
  }
}

/**
 * Transition conflict error mapped to HTTP 409 at the route boundary.
 */
export class ConflictError extends Error {
  constructor(code = "conflict") {
    super(code);
    this.name = "ConflictError";
    this.status = 409;
    this.code = code;
  }
}

/**
 * Read the elder's latest snapshot payload (or undefined) and all stored event
 * payloads, then run the deterministic risk engine. The engine filters
 * resolved/cancelled events itself via its own isActiveEvent logic, so all
 * events are passed in and the four risk fields come only from evaluateRisk.
 */
function recomputeRisk(db, elderId, now) {
  let snapshot;
  const snapRow = db
    .prepare(
      "SELECT payload FROM snapshots WHERE elder_id = ? ORDER BY snapshot_date DESC LIMIT 1",
    )
    .get(elderId);
  if (snapRow && snapRow.payload) {
    try {
      snapshot = JSON.parse(snapRow.payload);
    } catch {
      snapshot = undefined;
    }
  }

  const eventRows = db
    .prepare("SELECT payload FROM events WHERE elder_id = ? ORDER BY event_id")
    .all(elderId);
  const events = [];
  for (const row of eventRows) {
    try {
      events.push(JSON.parse(row.payload));
    } catch {
      // Skip an unparseable row rather than failing the whole evaluation.
    }
  }

  return evaluateRisk({
    elder: { elder_id: elderId },
    snapshot,
    baseline: {},
    events,
    now,
  });
}

/**
 * Persist a canonical event, recompute risk, and create an open caregiver task
 * when the recomputed level is urgent or high_risk. Runs in one transaction.
 *
 * @param {object}  opts
 * @param {import("better-sqlite3").Database} opts.db
 * @param {string}  opts.elderId
 * @param {object}  opts.canonicalEvent - output of normalizeEvent()
 * @param {string}  opts.now            - ISO timestamp from the caller
 * @returns {{event:object, risk_result:object, task:object|null}}
 */
export function ingestEvent({ db, elderId, canonicalEvent, now }) {
  const run = db.transaction(() => {
    const elder = db
      .prepare("SELECT elder_id FROM elders WHERE elder_id = ?")
      .get(elderId);
    if (!elder) throw new NotFoundError("not_found");

    const storedEvent = { ...canonicalEvent, status: "active" };
    const eventInfo = db
      .prepare("INSERT INTO events (elder_id, payload, created_at) VALUES (?, ?, ?)")
      .run(elderId, JSON.stringify(storedEvent), now);
    const eventId = Number(eventInfo.lastInsertRowid);

    const risk = recomputeRisk(db, elderId, now);

    let task = null;
    if (TASK_CREATING_LEVELS.has(risk.status_level)) {
      const taskPayload = {
        linked_event_id: eventId,
        status: "open",
        risk_level: risk.status_level,
        risk_score: risk.risk_score,
        key_reasons: risk.key_reasons,
        recommended_action: risk.recommended_action,
        created_at: now,
        updated_at: now,
      };
      const taskInfo = db
        .prepare("INSERT INTO tasks (elder_id, payload, created_at) VALUES (?, ?, ?)")
        .run(elderId, JSON.stringify(taskPayload), now);
      task = {
        task_id: Number(taskInfo.lastInsertRowid),
        elder_id: elderId,
        ...taskPayload,
      };
    }

    return {
      event: { event_id: eventId, elder_id: elderId, ...storedEvent },
      risk_result: risk,
      task,
    };
  });
  return run();
}

/**
 * Transition a caregiver task to a new status.
 *
 *   - unknown status value          -> ValidationError  (400)
 *   - unknown task / non-integer id -> NotFoundError    (404)
 *   - disallowed transition         -> ConflictError    (409)
 *   - urgent task -> cancelled      -> ConflictError    (409)
 *
 * A terminal transition (resolved / cancelled) marks the linked event as
 * resolved and recomputes risk from the remaining active events. Risk is
 * always recomputed and returned so the caller has the freshest four fields.
 *
 * @param {object}  opts
 * @param {import("better-sqlite3").Database} opts.db
 * @param {number|string} opts.taskId
 * @param {string}  opts.status
 * @param {string}  opts.now - ISO timestamp from the caller
 * @returns {{task:object, risk_result:object}}
 */
export function updateTaskStatus({ db, taskId, status, now }) {
  if (typeof status !== "string" || !TASK_STATUSES.includes(status)) {
    throw new ValidationError("validation_error");
  }

  const id = Number(taskId);

  const run = db.transaction(() => {
    if (!Number.isInteger(id)) {
      throw new NotFoundError("not_found");
    }
    const row = db
      .prepare("SELECT elder_id, payload FROM tasks WHERE task_id = ?")
      .get(id);
    if (!row) throw new NotFoundError("not_found");

    const task = JSON.parse(row.payload);
    const current = task.status;

    if (!TASK_TRANSITIONS[current] || !TASK_TRANSITIONS[current].has(status)) {
      throw new ConflictError("conflict");
    }
    // urgent tasks must be resolved, never cancelled.
    if (status === "cancelled" && task.risk_level === "urgent") {
      throw new ConflictError("conflict");
    }

    task.status = status;
    task.updated_at = now;

    // Terminal close-out: mark the linked event resolved so it stops counting.
    if (TASK_TERMINAL.has(status) && task.linked_event_id != null) {
      const eRow = db
        .prepare("SELECT payload FROM events WHERE event_id = ?")
        .get(task.linked_event_id);
      if (eRow) {
        let ev;
        try {
          ev = JSON.parse(eRow.payload);
        } catch {
          ev = {};
        }
        ev.status = "resolved";
        db.prepare("UPDATE events SET payload = ? WHERE event_id = ?").run(
          JSON.stringify(ev),
          task.linked_event_id,
        );
      }
    }

    db.prepare("UPDATE tasks SET payload = ? WHERE task_id = ?").run(
      JSON.stringify(task),
      id,
    );

    const risk = recomputeRisk(db, row.elder_id, now);
    return { task: { task_id: id, elder_id: row.elder_id, ...task }, risk_result: risk };
  });
  return run();
}
