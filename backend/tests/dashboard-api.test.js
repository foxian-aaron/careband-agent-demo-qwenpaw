// backend/tests/dashboard-api.test.js
//
// Stage 6A — elders & dashboard READ API contract coverage, through the live
// HTTP app plus a few direct service row-mapping checks. Covers:
//   * GET /api/elders              -> 200, fixed 7-field shape, array risk_tags.
//   * GET /api/elders/:id          -> single elder; unknown -> 404.
//   * GET /api/elders/:id/dashboard -> unified row; empty data -> null/[]/
//                                      data_insufficient (no mock); unknown 404.
//   * seeded payloads expand into structured fields; raw payload STRING never
//     reaches the client; risk is recomputed server-side (ignores client risk).
//   * GET /api/dashboard           -> ok, generated_at, 5 sorted rows, and an
//                                      operational_summary counting only real
//                                      elders (TEST001 excluded).
//   * Stage 5 SOS workflow: POST -> active sos + urgent + open task; PATCH
//     resolved -> urgent cleared, active_events empty, task resolved.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

import { createApp } from "../src/app.js";
import { openDatabase, getDb, closeDb } from "../src/db.js";
import * as svc from "../src/dashboardService.js";

const NOW = "2026-08-01T12:00:00.000Z";

// The elder response is fixed to exactly these seven keys.
const ELDER_KEYS = [
  "age",
  "created_at",
  "elder_id",
  "name",
  "risk_tags",
  "room",
  "subject_kind",
];

// Each dashboard row must contain (at least) these keys.
const ROW_KEYS = [
  "active_events",
  "elder",
  "events",
  "latest_agent_output",
  "latest_agent_run",
  "latest_snapshot",
  "risk_result",
  "tasks",
];

let tmpRoot;
let seq = 0;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "careband-stage6a-"));
});

after(() => {
  closeDb();
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

// Spin up a fresh scratch server; resolve its base URL. Each test gets a new DB
// file so seed state never leaks between tests.
function startServer() {
  return new Promise((resolve, reject) => {
    const dbPath = join(
      tmpRoot,
      `dash-${process.pid}-${Date.now()}-${seq++}.sqlite`,
    );
    openDatabase(dbPath);
    const server = createApp().listen(0, "127.0.0.1", () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
    server.on("error", reject);
  });
}

const stopServer = (server) => new Promise((r) => server.close(() => r()));

// Run `fn` against a fresh server, always closing it afterwards.
async function withServer(fn) {
  const ctx = await startServer();
  try {
    return await fn(ctx);
  } finally {
    await stopServer(ctx.server);
  }
}

// GET helper: returns { status, body, text }. The raw text is kept so the "no
// raw payload string" assertions can scan the wire response.
async function getJson(baseUrl, path) {
  const res = await fetch(`${baseUrl}${path}`);
  const text = await res.text();
  let body = null;
  if ((res.headers.get("content-type") || "").includes("application/json")) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: res.status, body, text };
}

const jsonHeaders = { "content-type": "application/json" };
// POST a canonical event through the Stage 5 API.
const postEvent = (baseUrl, body) =>
  fetch(`${baseUrl}/api/events`, { method: "POST", headers: jsonHeaders, body: JSON.stringify(body) });
// PATCH a caregiver task through the Stage 5 API.
const patchTask = (baseUrl, id, body) =>
  fetch(`${baseUrl}/api/tasks/${id}`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify(body) });

// --- seed helpers (operate on the shared DB handle opened by startServer) ---

function insert(table, elderId, payload) {
  const db = getDb();
  if (table === "snapshots") {
    db.prepare(
      "INSERT INTO snapshots (elder_id, snapshot_date, payload, created_at) VALUES (?, ?, ?, ?)",
    ).run(elderId, "2026-08-01", JSON.stringify(payload), NOW);
  } else {
    db.prepare(
      `INSERT INTO ${table} (elder_id, payload, created_at) VALUES (?, ?, ?)`,
    ).run(elderId, JSON.stringify(payload), NOW);
  }
}
const seedSnapshot = (e, p) => insert("snapshots", e, p);
const seedEvent = (e, p) => insert("events", e, p);
const seedTask = (e, p) => insert("tasks", e, p);
const seedAgentOutput = (e, p) => insert("agent_outputs", e, p);
const seedAgentRun = (e, p) => insert("agent_runs", e, p);

// ===================== GET /api/elders =====================

test("GET /api/elders returns 200 with the fixed elder shape and array risk_tags", () =>
  withServer(async ({ baseUrl }) => {
    const { status, body } = await getJson(baseUrl, "/api/elders");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.elders));
    assert.equal(body.elders.length, 5);
    const byId = {};
    for (const elder of body.elders) {
      assert.deepEqual(Object.keys(elder).sort(), ELDER_KEYS);
      assert.ok(Array.isArray(elder.risk_tags));
      byId[elder.elder_id] = elder;
    }
    assert.equal(byId.E001.subject_kind, "elder");
    assert.equal(byId.TEST001.subject_kind, "team_test");
  }));

