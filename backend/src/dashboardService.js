// backend/src/dashboardService.js
//
// CareBand Stage 6A — read-side row mapping + risk computation for the elders
// and dashboard READ API. Raw SQLite rows carry a JSON `payload` TEXT column;
// these helpers expand it into structured client objects, never exposing the raw
// string. Payloads are sanitized recursively (privacy-sensitive keys stripped
// everywhere; client-owned risk keys stripped from snapshot/event payloads but
// kept inside task/agent payloads, where they are server-authoritative), then
// overlaid with DB metadata so a forged value inside the payload can never win.
// Risk is recomputed via the existing Stage 4 evaluateRisk() — no repo/cache.

import { evaluateRisk } from "./rules/riskEngine.js";

const ELDER_COLUMNS =
  "elder_id, name, age, room, risk_tags, subject_kind, created_at";

// Privacy-sensitive keys stripped from EVERY expanded payload (recursively,
// case-insensitively): raw voice/audio, precise location/trajectory, medical.
const SENSITIVE_KEYS = new Set(
  "raw_text transcript transcription audio recording voice_data asr_text \
lat latitude lng lon longitude gps gps_lat gps_lng coordinates coords address \
trajectory track geopoint diagnosis prescription dosage".split(/\s+/),
);

// Client-owned risk keys: stripped from snapshot/event payloads (the server
// recomputes them) but KEPT inside task/agent-output/agent-run payloads.
const CLIENT_RISK_KEYS = new Set(
  "status_level risk_score key_reasons recommended_action".split(/\s+/),
);

const INACTIVE_EVENT_STATUS = new Set(["resolved", "cancelled", "dismissed"]);
const TERMINAL_TASK_STATUS = new Set(["resolved", "cancelled"]);

/** Parse JSON safely; return `fallback` for non-string input or parse failure. */
export function safeParse(value, fallback) {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/** Recursively drop sensitive keys (always) and client-risk keys (when
 *  `stripRisk`). Arrays are mapped element-wise; primitives pass through. */
function sanitize(value, stripRisk) {
  if (Array.isArray(value)) return value.map((v) => sanitize(v, stripRisk));
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) {
      const lower = key.toLowerCase();
      if (SENSITIVE_KEYS.has(lower)) continue;
      if (stripRisk && CLIENT_RISK_KEYS.has(lower)) continue;
      out[key] = sanitize(value[key], stripRisk);
    }
    return out;
  }
  return value;
}

/** Map an elder row into the fixed 7-field object; risk_tags is always []. */
export function mapElder(row) {
  const tags = safeParse(row.risk_tags, []);
  return {
    elder_id: row.elder_id,
    name: row.name,
    age: row.age,
    room: row.room,
    risk_tags: Array.isArray(tags) ? tags : [],
    subject_kind: row.subject_kind,
    created_at: row.created_at,
  };
}

/** Generic payload-row mapper: sanitize the JSON payload, then overlay the
 *  DB-generated id / elder_id / created_at (and any `extraKeys`), so DB
 *  metadata always wins over a forged value inside the payload. */
function mapPayloadRow(row, idKey, stripRisk, extraKeys = []) {
  if (!row) return null;
  const sanitized = sanitize(safeParse(row.payload, {}), stripRisk);
  const out = {
    ...sanitized,
    [idKey]: row[idKey],
    elder_id: row.elder_id,
    created_at: row.created_at,
  };
  for (const k of extraKeys) out[k] = row[k];
  return out;
}

// snapshot / event payloads drop client-owned risk fields (server recomputes).
export const mapSnapshot = (row) =>
  mapPayloadRow(row, "snapshot_id", true, ["snapshot_date"]);
export const mapEvent = (row) => mapPayloadRow(row, "event_id", true);
// task / agent payloads keep server-authoritative risk fields (sensitive only).
export const mapTask = (row) => mapPayloadRow(row, "task_id", false);
export const mapAgentOutput = (row) => mapPayloadRow(row, "agent_output_id", false);
export const mapAgentRun = (row) => mapPayloadRow(row, "agent_run_id", false);

// --- risk recomputation (mirrors eventWorkflow's private recomputeRisk) -----

function latestSnapshotPayload(db, elderId) {
  const row = db
    .prepare(
      "SELECT payload FROM snapshots WHERE elder_id = ? ORDER BY snapshot_date DESC, snapshot_id DESC LIMIT 1",
    )
    .get(elderId);
  if (!row || typeof row.payload !== "string") return undefined;
  return safeParse(row.payload, undefined);
}

