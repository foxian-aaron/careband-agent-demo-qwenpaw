// backend/tests/event-task-workflow.test.js
//
// Stage 5 — canonical event contract + caregiver task workflow contract.
//
// Covers:
//   * eventContract.normalizeEvent: alias normalization + source preservation,
//     rejection of unknown event_type / hardware source / top-level risk field /
//     extra top-level field / raw transcript / raw audio / precise location /
//     client risk fields in payload; region-level location allowed; purity.
//   * POST /api/events: unknown elder -> 404 (no persist); forbidden inputs ->
//     400 (no persist); software_simulator SOS -> 201, canonical sos, urgent,
//     open task; non-urgent event -> task=null.
//   * PATCH /api/tasks/:id: acknowledged->in_progress->resolved; after resolve
//     the linked SOS is marked resolved and risk is no longer urgent; urgent
//     cancelled -> 409; unknown task -> 404; invalid status -> 400; backward
//     transition -> 409; same-status idempotent -> 200.
//   * safe error responses never leak stack, local path or raw input.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

import { normalizeEvent, ValidationError } from "../src/eventContract.js";
import { createApp } from "../src/app.js";
import { openDatabase, getDb, closeDb } from "../src/db.js";

const NOW = "2026-08-01T12:00:00.000Z";

let tmpRoot;
let seq = 0;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "careband-stage5-"));
  assert.ok(
    tmpRoot.startsWith(tmpdir()),
    "scratch database directory must be under the system temp",
  );
});