// ===================== GET /api/elders/:elderId =====================

test("GET /api/elders/:id returns the single elder; unknown -> 404", () =>
  withServer(async ({ baseUrl }) => {
    const ok = await getJson(baseUrl, "/api/elders/E001");
    assert.equal(ok.status, 200);
    assert.equal(ok.body.ok, true);
    assert.deepEqual(Object.keys(ok.body.elder).sort(), ELDER_KEYS);
    assert.equal(ok.body.elder.elder_id, "E001");

    const nf = await getJson(baseUrl, "/api/elders/NOPE");
    assert.equal(nf.status, 404);
    assert.equal(nf.body.ok, false);
    assert.equal(nf.body.error, "not_found");
  }));

// ===================== GET /api/elders/:id/dashboard =====================

test("GET /api/elders/:id/dashboard empty data -> null/[]/data_insufficient; unknown -> 404", () =>
  withServer(async ({ baseUrl }) => {
    const empty = await getJson(baseUrl, "/api/elders/E001/dashboard");
    assert.equal(empty.status, 200);
    assert.equal(empty.body.ok, true);
    assert.deepEqual(Object.keys(empty.body.elder).sort(), ELDER_KEYS);
    assert.equal(empty.body.latest_snapshot, null);
    assert.deepEqual(empty.body.events, []);
    assert.deepEqual(empty.body.active_events, []);
    assert.deepEqual(empty.body.tasks, []);
    assert.equal(empty.body.latest_agent_output, null);
    assert.equal(empty.body.latest_agent_run, null);
    assert.equal(empty.body.risk_result.status_level, "data_insufficient");

    assert.equal((await getJson(baseUrl, "/api/elders/NOPE/dashboard")).status, 404);
  }));

test("GET /api/elders/:id/dashboard expands payloads and never leaks the raw payload string", () =>
  withServer(async ({ baseUrl }) => {
    seedSnapshot("E001", {
      data_quality: 90,
      wear_time_hours: 12,
      steps: 5000,
      sleep_duration: 7,
    });
    seedEvent("E001", {
      elder_id: "E001",
      event_type: "manual_note",
      source: "dashboard",
      occurred_at: NOW,
      payload: { note: "visited" },
      status: "active",
    });
    seedTask("E001", {
      linked_event_id: 1,
      status: "open",
      risk_level: "observation",
      created_at: NOW,
      updated_at: NOW,
    });
    seedAgentOutput("E001", { summary: "状态平稳", audience: "caregiver" });
    seedAgentRun("E001", { trace: "run-1", duration_ms: 1200 });

    const { status, body, text } = await getJson(
      baseUrl,
      "/api/elders/E001/dashboard",
    );
    assert.equal(status, 200);

    const snap = body.latest_snapshot;
    assert.equal(typeof snap.snapshot_id, "number");
    assert.equal(snap.elder_id, "E001");
    assert.equal(snap.snapshot_date, "2026-08-01");
    assert.equal(snap.data_quality, 90);
    assert.equal(snap.steps, 5000);
    assert.equal(snap.payload, undefined, "snapshot payload must be expanded");

    const ev = body.events[0];
    assert.equal(typeof ev.event_id, "number");
    assert.equal(ev.event_type, "manual_note");
    assert.equal(ev.status, "active");
    assert.equal(typeof ev.payload, "object", "event payload is structured");

    assert.equal(body.active_events.length, 1);
    assert.equal(body.active_events[0].event_type, "manual_note");

    const task = body.tasks[0];
    assert.equal(typeof task.task_id, "number");
    assert.equal(task.status, "open");
    assert.equal(task.risk_level, "observation");
    assert.equal(task.payload, undefined, "task payload must be expanded");

    assert.equal(typeof body.latest_agent_output.agent_output_id, "number");
    assert.equal(body.latest_agent_output.summary, "状态平稳");
    assert.equal(body.latest_agent_output.payload, undefined);
    assert.equal(typeof body.latest_agent_run.agent_run_id, "number");
    assert.equal(body.latest_agent_run.trace, "run-1");
    assert.equal(body.latest_agent_run.payload, undefined);

    // the DB raw payload STRING column never reaches the client
    assert.ok(!text.includes('"payload":"'), "raw payload string leaked");
    assert.ok(!text.includes('\\"elder_id\\"'), "double-encoded JSON leaked");

    // risk recomputed server-side from snapshot + events -> stable
    assert.equal(body.risk_result.status_level, "stable");
    assert.equal(body.risk_result.risk_score, 12);
  }));

