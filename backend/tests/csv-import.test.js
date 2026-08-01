// backend/tests/csv-import.test.js
//
// CareBand Stage 9A — CSV DailySnapshot import contract coverage (Issue #23).
//
// Covers:
//   * parseDailySnapshotsCsv (pure): server ownership of elder_id/data_source,
//     empty cells -> null, invalid dates / numbers / steps / sleep / wear /
//     data_quality ranges rejected, header must be exactly the ten columns,
//     row count and csv_text size caps.
//   * POST /api/import/daily-snapshots-csv/preview: read-only (no DB writes),
//     returns {ok,count,snapshots,date_range,quality_summary,warnings}.
//   * POST /api/import/daily-snapshots-csv: 201, stored payloads are exactly
//     the ten server-owned keys (no snapshot_id, no client risk fields),
//     idempotent re-import replaces without duplicating, atomic failure writes
//     nothing, unknown elder -> 404.
//   * GET .../history: elder-scoped, newest first, default 20 / max 50, parsed
//     metadata only (no raw CSV), unknown elder -> 404.
//   * safe errors never echo raw CSV, stack, local path or parser text.
//
// Each test works against a throwaway database file under the system temp dir.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

import {
  parseDailySnapshotsCsv,
  DATA_SOURCE_OVERRIDE,
  MAX_CSV_BYTES,
  MAX_DATA_ROWS,
} from "../src/importers/csvImporter.js";
import { ValidationError } from "../src/eventContract.js";
import { createApp } from "../src/app.js";
import { openDatabase, getDb, closeDb } from "../src/db.js";

const NOW = "2026-08-01T12:00:00.000Z";

const HEADER =
  "elder_id,date,data_source,heart_rate_avg,resting_heart_rate,steps,active_minutes,sleep_duration,wear_time_hours,data_quality";

const EXPECTED_KEYS = [
  "active_minutes",
  "data_quality",
  "data_source",
  "date",
  "elder_id",
  "heart_rate_avg",
  "resting_heart_rate",
  "sleep_duration",
  "steps",
  "wear_time_hours",
];

// Client values for elder_id/data_source are deliberately wrong so the server
// override is observable.
const VALID_CSV = [
  HEADER,
  "CSV_CLIENT_A,2026-08-01,FAKE_SOURCE,72,58,4200,35,7.5,22,92",
  "CSV_CLIENT_A,2026-08-02,FAKE_SOURCE,74,59,5000,40,8.0,23,95",
].join("\n");

let tmpRoot;
let seq = 0;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "careband-stage9a-"));
  assert.ok(
    tmpRoot.startsWith(tmpdir()),
    "scratch database directory must be under the system temp",
  );
});