after(() => {
  closeDb();
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

function baseEvent(overrides = {}) {
  return {
    elder_id: "E001",
    event_type: "sos",
    source: "software_simulator",
    occurred_at: NOW,
    payload: {},
    ...overrides,
  };
}

function startServer() {
  return new Promise((resolve, reject) => {
    const dbPath = join(
      tmpRoot,
      `wf-${process.pid}-${Date.now()}-${seq++}.sqlite`,
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

function postEvent(baseUrl, body) {
  return fetch(`${baseUrl}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchTask(baseUrl, taskId, body) {
  return fetch(`${baseUrl}/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function eventCount() {
  return getDb().prepare("SELECT COUNT(*) AS n FROM events").get().n;
}

// Seed a data-sufficient snapshot so the risk engine can reach the
// dizziness + medication rules (otherwise data_insufficient short-circuits).
function seedSnapshot(elderId = "E001") {
  getDb()
    .prepare(
      "INSERT INTO snapshots (elder_id, snapshot_date, payload, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(
      elderId,
      "2026-08-01",
      JSON.stringify({ data_quality: 90, wear_time_hours: 12, steps: 5000, sleep_duration: 7 }),
      NOW,
    );
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

// ===================== normalizeEvent (pure) =====================

test("normalizeEvent: aliases map to canonical event types and source is preserved", () => {
  const cases = [
    ["sos_long_press", "sos"],
    ["sos", "sos"],
    ["fall_detected", "fall"],
    ["fall", "fall"],
    ["voice_symptom", "voice"],
    ["voice", "voice"],
    ["medication_reminder", "medication"],
    ["medication_confirmed", "medication"],
    ["medication_missed", "medication"],
    ["medication", "medication"],
    ["location_alert", "location"],
    ["geofence_exit", "location"],
    ["location", "location"],
    ["device_status", "device_status"],
    ["manual_note", "manual_note"],
  ];
  for (const [raw, canonical] of cases) {
    const out = normalizeEvent(baseEvent({ event_type: raw, source: "dashboard" }));
    assert.equal(out.event_type, canonical, `${raw} -> ${canonical}`);
    assert.equal(out.source, "dashboard", "source preserved");
    assert.equal(out.elder_id, "E001");
  }
});

test("normalizeEvent: unknown event_type is rejected", () => {
  assert.throws(() => normalizeEvent(baseEvent({ event_type: "explosion" })), ValidationError);
});

test("normalizeEvent: hardware sources are rejected (only device-neutral allowed)", () => {
  for (const src of ["esp32", "nrf", "apple_watch", "wearable_api"]) {
    assert.throws(() => normalizeEvent(baseEvent({ source: src })), ValidationError);
  }
});

test("normalizeEvent: top-level client risk field is rejected", () => {
  assert.throws(() => normalizeEvent({ ...baseEvent(), status_level: "urgent" }), ValidationError);
});

test("normalizeEvent: any extra top-level field is rejected", () => {
  assert.throws(() => normalizeEvent({ ...baseEvent(), foo: "bar" }), ValidationError);
});

test("normalizeEvent: raw transcript / audio in payload are rejected", () => {
  assert.throws(
    () => normalizeEvent(baseEvent({ payload: { transcript: "原始语音文字" } })),
    ValidationError,
  );
  assert.throws(
    () => normalizeEvent(baseEvent({ payload: { audio: "base64data" } })),
    ValidationError,
  );
  assert.throws(
    () => normalizeEvent(baseEvent({ payload: { raw_text: "我感觉头晕" } })),
    ValidationError,
  );
});

test("normalizeEvent: precise location in payload is rejected", () => {
  assert.throws(
    () =>
      normalizeEvent(
        baseEvent({ event_type: "location_alert", payload: { lat: 31.23, lng: 121.47 } }),
      ),
    ValidationError,
  );
  assert.throws(
    () =>
      normalizeEvent(
        baseEvent({ event_type: "location_alert", payload: { address: "某市某区某街1号" } }),
      ),
    ValidationError,
  );
});

test("normalizeEvent: region-level location payload is allowed and normalized", () => {
  const out = normalizeEvent(
    baseEvent({ event_type: "geofence_exit", source: "system", payload: { region: "garden" } }),
  );
  assert.equal(out.event_type, "location");
  assert.equal(out.source, "system");
  assert.deepEqual(out.payload, { region: "garden" });
});

test("normalizeEvent: client risk fields inside payload are rejected", () => {
  assert.throws(
    () => normalizeEvent(baseEvent({ payload: { status_level: "urgent" } })),
    ValidationError,
  );
  assert.throws(
    () => normalizeEvent(baseEvent({ payload: { risk_score: 99 } })),
    ValidationError,
  );
});

test("normalizeEvent: returns a new object and does not mutate the input", () => {
  const input = baseEvent({ payload: { confidence: 0.9 } });
  const snapshot = { ...input, payload: { ...input.payload } };
  const out = normalizeEvent(input);
  assert.notEqual(out, input);
  assert.deepEqual(input, snapshot, "input must not be mutated");
});

test("normalizeEvent: missing / empty required fields are rejected", () => {
  assert.throws(
    () => normalizeEvent({ event_type: "sos", source: "software_simulator", occurred_at: NOW, payload: {} }),
    ValidationError,
  );
  assert.throws(
    () => normalizeEvent(baseEvent({ elder_id: "" })),
    ValidationError,
  );
});

// ===== REPAIR 1 — recursive + case-insensitive payload forbidden keys =====

test("normalizeEvent: nested forbidden keys are rejected (all depths)", () => {
  assert.throws(
    () => normalizeEvent(baseEvent({ payload: { meta: { raw_text: "secret" } } })),
    ValidationError,
  );
  assert.throws(
    () => normalizeEvent(baseEvent({ payload: { ctx: { coordinates: [1, 2] } } })),
    ValidationError,
  );
  assert.throws(
    () => normalizeEvent(baseEvent({ payload: { detail: { risk_score: 100 } } })),
    ValidationError,
  );
});

test("normalizeEvent: forbidden keys inside arrays are rejected", () => {
  assert.throws(
    () =>
      normalizeEvent(baseEvent({ event_type: "location_alert", payload: { points: [{ lat: 31.2, lng: 121.4 }] } })),
    ValidationError,
  );
  assert.throws(
    () => normalizeEvent(baseEvent({ payload: { items: [{ nested: { audio: "x" } }] } })),
    ValidationError,
  );
});

test("normalizeEvent: case-variant forbidden keys are rejected (top-level + nested)", () => {
  assert.throws(
    () => normalizeEvent(baseEvent({ payload: { RAW_TEXT: "secret" } })),
    ValidationError,
  );
  assert.throws(
    () => normalizeEvent(baseEvent({ payload: { Transcript: "secret" } })),
    ValidationError,
  );
  assert.throws(
    () => normalizeEvent(baseEvent({ payload: { meta: { LAT: 31.2, LNG: 121.4 } } })),
    ValidationError,
  );
  assert.throws(
    () => normalizeEvent(baseEvent({ payload: { deep: { Status_Level: "urgent" } } })),
    ValidationError,
  );
});

test("normalizeEvent: safe nested payload with no forbidden keys is allowed", () => {
  const out = normalizeEvent(
    baseEvent({ payload: { note: "ok", meta: { region: "garden", count: 3 } } }),
  );
  assert.deepEqual(out.payload, { note: "ok", meta: { region: "garden", count: 3 } });
});

// ===== REPAIR 2 — occurred_at strict ISO-8601 with timezone =====

test("normalizeEvent: occurred_at valid ISO with Z is preserved", () => {
  const out = normalizeEvent(baseEvent({ occurred_at: "2026-08-01T12:00:00.000Z" }));
  assert.equal(out.occurred_at, "2026-08-01T12:00:00.000Z");
});

test("normalizeEvent: occurred_at with offset is normalized to UTC ISO", () => {
  const out = normalizeEvent(baseEvent({ occurred_at: "2026-08-01T20:00:00.000+08:00" }));
  assert.equal(out.occurred_at, "2026-08-01T12:00:00.000Z");
});

test("normalizeEvent: occurred_at with negative offset is normalized", () => {
  const out = normalizeEvent(baseEvent({ occurred_at: "2026-08-01T07:00:00-05:00" }));
  assert.equal(out.occurred_at, "2026-08-01T12:00:00.000Z");
});

test("normalizeEvent: occurred_at non-date / no-timezone / illegal date are rejected", () => {
  assert.throws(() => normalizeEvent(baseEvent({ occurred_at: "not-a-date" })), ValidationError);
  assert.throws(() => normalizeEvent(baseEvent({ occurred_at: "2026-08-01T12:00:00" })), ValidationError);
  assert.throws(() => normalizeEvent(baseEvent({ occurred_at: "2026-13-45T12:00:00Z" })), ValidationError);
  assert.throws(() => normalizeEvent(baseEvent({ occurred_at: "2026-08-01" })), ValidationError);
});

// ===== REPAIR 3 — medication alias stamps canonical action =====

test("normalizeEvent: medication aliases set canonical type and server action", () => {
  const reminder = normalizeEvent(baseEvent({ event_type: "medication_reminder", source: "voice_companion", payload: {} }));
  assert.equal(reminder.event_type, "medication");
  assert.equal(reminder.payload.action, "reminder");

  const confirmed = normalizeEvent(baseEvent({ event_type: "medication_confirmed", source: "voice_companion", payload: {} }));
  assert.equal(confirmed.event_type, "medication");
  assert.equal(confirmed.payload.action, "confirmed");

  const missed = normalizeEvent(baseEvent({ event_type: "medication_missed", source: "voice_companion", payload: {} }));
  assert.equal(missed.event_type, "medication");
  assert.equal(missed.payload.action, "missed");
});

test("normalizeEvent: medication alias action overrides a conflicting client action", () => {
  const out = normalizeEvent(
    baseEvent({ event_type: "medication_confirmed", source: "voice_companion", payload: { action: "missed" } }),
  );
  assert.equal(out.payload.action, "confirmed");
});

// ===================== POST /api/events =====================

test("POST /api/events unknown elder returns 404 and does not persist", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await postEvent(baseUrl, {
      elder_id: "NOPE",
      event_type: "sos",
      source: "software_simulator",
      occurred_at: NOW,
      payload: {},
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(eventCount(), 0);
  } finally {
    await stopServer(server);
  }
});

test("POST /api/events forbidden inputs return 400 and are not persisted", async () => {
  const cases = [
    { name: "raw transcript", body: { elder_id: "E001", event_type: "voice_symptom", source: "voice_companion", occurred_at: NOW, payload: { transcript: "secret" } } },
    { name: "raw audio", body: { elder_id: "E001", event_type: "voice_symptom", source: "voice_companion", occurred_at: NOW, payload: { audio: "abc" } } },
    { name: "precise location", body: { elder_id: "E001", event_type: "location_alert", source: "system", occurred_at: NOW, payload: { lat: 1, lng: 2 } } },
    { name: "hardware source", body: { elder_id: "E001", event_type: "sos", source: "esp32", occurred_at: NOW, payload: {} } },
    { name: "top-level risk field", body: { elder_id: "E001", event_type: "sos", source: "software_simulator", occurred_at: NOW, payload: {}, status_level: "urgent" } },
    { name: "client risk in payload", body: { elder_id: "E001", event_type: "sos", source: "software_simulator", occurred_at: NOW, payload: { risk_score: 100 } } },
  ];
  for (const { name, body } of cases) {
    const { server, baseUrl } = await startServer();
    try {
      const res = await postEvent(baseUrl, body);
      assert.equal(res.status, 400, `${name} should be 400`);
      const jb = await res.json();
      assert.equal(jb.ok, false);
      assert.equal(eventCount(), 0, `${name} must not persist an event`);
    } finally {
      await stopServer(server);
    }
  }
});

test("POST /api/events software_simulator SOS -> 201, canonical sos, urgent, open task", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await postEvent(baseUrl, {
      elder_id: "E001",
      event_type: "sos_long_press",
      source: "software_simulator",
      occurred_at: NOW,
      payload: {},
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.event.event_type, "sos");
    assert.equal(body.event.source, "software_simulator");
    assert.equal(body.event.status, "active");
    assert.equal(body.event.elder_id, "E001");
    assert.equal(body.risk_result.status_level, "urgent");
    assert.equal(body.risk_result.risk_score, 100);
    assert.ok(body.task, "an urgent event must create a caregiver task");
    assert.equal(body.task.status, "open");
    assert.equal(body.task.risk_level, "urgent");
    assert.equal(body.task.linked_event_id, body.event.event_id);
  } finally {
    await stopServer(server);
  }
});

test("POST /api/events non-urgent event creates no task (task=null)", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await postEvent(baseUrl, {
      elder_id: "E001",
      event_type: "manual_note",
      source: "dashboard",
      occurred_at: NOW,
      payload: { note: "visited" },
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.event.event_type, "manual_note");
    assert.equal(body.task, null);
    assert.notEqual(body.risk_result.status_level, "urgent");
    assert.notEqual(body.risk_result.status_level, "high_risk");
  } finally {
    await stopServer(server);
  }
});

test("POST /api/events fall (medium confidence) -> high_risk open task", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await postEvent(baseUrl, {
      elder_id: "E001",
      event_type: "fall_detected",
      source: "software_simulator",
      occurred_at: NOW,
      payload: { confidence: 0.6 },
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.event.event_type, "fall");
    assert.equal(body.risk_result.status_level, "high_risk");
    assert.equal(body.task.status, "open");
    assert.equal(body.task.risk_level, "high_risk");
  } finally {
    await stopServer(server);
  }
});

// ===================== PATCH /api/tasks/:id =====================

async function createUrgentTask(baseUrl, overrides = {}) {
  const res = await postEvent(baseUrl, {
    elder_id: "E001",
    event_type: "sos",
    source: "software_simulator",
    occurred_at: NOW,
    payload: {},
    ...overrides,
  });
  const body = await res.json();
  return { task: body.task, eventId: body.event.event_id };
}

test("PATCH /api/tasks/:id acknowledged->in_progress->resolved; resolved SOS no longer urgent", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const { task, eventId } = await createUrgentTask(baseUrl);

    let r = await patchTask(baseUrl, task.task_id, { status: "acknowledged" });
    assert.equal(r.status, 200);
    let b = await r.json();
    assert.equal(b.ok, true);
    assert.equal(b.task.status, "acknowledged");
    assert.equal(b.task.task_id, task.task_id);

    r = await patchTask(baseUrl, task.task_id, { status: "in_progress" });
    assert.equal(r.status, 200);
    b = await r.json();
    assert.equal(b.task.status, "in_progress");

    r = await patchTask(baseUrl, task.task_id, { status: "resolved" });
    assert.equal(r.status, 200);
    b = await r.json();
    assert.equal(b.task.status, "resolved");
    // Linked SOS is now resolved -> no longer active -> risk no longer urgent.
    assert.notEqual(b.risk_result.status_level, "urgent");

    // The linked event row is marked resolved in storage.
    const stored = JSON.parse(
      getDb().prepare("SELECT payload FROM events WHERE event_id = ?").get(eventId).payload,
    );
    assert.equal(stored.status, "resolved");
  } finally {
    await stopServer(server);
  }
});

test("PATCH urgent task to cancelled returns 409", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const { task } = await createUrgentTask(baseUrl);
    const r = await patchTask(baseUrl, task.task_id, { status: "cancelled" });
    assert.equal(r.status, 409);
    const b = await r.json();
    assert.equal(b.ok, false);
  } finally {
    await stopServer(server);
  }
});

test("PATCH high_risk task to cancelled is allowed (only urgent is non-cancellable)", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await postEvent(baseUrl, {
      elder_id: "E001",
      event_type: "fall_detected",
      source: "software_simulator",
      occurred_at: NOW,
      payload: { confidence: 0.6 },
    });
    const { task } = await res.json();
    const r = await patchTask(baseUrl, task.task_id, { status: "cancelled" });
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.task.status, "cancelled");
  } finally {
    await stopServer(server);
  }
});