test("risk_result is authoritative: a client status_level in the snapshot is ignored", () =>
  withServer(async ({ baseUrl }) => {
    seedSnapshot("E001", {
      status_level: "urgent",
      risk_score: 99,
      data_quality: 90,
      wear_time_hours: 12,
      steps: 5000,
      sleep_duration: 7,
    });
    const { body } = await getJson(baseUrl, "/api/elders/E001/dashboard");
    assert.equal(body.risk_result.status_level, "stable");
  }));

// ===================== GET /api/dashboard =====================

test("GET /api/dashboard: ok, parseable generated_at, 5 sorted rows; fresh DB rows are null/[]/data_insufficient", () =>
  withServer(async ({ baseUrl }) => {
    const { status, body } = await getJson(baseUrl, "/api/dashboard");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.ok(Number.isFinite(Date.parse(body.generated_at)));
    assert.ok(Array.isArray(body.rows));
    assert.equal(body.rows.length, 5);
    const ids = body.rows.map((r) => r.elder.elder_id);
    assert.deepEqual(ids, [...ids].sort(), "rows must be sorted by elder_id");
    assert.ok(ids.includes("TEST001"));
    for (const row of body.rows) {
      for (const key of ROW_KEYS) assert.ok(key in row, `row must contain "${key}"`);
      assert.deepEqual(Object.keys(row.elder).sort(), ELDER_KEYS);
      assert.equal(row.latest_snapshot, null);
      assert.deepEqual(row.events, []);
      assert.deepEqual(row.active_events, []);
      assert.deepEqual(row.tasks, []);
      assert.equal(row.latest_agent_output, null);
      assert.equal(row.latest_agent_run, null);
      assert.equal(row.risk_result.status_level, "data_insufficient");
    }
  }));

test("operational_summary counts only subject_kind=elder (TEST001 excluded)", () =>
  withServer(async ({ baseUrl }) => {
    const { body } = await getJson(baseUrl, "/api/dashboard");
    const s = body.operational_summary;
    assert.equal(s.elder_count, 4);
    assert.equal(s.urgent_count, 0);
    assert.equal(s.high_risk_count, 0);
    assert.equal(s.active_task_count, 0);
    assert.equal(s.status_distribution.data_insufficient, 4);
    assert.equal(
      Object.values(s.status_distribution).reduce((a, b) => a + b, 0),
      4,
    );
  }));

test("dashboard reflects Stage 5 SOS workflow: urgent+active on POST, cleared on PATCH resolve", () =>
  withServer(async ({ baseUrl }) => {
    // 1. POST a software_simulator SOS through the Stage 5 API
    const res = await postEvent(baseUrl, {
      elder_id: "E001",
      event_type: "sos_long_press",
      source: "software_simulator",
      occurred_at: NOW,
      payload: {},
    });
    assert.equal(res.status, 201);
    const taskId = (await res.json()).task.task_id;

    // 2. E001 row: canonical sos, active_events, urgent, open task
    let e001 = (await getJson(baseUrl, "/api/dashboard")).body.rows.find(
      (r) => r.elder.elder_id === "E001",
    );
    assert.equal(e001.events[0].event_type, "sos");
    assert.equal(e001.events[0].status, "active");
    assert.ok(e001.active_events.length > 0, "SOS must appear in active_events");
    assert.equal(e001.active_events[0].event_type, "sos");
    assert.equal(e001.risk_result.status_level, "urgent");
    assert.equal(e001.tasks[0].status, "open");
    assert.equal(e001.tasks[0].risk_level, "urgent");
    let summary = (await getJson(baseUrl, "/api/dashboard")).body
      .operational_summary;
    assert.equal(summary.urgent_count, 1);
    assert.equal(summary.active_task_count, 1);

    // 3. PATCH the task to resolved through the Stage 5 API
    assert.equal(
      (await patchTask(baseUrl, taskId, { status: "resolved" })).status,
      200,
    );

    // 4. urgent cleared, active_events empty, task resolved
    e001 = (await getJson(baseUrl, "/api/dashboard")).body.rows.find(
      (r) => r.elder.elder_id === "E001",
    );
    assert.notEqual(e001.risk_result.status_level, "urgent");
    assert.equal(e001.active_events.length, 0);
    assert.equal(e001.tasks[0].status, "resolved");
    summary = (await getJson(baseUrl, "/api/dashboard")).body
      .operational_summary;
    assert.equal(summary.urgent_count, 0);
    assert.equal(summary.active_task_count, 0);
  }));

