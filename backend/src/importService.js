// backend/src/importService.js
//
// CareBand Stage 9A — CSV DailySnapshot import business logic (Issue #23).
//
// Three operations, all driven by the existing getDb() handle:
//   * previewDailySnapshots — read-only parse + elder existence check.
//   * confirmDailySnapshots — one SQLite transaction: verify the elder exists,
//     UPSERT every snapshot by (elder_id, snapshot_date), then insert exactly
//     one import_runs row carrying parsed metadata only. Returns 201.
//   * getImportHistory      — elder-scoped import_runs, newest first, parsed
//     metadata only, default limit 20 / max 50.
//
// Typed errors carry a numeric `status` and a fixed safe `code` and are mapped
// to safe JSON at the route boundary. The service never reads Date.now: every
// timestamp is passed in by the caller (the HTTP boundary). Raw CSV is never
// persisted and never reaches an error response.

import { getDb } from "./db.js";
import { ValidationError } from "./eventContract.js";
import { NotFoundError } from "./eventWorkflow.js";
import { parseDailySnapshotsCsv } from "./importers/csvImporter.js";

// The only top-level keys an import request body may carry.
const ALLOWED_BODY_KEYS = new Set(["elder_id", "csv_text", "file_name"]);

const SAFE_FILE_LABEL = "daily_snapshots.csv";

function assertImportSubject(db, elderId) {
  const row = db
    .prepare("SELECT subject_kind FROM elders WHERE elder_id = ?")
    .get(elderId);
  if (!row) throw new NotFoundError("not_found");
  // CSV import is a demo-only capability. The subject classification is
  // server-owned seed data; real elder profiles are never eligible.
  if (row.subject_kind !== "team_test") {
    throw new ValidationError("validation_error");
  }
}

function safeParse(value, fallback) {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * Validate the JSON request body shape. Rejects missing elder_id / csv_text, a
 * non-string file_name, or any key outside the allowed set.
 */
function assertRequestBody(body) {
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    throw new ValidationError("validation_error");
  }
  for (const key of Object.keys(body)) {
    if (!ALLOWED_BODY_KEYS.has(key)) {
      throw new ValidationError("validation_error");
    }
  }
  const { elder_id, csv_text, file_name } = body;
  if (typeof elder_id !== "string" || elder_id.trim() === "") {
    throw new ValidationError("validation_error");
  }
  if (typeof csv_text !== "string" || csv_text.length === 0) {
    throw new ValidationError("validation_error");
  }
  if (file_name !== undefined && typeof file_name !== "string") {
    throw new ValidationError("validation_error");
  }
  if (file_name !== undefined) normalizeFileName(file_name);
}

function normalizeFileName(value) {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (
    trimmed.length < 1 ||
    trimmed.length > 128 ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    !/^[A-Za-z0-9._ -]+$/.test(trimmed)
  ) {
    throw new ValidationError("validation_error");
  }
  return trimmed;
}

function clampLimit(limit) {
  let n = Number(limit);
  if (!Number.isInteger(n) || n < 1) n = 20;
  if (n > 50) n = 50;
  return n;
}

/**
 * Read-only preview of a CSV import. Never writes to the database.
 *
 * @returns {{ok:true,count,snapshots,date_range,quality_summary,warnings}}
 */
export function previewDailySnapshots({ db = getDb(), body }) {
  assertRequestBody(body);
  const { elder_id, csv_text } = body;
  assertImportSubject(db, elder_id);
  const parsed = parseDailySnapshotsCsv({ csvText: csv_text, elderId: elder_id });
  return {
    ok: true,
    count: parsed.count,
    snapshots: parsed.snapshots,
    date_range: parsed.date_range,
    quality_summary: parsed.quality_summary,
    warnings: parsed.warnings,
  };
}

/**
 * Persist a CSV import inside a single transaction: verify the elder, UPSERT
 * every snapshot by (elder_id, snapshot_date), then insert one import_runs row.
 * Re-importing the same dates replaces rows in place — it never duplicates.
 *
 * @returns {{ok:true,import_run_id,imported,date_range}}
 */
export function confirmDailySnapshots({ db = getDb(), body, now }) {
  assertRequestBody(body);
  const { elder_id, csv_text } = body;
  // Early 404 so an unknown elder is rejected before any parse work.
  assertImportSubject(db, elder_id);
  const parsed = parseDailySnapshotsCsv({ csvText: csv_text, elderId: elder_id });

  const upsertSnapshot = db.prepare(
    `INSERT INTO snapshots (elder_id, snapshot_date, payload, created_at)
       VALUES (@elder_id, @snapshot_date, @payload, @created_at)
     ON CONFLICT(elder_id, snapshot_date) DO UPDATE SET
       payload = excluded.payload,
       created_at = excluded.created_at`,
  );
  const insertRun = db.prepare(
    "INSERT INTO import_runs (elder_id, payload, created_at) VALUES (?, ?, ?)",
  );

  const runPayload = {
    source: "csv_import",
    // Never persist the client-provided file name: it can contain identity,
    // health labels or secret-like text even when it is not a filesystem path.
    file_name: SAFE_FILE_LABEL,
    row_count: parsed.count,
    date_range: parsed.date_range,
    quality_summary: parsed.quality_summary,
  };

  const txn = db.transaction(() => {
    // Contract-mandated elder verification inside the transaction.
    assertImportSubject(db, elder_id);
    for (const snapshot of parsed.snapshots) {
      upsertSnapshot.run({
        elder_id: elder_id,
        snapshot_date: snapshot.date,
        payload: JSON.stringify(snapshot),
        created_at: now,
      });
    }
    const info = insertRun.run(elder_id, JSON.stringify(runPayload), now);
    return {
      import_run_id: Number(info.lastInsertRowid),
      imported: parsed.count,
      date_range: parsed.date_range,
    };
  });

  const result = txn();
  return {
    ok: true,
    import_run_id: result.import_run_id,
    imported: result.imported,
    date_range: result.date_range,
  };
}

/** Map an import_runs row to a parsed-metadata-only object (never raw CSV). */
function mapImportRun(row) {
  const payload = safeParse(row.payload, {});
  return {
    import_run_id: row.import_run_id,
    elder_id: row.elder_id,
    created_at: row.created_at,
    source: payload.source ?? null,
    file_name: SAFE_FILE_LABEL,
    row_count: payload.row_count ?? null,
    date_range: payload.date_range ?? null,
    quality_summary: payload.quality_summary ?? null,
  };
}

/**
 * Elder-scoped import history, newest first.
 *
 * @returns {{ok:true,elder_id,limit,runs:object[]}}
 */
export function getImportHistory({ db = getDb(), elderId, limit }) {
  if (typeof elderId !== "string" || elderId.trim() === "") {
    throw new ValidationError("validation_error");
  }
  assertImportSubject(db, elderId);
  const effectiveLimit = clampLimit(limit);
  const rows = db
    .prepare(
      `SELECT import_run_id, elder_id, payload, created_at
         FROM import_runs
        WHERE elder_id = ?
        ORDER BY import_run_id DESC
        LIMIT ?`,
    )
    .all(elderId, effectiveLimit);
  return {
    ok: true,
    elder_id: elderId,
    limit: effectiveLimit,
    runs: rows.map(mapImportRun),
  };
}

export { ALLOWED_BODY_KEYS };