test("PATCH unknown task returns 404", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const r = await patchTask(baseUrl, 999999, { status: "acknowledged" });
    assert.equal(r.status, 404);
  } finally {
    await stopServer(server);
  }
});

test("PATCH invalid status value returns 400", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const { task } = await createUrgentTask(baseUrl);
    const r = await patchTask(baseUrl, task.task_id, { status: "bogus" });
    assert.equal(r.status, 400);
  } finally {
    await stopServer(server);
  }
});

test("PATCH backward transition from a terminal state returns 409", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const { task } = await createUrgentTask(baseUrl);
    await patchTask(baseUrl, task.task_id, { status: "resolved" });
    const r = await patchTask(baseUrl, task.task_id, { status: "open" });
    assert.equal(r.status, 409);
  } finally {
    await stopServer(server);
  }
});

test("PATCH same status is idempotent (200)", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const { task } = await createUrgentTask(baseUrl);
    const r = await patchTask(baseUrl, task.task_id, { status: "open" });
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.task.status, "open");
  } finally {
    await stopServer(server);
  }
});

// ===================== safe error responses =====================

test("error responses never leak stack, local path or raw input (400/404/409)", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const sentinel = "RAW_VOICE_SENTINEL_DO_NOT_ECHO";

    // 400: forbidden payload carrying a secret
    const r400 = await postEvent(baseUrl, {
      elder_id: "E001",
      event_type: "voice_symptom",
      source: "voice_companion",
      occurred_at: NOW,
      payload: { transcript: sentinel },
    });
    assert.equal(r400.status, 400);
    assertSafeBody(await r400.text(), sentinel);

    // 404: unknown task
    const r404 = await patchTask(baseUrl, 999999, { status: "acknowledged" });
    assert.equal(r404.status, 404);
    assertSafeBody(await r404.text(), sentinel);

    // 409: urgent task cancelled
    const { task } = await createUrgentTask(baseUrl);
    const r409 = await patchTask(baseUrl, task.task_id, { status: "cancelled" });
    assert.equal(r409.status, 409);
    assertSafeBody(await r409.text(), sentinel);
  } finally {
    await stopServer(server);
  }
});