test("GET /api/dashboard returns only the latest agent_output/run per elder, never the raw JSON string", () =>
  withServer(async ({ baseUrl }) => {
    seedAgentOutput("E001", { summary: "first", audience: "caregiver" });
    seedAgentOutput("E001", { summary: "second", audience: "caregiver" });
    seedAgentRun("E001", { trace: "run-1", duration_ms: 100 });
    seedAgentRun("E001", { trace: "run-2", duration_ms: 200 });

    const { status, body, text } = await getJson(baseUrl, "/api/dashboard");
    assert.equal(status, 200);
    const e001 = body.rows.find((r) => r.elder.elder_id === "E001");
    assert.equal(e001.latest_agent_output.summary, "second");
    assert.equal(typeof e001.latest_agent_output.agent_output_id, "number");
    assert.equal(e001.latest_agent_output.payload, undefined);
    assert.equal(e001.latest_agent_run.trace, "run-2");
    assert.equal(typeof e001.latest_agent_run.agent_run_id, "number");
    assert.equal(e001.latest_agent_run.payload, undefined);
    assert.ok(!text.includes('"payload":"'), "raw payload string leaked");
  }));

// ============= service row-mapping (direct) =============

test("dashboardService row mappers expand payloads and never expose the raw string", () => {
  const event = svc.mapEvent({
    event_id: 7,
    elder_id: "E001",
    created_at: NOW,
    payload: JSON.stringify({ event_type: "sos", payload: {} }),
  });
  assert.equal(event.event_id, 7);
  assert.equal(event.event_type, "sos");
  assert.equal(typeof event.payload, "object");

  const task = svc.mapTask({
    task_id: 3,
    elder_id: "E002",
    created_at: NOW,
    payload: JSON.stringify({ status: "open", risk_level: "urgent" }),
  });
  assert.equal(task.task_id, 3);
  assert.equal(task.status, "open");
  assert.equal(task.payload, undefined);

  const snap = svc.mapSnapshot({
    snapshot_id: 1,
    elder_id: "E001",
    snapshot_date: "2026-08-01",
    created_at: NOW,
    payload: JSON.stringify({ data_quality: 50 }),
  });
  assert.equal(snap.data_quality, 50);
  assert.equal(snap.payload, undefined);

  const elder = svc.mapElder({
    elder_id: "E001",
    name: "A",
    age: 78,
    room: "101",
    risk_tags: "[]",
    subject_kind: "elder",
    created_at: NOW,
  });
  assert.deepEqual(Object.keys(elder).sort(), ELDER_KEYS);
  assert.ok(Array.isArray(elder.risk_tags));

  const output = svc.mapAgentOutput({
    agent_output_id: 9,
    elder_id: "E001",
    created_at: NOW,
    payload: JSON.stringify({ summary: "ok", audience: "caregiver" }),
  });
  assert.equal(output.agent_output_id, 9);
  assert.equal(output.summary, "ok");
  assert.equal(output.payload, undefined);

  const run = svc.mapAgentRun({
    agent_run_id: 5,
    elder_id: "E001",
    created_at: NOW,
    payload: JSON.stringify({ trace: "abc", duration_ms: 1200 }),
  });
  assert.equal(run.agent_run_id, 5);
  assert.equal(run.trace, "abc");
  assert.equal(run.payload, undefined);
});

test("mapSnapshot: DB metadata wins over forged payload fields (no override)", () => {
  const snap = svc.mapSnapshot({
    snapshot_id: 42,
    elder_id: "E001",
    snapshot_date: "2026-08-01",
    created_at: NOW,
    payload: JSON.stringify({
      snapshot_id: 999,
      elder_id: "FORGED",
      snapshot_date: "1999-01-01",
      created_at: "1970-01-01T00:00:00.000Z",
      data_quality: 80,
    }),
  });
  assert.equal(snap.snapshot_id, 42);
  assert.equal(snap.elder_id, "E001");
  assert.equal(snap.snapshot_date, "2026-08-01");
  assert.equal(snap.created_at, NOW);
  assert.equal(snap.data_quality, 80);
});