after(() => {
  closeDb();
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

// ---- HTTP harness (mirrors event-task-workflow.test.js) --------------------

function startServer() {
  return new Promise((resolve, reject) => {
    const dbPath = join(
      tmpRoot,
      `imp-${process.pid}-${Date.now()}-${seq++}.sqlite`,
    );
    openDatabase(dbPath);
    const application = createApp();
    const server = application.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
    server.on("error", reject);
  });
}

function stopServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function postJson(baseUrl, path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function snapshotCount(elderId) {
  return getDb()
    .prepare("SELECT COUNT(*) AS n FROM snapshots WHERE elder_id = ?")
    .get(elderId).n;
}

function importRunCount(elderId) {
  return getDb()
    .prepare("SELECT COUNT(*) AS n FROM import_runs WHERE elder_id = ?")
    .get(elderId).n;
}

function assertSafeBody(text, secret) {
  assert.ok(!text.includes(secret), "error body must not echo raw input");
  assert.ok(!/stack/i.test(text), "error body must not leak a stack trace");
  assert.ok(!text.includes(" at "), "error body must not leak stack frames");
  assert.ok(!/[A-Za-z]:\\/.test(text), "error body must not leak a local path");
  assert.ok(
    !/(\/(Users|home|src|backend)\/)/.test(text),
    "error body must not leak a local path",
  );
}

// ============================ pure parser tests ============================

test("parseDailySnapshotsCsv: server overrides elder_id and data_source on every row", () => {
  const parsed = parseDailySnapshotsCsv({
    csvText: VALID_CSV,
    elderId: "TEST001",
  });
  assert.equal(parsed.count, 2);
  for (const snap of parsed.snapshots) {
    assert.equal(snap.elder_id, "TEST001");
    assert.equal(snap.data_source, DATA_SOURCE_OVERRIDE);
    assert.equal(snap.data_source, "CSV Import");
    assert.deepEqual(Object.keys(snap).sort(), EXPECTED_KEYS);
  }
});

test("parseDailySnapshotsCsv: empty numeric cells become null", () => {
  const csv = `${HEADER}\nTEST001,2026-08-01,CSV Import,72,,1000,30,,12,90`;
  const parsed = parseDailySnapshotsCsv({ csvText: csv, elderId: "TEST001" });
  const snap = parsed.snapshots[0];
  assert.equal(snap.heart_rate_avg, 72);
  assert.equal(snap.resting_heart_rate, null);
  assert.equal(snap.steps, 1000);
  assert.equal(snap.sleep_duration, null);
  assert.equal(snap.wear_time_hours, 12);
  assert.equal(snap.data_quality, 90);
});

test("parseDailySnapshotsCsv: builds date_range and quality_summary", () => {
  const parsed = parseDailySnapshotsCsv({
    csvText: VALID_CSV,
    elderId: "TEST001",
  });
  assert.deepEqual(parsed.date_range, { start: "2026-08-01", end: "2026-08-02" });
  assert.equal(parsed.quality_summary.rows, 2);
  assert.equal(parsed.quality_summary.avg_data_quality, 93.5);
  assert.equal(parsed.quality_summary.min_data_quality, 92);
  assert.equal(parsed.quality_summary.max_data_quality, 95);
  assert.equal(parsed.quality_summary.low_quality_rows, 0);
  assert.ok(Array.isArray(parsed.warnings));
});

test("parseDailySnapshotsCsv: rows with missing measurements and low quality add warnings", () => {
  const csv = [
    HEADER,
    "TEST001,2026-08-01,CSV Import,72,,1000,30,7,12,30",
    "TEST001,2026-08-02,CSV Import,74,59,5000,40,8,23,95",
  ].join("\n");
  const parsed = parseDailySnapshotsCsv({ csvText: csv, elderId: "TEST001" });
  assert.equal(parsed.quality_summary.low_quality_rows, 1);
  assert.ok(parsed.warnings.length >= 1);
});

// ---- invalid input (pure): each case must throw ValidationError -----------

const INVALID_CSV_CASES = [
  { name: "header missing a column", csv: "elder_id,date,data_source,heart_rate_avg,resting_heart_rate,steps,active_minutes,sleep_duration,wear_time_hours\nTEST001,2026-08-01,CSV Import,72,58,1,2,3,4,5" },
  { name: "header has extra column (snapshot_id)", csv: "elder_id,date,data_source,snapshot_id,heart_rate_avg,resting_heart_rate,steps,active_minutes,sleep_duration,wear_time_hours,data_quality\nTEST001,2026-08-01,CSV Import,9,72,58,1,2,3,4,5" },
  { name: "header has client risk column", csv: "elder_id,date,data_source,heart_rate_avg,resting_heart_rate,steps,active_minutes,sleep_duration,wear_time_hours,data_quality,status_level\nTEST001,2026-08-01,CSV Import,72,58,1,2,3,4,5,urgent" },
  { name: "header with unknown column", csv: "elder_id,date,data_source,heart_rate_avg,resting_heart_rate,steps,active_minutes,sleep_duration,wear_time_hours,unexpected\nTEST001,2026-08-01,CSV Import,72,58,1,2,3,4,5" },
  { name: "bad month", csv: `${HEADER}\nTEST001,2026-13-01,CSV Import,72,58,1,2,3,4,5` },
  { name: "bad day (Feb 30)", csv: `${HEADER}\nTEST001,2026-02-30,CSV Import,72,58,1,2,3,4,5` },
  { name: "slash date format", csv: `${HEADER}\nTEST001,2026/08/01,CSV Import,72,58,1,2,3,4,5` },
  { name: "non-date text", csv: `${HEADER}\nTEST001,not-a-date,CSV Import,72,58,1,2,3,4,5` },
  { name: "negative number", csv: `${HEADER}\nTEST001,2026-08-01,CSV Import,-5,58,1,2,3,4,5` },
  { name: "steps not integer", csv: `${HEADER}\nTEST001,2026-08-01,CSV Import,72,58,12.5,2,3,4,5` },
  { name: "sleep over 24", csv: `${HEADER}\nTEST001,2026-08-01,CSV Import,72,58,1,2,25,4,5` },
  { name: "wear over 24", csv: `${HEADER}\nTEST001,2026-08-01,CSV Import,72,58,1,2,3,24.5,5` },
  { name: "data_quality over 100", csv: `${HEADER}\nTEST001,2026-08-01,CSV Import,72,58,1,2,3,4,101` },
  { name: "data_quality negative", csv: `${HEADER}\nTEST001,2026-08-01,CSV Import,72,58,1,2,3,4,-1` },
  { name: "non-numeric cell", csv: `${HEADER}\nTEST001,2026-08-01,CSV Import,abc,58,1,2,3,4,5` },
  { name: "scientific notation rejected", csv: `${HEADER}\nTEST001,2026-08-01,CSV Import,1e3,58,1,2,3,4,5` },
  { name: "thousands separator rejected", csv: `${HEADER}\nTEST001,2026-08-01,CSV Import,1,000,58,1,2,3,4,5` },
  { name: "wrong field count", csv: `${HEADER}\nTEST001,2026-08-01,CSV Import,72,58,1,2,3` },
];

for (const { name, csv } of INVALID_CSV_CASES) {
  test(`parseDailySnapshotsCsv rejects invalid input: ${name}`, () => {
    assert.throws(
      () => parseDailySnapshotsCsv({ csvText: csv, elderId: "TEST001" }),
      ValidationError,
    );
  });
}

test("parseDailySnapshotsCsv rejects more than 366 data rows", () => {
  const rows = Array.from(
    { length: MAX_DATA_ROWS + 1 },
    () => "TEST001,2026-08-01,CSV Import,72,58,1,2,3,4,5",
  ).join("\n");
  assert.throws(
    () => parseDailySnapshotsCsv({ csvText: `${HEADER}\n${rows}`, elderId: "TEST001" }),
    ValidationError,
  );
});

test("parseDailySnapshotsCsv accepts exactly 366 data rows", () => {
  const rows = Array.from(
    { length: MAX_DATA_ROWS },
    (_, index) => {
      const date = new Date(Date.UTC(2025, 0, index + 1))
        .toISOString()
        .slice(0, 10);
      return `TEST001,${date},CSV Import,72,58,1,2,3,4,5`;
    },
  ).join("\n");
  const parsed = parseDailySnapshotsCsv({
    csvText: `${HEADER}\n${rows}`,
    elderId: "TEST001",
  });
  assert.equal(parsed.count, MAX_DATA_ROWS);
});

test("parseDailySnapshotsCsv rejects csv_text over 64 KiB", () => {
  const big = `${HEADER}\nTEST001,2026-08-01,CSV Import,${"1".repeat(MAX_CSV_BYTES)},58,1,2,3,4,5`;
  assert.ok(Buffer.byteLength(big, "utf8") > MAX_CSV_BYTES);
  assert.throws(
    () => parseDailySnapshotsCsv({ csvText: big, elderId: "TEST001" }),
    ValidationError,
  );
});

test("parseDailySnapshotsCsv rejects non-string / empty / header-only csv_text", () => {
  assert.throws(() => parseDailySnapshotsCsv({ csvText: 42, elderId: "TEST001" }), ValidationError);
  assert.throws(() => parseDailySnapshotsCsv({ csvText: "", elderId: "TEST001" }), ValidationError);
  assert.throws(() => parseDailySnapshotsCsv({ csvText: HEADER, elderId: "TEST001" }), ValidationError);
});

test("parseDailySnapshotsCsv does not mutate the input csv_text", () => {
  const input = VALID_CSV;
  const snapshot = input;
  parseDailySnapshotsCsv({ csvText: input, elderId: "TEST001" });
  assert.equal(input, snapshot);
});

test("parseDailySnapshotsCsv rejects malformed quotes and duplicate dates", () => {
  assert.throws(
    () =>
      parseDailySnapshotsCsv({
        csvText: `${HEADER}\n\"unterminated`,
        elderId: "TEST001",
      }),
    ValidationError,
  );
  const firstRow = VALID_CSV.split("\n")[1];
  assert.throws(
    () =>
      parseDailySnapshotsCsv({
        csvText: [HEADER, firstRow, firstRow].join("\n"),
        elderId: "TEST001",
      }),
    ValidationError,
  );
});

test("parseDailySnapshotsCsv rejects unsafe physiological ranges", () => {
  const headers = HEADER.split(",");
  const base = VALID_CSV.split("\n")[1].split(",");
  for (const [field, value] of [
    ["heart_rate_avg", "251"],
    ["resting_heart_rate", "201"],
    ["steps", "200001"],
    ["active_minutes", "1441"],
  ]) {
    const cells = [...base];
    cells[headers.indexOf(field)] = value;
    assert.throws(
      () =>
        parseDailySnapshotsCsv({
          csvText: [HEADER, cells.join(",")].join("\n"),
          elderId: "TEST001",
        }),
      ValidationError,
    );
  }
});

// ===================== POST .../preview (read-only) ========================

test("POST /preview returns parsed snapshots and writes nothing to the database", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const beforeSnap = snapshotCount("TEST001");
    const beforeRun = importRunCount("TEST001");
    const res = await postJson(
      baseUrl,
      "/api/import/daily-snapshots-csv/preview",
      { elder_id: "TEST001", csv_text: VALID_CSV },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.count, 2);
    assert.equal(body.snapshots[0].elder_id, "TEST001");
    assert.equal(body.snapshots[0].data_source, "CSV Import");
    assert.deepEqual(body.date_range, { start: "2026-08-01", end: "2026-08-02" });
    assert.ok(body.quality_summary);
    assert.ok(Array.isArray(body.warnings));
    // Read-only: no snapshot / import_run rows created.
    assert.equal(snapshotCount("TEST001"), beforeSnap);
    assert.equal(importRunCount("TEST001"), beforeRun);
  } finally {
    await stopServer(server);
  }
});

test("POST /preview for an unknown elder returns 404 and writes nothing", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await postJson(
      baseUrl,
      "/api/import/daily-snapshots-csv/preview",
      { elder_id: "NOPE", csv_text: VALID_CSV },
    );
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "not_found");
    assert.equal(snapshotCount("NOPE"), 0);
  } finally {
    await stopServer(server);
  }
});