// ===================== REPAIR 1 — HTTP: recursive payload =====================

test("POST /api/events nested / case-variant forbidden payload returns 400 and is not persisted", async () => {
  const cases = [
    { name: "nested raw_text", body: { elder_id: "E001", event_type: "voice_symptom", source: "voice_companion", occurred_at: NOW, payload: { meta: { raw_text: "secret" } } } },
    { name: "case-variant Transcript", body: { elder_id: "E001", event_type: "voice_symptom", source: "voice_companion", occurred_at: NOW, payload: { TRANSCRIPT: "secret" } } },
    { name: "nested coordinates", body: { elder_id: "E001", event_type: "location_alert", source: "system", occurred_at: NOW, payload: { ctx: { coordinates: [1, 2] } } } },
    { name: "nested client risk", body: { elder_id: "E001", event_type: "sos", source: "software_simulator", occurred_at: NOW, payload: { detail: { risk_score: 100 } } } },
    { name: "array-nested LAT", body: { elder_id: "E001", event_type: "location_alert", source: "system", occurred_at: NOW, payload: { points: [{ LAT: 31.2 }] } } },
  ];
  for (const { name, body } of cases) {
    const { server, baseUrl } = await startServer();
    try {
      const res = await postEvent(baseUrl, body);
      assert.equal(res.status, 400, `${name} should be 400`);
      const jb = await res.json();
      assert.equal(jb.ok, false);
      assert.equal(eventCount(), 0, `${name} must not persist an event`);
    } finally {
      await stopServer(server);
    }
  }
});