// ============= sanitization: sensitive + client risk key stripping =============
//
// snapshot/event payloads drop client-owned risk keys (server recomputes);
// task/agent-output/agent-run payloads KEEP them (server-authoritative).
// Privacy-sensitive keys are stripped everywhere, recursively + case-blind.

test("mappers sanitize payloads: sensitive keys stripped everywhere; client-risk stripped for snapshot/event, kept for task/output/run", () => {
  const at = (o, p) =>
    p.split(".").reduce((x, k) => (x == null ? x : x[k]), o);
  const cases = [
    {
      map: svc.mapSnapshot,
      idKey: "snapshot_id",
      extra: { snapshot_date: "2026-08-01" },
      payload: {
        data_quality: 80,
        raw_text: "secret",
        Transcript: "leaked",
        lat: 31.2,
        nested: {
          diagnosis: "private",
          GPS: { lat: 1 },
          arr: [{ longitude: 120 }, { steps: 5 }],
        },
        status_level: "urgent",
        risk_score: 99,
        key_reasons: ["x"],
        recommended_action: "do something",
      },
      checks: [
        ["data_quality", 80],
        ["raw_text", undefined],
        ["Transcript", undefined],
        ["lat", undefined],
        ["nested.diagnosis", undefined],
        ["nested.GPS", undefined],
        ["nested.arr.0.longitude", undefined],
        ["nested.arr.1.steps", 5],
        ["status_level", undefined],
        ["risk_score", undefined],
        ["key_reasons", undefined],
        ["recommended_action", undefined],
      ],
    },
    {
      map: svc.mapEvent,
      idKey: "event_id",
      payload: {
        event_type: "sos",
        status: "active",
        status_level: "urgent",
        risk_score: 88,
        payload: { note: "ok", recording: "data", coords: { lat: 1, lon: 2 } },
      },
      checks: [
        ["event_type", "sos"],
        ["status", "active"],
        ["status_level", undefined],
        ["risk_score", undefined],
        ["payload.note", "ok"],
        ["payload.recording", undefined],
        ["payload.coords", undefined],
      ],
    },
    {
      map: svc.mapTask,
      idKey: "task_id",
      payload: {
        status: "open",
        risk_level: "urgent",
        status_level: "urgent",
        risk_score: 95,
        key_reasons: ["fall"],
        recommended_action: "act",
        audio: "base64data",
        nested: { diagnosis: "x", address: "123 St" },
      },
      checks: [
        ["status", "open"],
        ["risk_level", "urgent"],
        ["status_level", "urgent"],
        ["risk_score", 95],
        ["key_reasons", ["fall"]],
        ["recommended_action", "act"],
        ["audio", undefined],
        ["nested.diagnosis", undefined],
        ["nested.address", undefined],
      ],
    },
    {
      map: svc.mapAgentOutput,
      idKey: "agent_output_id",
      payload: {
        summary: "ok",
        status_level: "urgent",
        risk_score: 95,
        recommended_action: "act",
        voice_data: "raw",
        nested: [{ prescription: "med", dosage: "5mg" }],
      },
      checks: [
        ["summary", "ok"],
        ["status_level", "urgent"],
        ["risk_score", 95],
        ["recommended_action", "act"],
        ["voice_data", undefined],
        ["nested.0.prescription", undefined],
        ["nested.0.dosage", undefined],
      ],
    },
    {
      map: svc.mapAgentRun,
      idKey: "agent_run_id",
      payload: {
        trace: "run-1",
        duration_ms: 1200,
        status_level: "urgent",
        risk_score: 90,
        key_reasons: ["alert"],
        asr_text: "transcript text",
        nested: { trajectory: [{ lat: 1 }] },
      },
      checks: [
        ["trace", "run-1"],
        ["duration_ms", 1200],
        ["status_level", "urgent"],
        ["risk_score", 90],
        ["key_reasons", ["alert"]],
        ["asr_text", undefined],
        ["nested.trajectory", undefined],
      ],
    },
  ];

  for (const c of cases) {
    const row = {
      [c.idKey]: 1,
      elder_id: "E001",
      created_at: NOW,
      payload: JSON.stringify(c.payload),
      ...(c.extra || {}),
    };
    const got = c.map(row);
    assert.equal(got[c.idKey], 1, `${c.map.name}: id overlaid`);
    assert.equal(got.elder_id, "E001", `${c.map.name}: elder_id overlaid`);
    for (const [path, expected] of c.checks) {
      assert.deepEqual(at(got, path), expected, `${c.map.name}: ${path}`);
    }
  }
});