test("POST /preview rejects real elder profiles; only team_test subjects may import", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await postJson(
      baseUrl,
      "/api/import/daily-snapshots-csv/preview",
      { elder_id: "E001", csv_text: VALID_CSV },
    );
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { ok: false, error: "validation_error" });
    assert.equal(snapshotCount("E001"), 0);
    assert.equal(importRunCount("E001"), 0);
  } finally {
    await stopServer(server);
  }
});

// ===================== POST .../daily-snapshots-csv ========================

test("POST confirm returns 201 and stores exactly the ten server-owned keys", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await postJson(
      baseUrl,
      "/api/import/daily-snapshots-csv",
      { elder_id: "TEST001", csv_text: VALID_CSV, file_name: "sk_live_SECRET.csv" },
    );
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.imported, 2);
    assert.ok(body.import_run_id > 0);

    const rows = getDb()
      .prepare(
        "SELECT snapshot_id, elder_id, snapshot_date, payload FROM snapshots WHERE elder_id = ? ORDER BY snapshot_date",
      )
      .all("TEST001");
    assert.equal(rows.length, 2);
    for (const r of rows) {
      const payload = JSON.parse(r.payload);
      assert.equal(payload.elder_id, "TEST001");
      assert.equal(payload.data_source, "CSV Import");
      assert.ok(!("snapshot_id" in payload), "snapshot_id must not be in payload");
      assert.ok(!("status_level" in payload));
      assert.ok(!("risk_score" in payload));
      assert.ok(!("key_reasons" in payload));
      assert.ok(!("recommended_action" in payload));
      assert.deepEqual(Object.keys(payload).sort(), EXPECTED_KEYS);
    }
    // One import_run logged with parsed metadata only.
    assert.equal(importRunCount("TEST001"), 1);
    const run = getDb()
      .prepare("SELECT payload FROM import_runs WHERE elder_id = ?")
      .get("TEST001");
    const runPayload = JSON.parse(run.payload);
    assert.equal(runPayload.source, "csv_import");
    assert.equal(runPayload.row_count, 2);
    assert.equal(runPayload.file_name, "daily_snapshots.csv");
  } finally {
    await stopServer(server);
  }
});