// ===================== REPAIR 2 — HTTP: occurred_at =====================

test("POST /api/events invalid occurred_at returns 400 and is not persisted", async () => {
  const cases = [
    { name: "not-a-date", occurred_at: "not-a-date" },
    { name: "no timezone", occurred_at: "2026-08-01T12:00:00" },
    { name: "illegal date", occurred_at: "2026-13-45T12:00:00Z" },
    { name: "date only", occurred_at: "2026-08-01" },
  ];
  for (const { name, occurred_at } of cases) {
    const { server, baseUrl } = await startServer();
    try {
      const res = await postEvent(baseUrl, {
        elder_id: "E001",
        event_type: "sos",
        source: "software_simulator",
        occurred_at,
        payload: {},
      });
      assert.equal(res.status, 400, `${name} should be 400`);
      assert.equal(eventCount(), 0, `${name} must not persist an event`);
    } finally {
      await stopServer(server);
    }
  }
});

test("POST /api/events occurred_at with offset is normalized to UTC in stored event", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await postEvent(baseUrl, {
      elder_id: "E001",
      event_type: "manual_note",
      source: "dashboard",
      occurred_at: "2026-08-01T20:00:00.000+08:00",
      payload: { note: "ok" },
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.event.occurred_at, "2026-08-01T12:00:00.000Z");
  } finally {
    await stopServer(server);
  }
});