function eventPayloads(db, elderId) {
  const rows = db
    .prepare("SELECT payload FROM events WHERE elder_id = ? ORDER BY event_id")
    .all(elderId);
  const events = [];
  for (const row of rows) {
    const parsed = safeParse(row.payload, null);
    if (parsed !== null) events.push(parsed);
  }
  return events;
}

/** Recompute the four risk fields via evaluateRisk; client risk fields inside
 *  payloads are ignored — the engine is the single source of truth. */
export function computeRisk(db, elderId, now) {
  return evaluateRisk({
    elder: { elder_id: elderId },
    snapshot: latestSnapshotPayload(db, elderId),
    baseline: {},
    events: eventPayloads(db, elderId),
    now,
  });
}

// --- aggregate read helpers (used by the thin routes) ----------------------

export function listElders(db) {
  return db
    .prepare(`SELECT ${ELDER_COLUMNS} FROM elders ORDER BY elder_id`)
    .all()
    .map(mapElder);
}

export function getElderRow(db, elderId) {
  return db
    .prepare(`SELECT ${ELDER_COLUMNS} FROM elders WHERE elder_id = ?`)
    .get(elderId);
}

export function getElder(db, elderId) {
  const row = getElderRow(db, elderId);
  return row ? mapElder(row) : null;
}

/** Build the unified per-elder dashboard row. Empty data is returned honestly
 *  as null / [] — never filled with a frontend mock. */
function buildUnifiedRow(db, elderRow, now) {
  const elderId = elderRow.elder_id;
  const snapshotRow = db
    .prepare(
      "SELECT snapshot_id, elder_id, snapshot_date, payload, created_at FROM snapshots WHERE elder_id = ? ORDER BY snapshot_date DESC, snapshot_id DESC LIMIT 1",
    )
    .get(elderId);
  const events = db
    .prepare(
      "SELECT event_id, elder_id, payload, created_at FROM events WHERE elder_id = ? ORDER BY event_id",
    )
    .all(elderId)
    .map(mapEvent);
  const tasks = db
    .prepare(
      "SELECT task_id, elder_id, payload, created_at FROM tasks WHERE elder_id = ? ORDER BY task_id",
    )
    .all(elderId)
    .map(mapTask);
  const outputRow = db
    .prepare(
      "SELECT agent_output_id, elder_id, payload, created_at FROM agent_outputs WHERE elder_id = ? ORDER BY agent_output_id DESC LIMIT 1",
    )
    .get(elderId);
  const runRow = db
    .prepare(
      "SELECT agent_run_id, elder_id, payload, created_at FROM agent_runs WHERE elder_id = ? ORDER BY agent_run_id DESC LIMIT 1",
    )
    .get(elderId);
  return {
    elder: mapElder(elderRow),
    latest_snapshot: snapshotRow ? mapSnapshot(snapshotRow) : null,
    events,
    active_events: events.filter((e) => !INACTIVE_EVENT_STATUS.has(e.status)),
    tasks,
    latest_agent_output: outputRow ? mapAgentOutput(outputRow) : null,
    latest_agent_run: runRow ? mapAgentRun(runRow) : null,
    risk_result: computeRisk(db, elderId, now),
  };
}

/** Unified per-elder dashboard view; null when the elder is missing (route 404). */
export function getElderDashboard(db, elderId, now = new Date().toISOString()) {
  const elderRow = getElderRow(db, elderId);
  return elderRow ? buildUnifiedRow(db, elderRow, now) : null;
}

/** Global dashboard: one unified row per subject (sorted by elder_id) plus an
 *  operational_summary that counts only real elders (subject_kind = "elder"),
 *  so the team test subject is never counted. */
export function getDashboardSummary(db, now = new Date().toISOString()) {
  const elderRows = db
    .prepare(`SELECT ${ELDER_COLUMNS} FROM elders ORDER BY elder_id`)
    .all();
  const rows = elderRows.map((row) => buildUnifiedRow(db, row, now));

  const status_distribution = {};
  let urgent_count = 0;
  let high_risk_count = 0;
  let active_task_count = 0;
  let elder_count = 0;
  for (const row of rows) {
    if (row.elder.subject_kind !== "elder") continue;
    elder_count += 1;
    const level = row.risk_result.status_level;
    status_distribution[level] = (status_distribution[level] || 0) + 1;
    if (level === "urgent") urgent_count += 1;
    if (level === "high_risk") high_risk_count += 1;
    for (const task of row.tasks) {
      if (!TERMINAL_TASK_STATUS.has(task.status)) active_task_count += 1;
    }
  }

  return {
    generated_at: now,
    rows,
    operational_summary: {
      elder_count,
      urgent_count,
      high_risk_count,
      active_task_count,
      status_distribution,
    },
  };
}