test("POST confirm is idempotent: re-import replaces snapshots without duplicating", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const first = await postJson(baseUrl, "/api/import/daily-snapshots-csv", {
      elder_id: "TEST001",
      csv_text: VALID_CSV,
    });
    assert.equal(first.status, 201);
    assert.equal(snapshotCount("TEST001"), 2);
    assert.equal(importRunCount("TEST001"), 1);

    // Re-import the same dates with different metric values.
    const updated = [
      HEADER,
      "X,2026-08-01,Y,99,99,9999,99,9.9,9,99",
      "X,2026-08-02,Y,98,98,8888,88,8.8,8,98",
    ].join("\n");
    const second = await postJson(baseUrl, "/api/import/daily-snapshots-csv", {
      elder_id: "TEST001",
      csv_text: updated,
    });
    assert.equal(second.status, 201);

    // Snapshots replaced (still 2, not 4) with the new values.
    assert.equal(snapshotCount("TEST001"), 2);
    const rows = getDb()
      .prepare("SELECT snapshot_date, payload FROM snapshots WHERE elder_id = ? ORDER BY snapshot_date")
      .all("TEST001");
    const aug1 = JSON.parse(rows[0].payload);
    assert.equal(aug1.heart_rate_avg, 99);
    assert.equal(aug1.steps, 9999);

    // Each confirm logs its own import_run.
    assert.equal(importRunCount("TEST001"), 2);
  } finally {
    await stopServer(server);
  }
});