// ===================== REPAIR 3 — HTTP: medication alias action =====================

test("POST /api/events medication_confirmed + dizziness does NOT trigger dizziness_medication_unconfirmed", async () => {
  const { server, baseUrl } = await startServer();
  try {
    seedSnapshot();

    // 1. medication_confirmed -> canonical medication, server action=confirmed
    const r1 = await postEvent(baseUrl, {
      elder_id: "E001",
      event_type: "medication_confirmed",
      source: "voice_companion",
      occurred_at: NOW,
      payload: { medication: "降压药" },
    });
    assert.equal(r1.status, 201);
    const b1 = await r1.json();
    assert.equal(b1.event.event_type, "medication");
    assert.equal(b1.event.payload.action, "confirmed");

    // 2. dizziness signal arrives -> must NOT escalate because med is confirmed
    const r2 = await postEvent(baseUrl, {
      elder_id: "E001",
      event_type: "voice_symptom",
      source: "voice_companion",
      occurred_at: NOW,
      payload: { symptom_keywords: ["dizzy"] },
    });
    assert.equal(r2.status, 201);
    const b2 = await r2.json();
    assert.notEqual(b2.risk_result.status_level, "high_risk");
    assert.ok(
      !b2.risk_result.triggered_rules.includes("dizziness_medication_unconfirmed"),
      "confirmed medication must not trigger the unconfirmed rule",
    );
  } finally {
    await stopServer(server);
  }
});

test("POST /api/events medication_missed + dizziness DOES trigger dizziness_medication_unconfirmed (contrast)", async () => {
  const { server, baseUrl } = await startServer();
  try {
    seedSnapshot();
    await postEvent(baseUrl, {
      elder_id: "E001",
      event_type: "medication_missed",
      source: "voice_companion",
      occurred_at: NOW,
      payload: {},
    });
    const r2 = await postEvent(baseUrl, {
      elder_id: "E001",
      event_type: "voice_symptom",
      source: "voice_companion",
      occurred_at: NOW,
      payload: { symptom_keywords: ["头晕"] },
    });
    assert.equal(r2.status, 201);
    const b2 = await r2.json();
    assert.equal(b2.risk_result.status_level, "high_risk");
    assert.ok(
      b2.risk_result.triggered_rules.includes("dizziness_medication_unconfirmed"),
      "missed medication + dizziness must trigger the unconfirmed rule",
    );
  } finally {
    await stopServer(server);
  }
});

// ===================== REPAIR 4 — HTTP: malformed JSON / body limit =====================

test("POST /api/events malformed JSON returns 400 validation_error (not 500)", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const raw = "{ this is not valid json,,,";
    const res = await fetch(`${baseUrl}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw,
    });
    assert.equal(res.status, 400);
    const text = await res.text();
    const body = JSON.parse(text);
    assert.equal(body.ok, false);
    assert.equal(body.error, "validation_error");
    // must not echo the raw input, stack, or path
    assertSafeBody(text, raw);
  } finally {
    await stopServer(server);
  }
});

test("POST /api/events body too large returns 400 validation_error (not 500)", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const huge = "x".repeat(100000);
    const res = await fetch(`${baseUrl}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        elder_id: "E001",
        event_type: "manual_note",
        source: "dashboard",
        occurred_at: NOW,
        payload: { note: huge },
      }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "validation_error");
    assert.equal(eventCount(), 0, "oversized body must not persist");
  } finally {
    await stopServer(server);
  }
});