test("POST confirm atomic failure: invalid CSV returns 400 and writes nothing", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const beforeSnap = snapshotCount("TEST001");
    const beforeRun = importRunCount("TEST001");
    const res = await postJson(baseUrl, "/api/import/daily-snapshots-csv", {
      elder_id: "TEST001",
      csv_text: `${HEADER}\nTEST001,2026-02-30,CSV Import,72,58,1,2,3,4,5`,
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "validation_error");
    assert.equal(snapshotCount("TEST001"), beforeSnap);
    assert.equal(importRunCount("TEST001"), beforeRun);
  } finally {
    await stopServer(server);
  }
});

test("POST confirm rolls back an in-transaction failure after the first upsert", async () => {
  const { server, baseUrl } = await startServer();
  try {
    getDb().exec(`
      CREATE TRIGGER fail_second_snapshot
      BEFORE INSERT ON snapshots
      WHEN NEW.snapshot_date = '2026-08-02'
      BEGIN
        SELECT RAISE(ABORT, 'forced_test_failure');
      END;
    `);
    const res = await postJson(baseUrl, "/api/import/daily-snapshots-csv", {
      elder_id: "TEST001",
      csv_text: VALID_CSV,
    });
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { ok: false, error: "internal_error" });
    assert.equal(snapshotCount("TEST001"), 0);
    assert.equal(importRunCount("TEST001"), 0);
  } finally {
    await stopServer(server);
  }
});

test("POST confirm for an unknown elder returns 404 and writes nothing", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await postJson(baseUrl, "/api/import/daily-snapshots-csv", {
      elder_id: "GHOST",
      csv_text: VALID_CSV,
    });
    assert.equal(res.status, 404);
    assert.equal(snapshotCount("GHOST"), 0);
    assert.equal(importRunCount("GHOST"), 0);
  } finally {
    await stopServer(server);
  }
});

test("POST confirm rejects malformed/oversized/extra-field bodies with 400", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const cases = [
      { name: "missing elder_id", body: { csv_text: VALID_CSV } },
      { name: "missing csv_text", body: { elder_id: "TEST001" } },
      { name: "empty elder_id", body: { elder_id: "", csv_text: VALID_CSV } },
      { name: "empty csv_text", body: { elder_id: "TEST001", csv_text: "" } },
      { name: "non-string file_name", body: { elder_id: "TEST001", csv_text: VALID_CSV, file_name: 5 } },
      { name: "unsafe path file_name", body: { elder_id: "TEST001", csv_text: VALID_CSV, file_name: "C:\\private\\daily.csv" } },
      { name: "extra top-level field", body: { elder_id: "TEST001", csv_text: VALID_CSV, status_level: "urgent" } },
    ];
    for (const { name, body } of cases) {
      const res = await postJson(baseUrl, "/api/import/daily-snapshots-csv", body);
      assert.equal(res.status, 400, `${name} should be 400`);
      const jb = await res.json();
      assert.equal(jb.ok, false);
      assert.equal(jb.error, "validation_error");
    }
    assert.equal(snapshotCount("TEST001"), 0);
    assert.equal(importRunCount("TEST001"), 0);
  } finally {
    await stopServer(server);
  }
});

// ============================ GET .../history ==============================

function seedImportRuns(elderId, n) {
  const db = getDb();
  const ins = db.prepare(
    "INSERT INTO import_runs (elder_id, payload, created_at) VALUES (?, ?, ?)",
  );
  for (let i = 0; i < n; i += 1) {
    ins.run(
      elderId,
      JSON.stringify({
        source: "csv_import",
        file_name: "f.csv",
        row_count: 1,
        date_range: { start: "2026-08-01", end: "2026-08-01" },
        quality_summary: { rows: 1, avg_data_quality: 90 },
      }),
      NOW,
    );
  }
}

test("GET history is elder-scoped, newest first, default 20, capped at 50", async () => {
  const { server, baseUrl } = await startServer();
  try {
    getDb()
      .prepare(
        `INSERT INTO elders
           (elder_id, name, age, room, risk_tags, subject_kind, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("TEST002", "Second fictional test subject", null, null, "[]", "team_test", NOW);
    seedImportRuns("TEST001", 55);
    seedImportRuns("TEST002", 3);

    // Isolation: TEST002 history only contains TEST002 runs.
    let res = await fetch(
      `${baseUrl}/api/import/daily-snapshots-csv/history?elder_id=TEST002`,
    );
    assert.equal(res.status, 200);
    let body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.elder_id, "TEST002");
    assert.equal(body.runs.length, 3);
    assert.ok(body.runs.every((r) => r.elder_id === "TEST002"));
    assert.equal(body.runs[0].source, "csv_import");

    // Default limit 20 (55 exist).
    res = await fetch(
      `${baseUrl}/api/import/daily-snapshots-csv/history?elder_id=TEST001`,
    );
    body = await res.json();
    assert.equal(body.limit, 20);
    assert.equal(body.runs.length, 20);
    // Newest first.
    assert.ok(body.runs[0].import_run_id > body.runs[1].import_run_id);

    // Max 50 cap.
    res = await fetch(
      `${baseUrl}/api/import/daily-snapshots-csv/history?elder_id=TEST001&limit=100`,
    );
    body = await res.json();
    assert.equal(body.limit, 50);
    assert.equal(body.runs.length, 50);

    // Explicit small limit.
    res = await fetch(
      `${baseUrl}/api/import/daily-snapshots-csv/history?elder_id=TEST001&limit=5`,
    );
    body = await res.json();
    assert.equal(body.limit, 5);
    assert.equal(body.runs.length, 5);

    // Invalid limit -> default 20.
    res = await fetch(
      `${baseUrl}/api/import/daily-snapshots-csv/history?elder_id=TEST001&limit=abc`,
    );
    body = await res.json();
    assert.equal(body.limit, 20);

    // Parsed metadata only: no raw CSV field anywhere.
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes("csv_text"));
  } finally {
    await stopServer(server);
  }
});

test("GET history for unknown elder returns 404", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(
      `${baseUrl}/api/import/daily-snapshots-csv/history?elder_id=GHOST`,
    );
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "not_found");
  } finally {
    await stopServer(server);
  }
});

test("GET history with missing elder_id returns 400", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(
      `${baseUrl}/api/import/daily-snapshots-csv/history`,
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "validation_error");
  } finally {
    await stopServer(server);
  }
});

// ============================ safe error bodies ============================

test("error responses never echo raw CSV, stack, local path or parser text", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const sentinel = "RAW_CSV_SENTINEL_DO_NOT_ECHO";
    // Non-numeric cell carrying a sentinel -> 400 on preview and confirm.
    const csv = `${HEADER}\nTEST001,2026-08-01,CSV Import,${sentinel},58,1,2,3,4,5`;

    const rPreview = await postJson(
      baseUrl,
      "/api/import/daily-snapshots-csv/preview",
      { elder_id: "TEST001", csv_text: csv },
    );
    assert.equal(rPreview.status, 400);
    assertSafeBody(await rPreview.text(), sentinel);

    const rConfirm = await postJson(
      baseUrl,
      "/api/import/daily-snapshots-csv",
      { elder_id: "TEST001", csv_text: csv },
    );
    assert.equal(rConfirm.status, 400);
    assertSafeBody(await rConfirm.text(), sentinel);

    // 404 must not echo the raw CSV either.
    const r404 = await postJson(
      baseUrl,
      "/api/import/daily-snapshots-csv/preview",
      { elder_id: "NOPE", csv_text: csv },
    );
    assert.equal(r404.status, 404);
    assertSafeBody(await r404.text(), sentinel);
  } finally {
    await stopServer(server);
  }
});

test("oversized csv_text (within transport limit) is rejected with a safe 400", async () => {
  const { server, baseUrl } = await startServer();
  try {
    // ~66 KiB csv_text: under the 400kb /api/import transport limit, over the
    // 64 KiB application cap -> rejected by the service with 400.
    const tooBig = `${HEADER}\nTEST001,2026-08-01,CSV Import,${"1".repeat(MAX_CSV_BYTES)},58,1,2,3,4,5`;
    const res = await postJson(baseUrl, "/api/import/daily-snapshots-csv", {
      elder_id: "TEST001",
      csv_text: tooBig,
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "validation_error");
    assert.equal(snapshotCount("TEST001"), 0);
  } finally {
    await stopServer(server);
  }
});

test("a valid CSV below 64 KiB survives worst-case JSON escaping", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const noisyIgnoredElder = "\\".repeat(100);
    const rows = Array.from({ length: MAX_DATA_ROWS }, (_, index) => {
      const date = new Date(Date.UTC(2025, 0, index + 1))
        .toISOString()
        .slice(0, 10);
      return `${noisyIgnoredElder},${date},client,72,58,1,2,3,4,90`;
    });
    const csvText = [HEADER, ...rows].join("\n");
    assert.ok(Buffer.byteLength(csvText, "utf8") <= MAX_CSV_BYTES);
    assert.ok(
      Buffer.byteLength(JSON.stringify({ elder_id: "TEST001", csv_text: csvText }), "utf8") >
        80 * 1024,
    );
    const res = await postJson(
      baseUrl,
      "/api/import/daily-snapshots-csv/preview",
      { elder_id: "TEST001", csv_text: csvText },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.count, MAX_DATA_ROWS);
    assert.equal(snapshotCount("TEST001"), 0);
    assert.equal(importRunCount("TEST001"), 0);
  } finally {
    await stopServer(server);
  }
});
