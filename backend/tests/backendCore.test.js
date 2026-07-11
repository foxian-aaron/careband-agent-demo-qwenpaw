import assert from "node:assert/strict";
import test from "node:test";
import { eventSchema } from "../src/validators.js";

process.env.DATABASE_PATH = ":memory:";
process.env.AGENT_PROVIDER = "mock";
const db = await import("../src/db.js");
const { createApp } = await import("../src/server.js");

const restoreEnv = (name, value) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

const withServer = async (run) => {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
};

test("legacy event input is normalized to the shared event contract", () => {
  const event = eventSchema.parse({
    elder_id: "E001",
    event_type: "sos_long_press",
    timestamp: "2026-07-11T08:00:00.000Z",
    source: "demo",
    raw_text: "SOS 长按求助",
    payload: { button_press_seconds: 3 },
  });

  assert.equal(event.event_type, "sos");
  assert.equal(event.occurred_at, "2026-07-11T08:00:00.000Z");
  assert.equal(event.source, "mock");
  assert.equal(event.payload.action, "long_press");
  assert.equal(event.severity_hint, "urgent");
});

test("unknown event types and sources are rejected instead of silently downgraded", () => {
  assert.throws(
    () =>
      eventSchema.parse({
        elder_id: "E001",
        event_type: "s0s",
        source: "esp32",
        payload: { action: "long_press" },
      }),
    /Invalid enum value/,
  );
  assert.throws(
    () =>
      eventSchema.parse({
        elder_id: "E001",
        event_type: "sos",
        source: "esp32-prod",
        payload: { action: "long_press" },
      }),
    /Invalid enum value/,
  );
});

test("daily snapshots are idempotent and the seven-day baseline excludes the latest date", () => {
  for (let day = 1; day <= 8; day += 1) {
    db.insertSnapshot({
      elder_id: "E001",
      date: `2026-07-${String(day).padStart(2, "0")}`,
      data_source: "CSV Import",
      heart_rate_avg: 74,
      resting_heart_rate: 70,
      steps: day * 1000,
      active_minutes: 30,
      sleep_duration: 7,
      wear_time_hours: 18,
      data_quality: 90,
    });
  }
  db.insertSnapshot({
    elder_id: "E001",
    date: "2026-07-08",
    data_source: "CSV Import",
    heart_rate_avg: 74,
    resting_heart_rate: 70,
    steps: 9999,
    active_minutes: 30,
    sleep_duration: 7,
    wear_time_hours: 18,
    data_quality: 90,
  });

  const recent = db.getRecentSnapshots("E001", 31);
  const baseline = db.getBaseline("E001", "2026-07-08");

  assert.equal(recent.filter((row) => row.date === "2026-07-08").length, 1);
  assert.equal(baseline.usable_days, 7);
  assert.equal(baseline.avg_steps_7d, 4000);
  assert.equal(baseline.excludes_date, "2026-07-08");
});

test("POST /api/events creates an urgent task for SOS without a snapshot", async () => {
  db.resetDemoData();
  db.getDb().prepare("DELETE FROM snapshots WHERE elder_id = 'E001'").run();

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        elder_id: "E001",
        event_type: "sos",
        source: "esp32",
        occurred_at: new Date().toISOString(),
        severity_hint: "urgent",
        data_quality: "high",
        payload: { action: "long_press" },
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.risk_result.status_level, "urgent");
    assert.equal(body.task.status, "open");
  });
});

test("POST /api/events returns 409 for a reused event_id without crossing elder records", async () => {
  db.resetDemoData();

  await withServer(async (baseUrl) => {
    const postEvent = (elderId) =>
      fetch(`${baseUrl}/api/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event_id: "EVENT-ID-COLLISION",
          elder_id: elderId,
          event_type: "sos",
          source: "mock",
          occurred_at: new Date().toISOString(),
          payload: { action: "long_press" },
        }),
      });

    const first = await postEvent("E001");
    const duplicate = await postEvent("E004");
    const duplicateBody = await duplicate.json();
    const storedEvent = db
      .getDb()
      .prepare("SELECT elder_id, linked_task_id FROM events WHERE event_id = ?")
      .get("EVENT-ID-COLLISION");
    const crossElderTask = db
      .getDb()
      .prepare("SELECT task_id FROM tasks WHERE elder_id = 'E004' AND source_event_id = ?")
      .get("EVENT-ID-COLLISION");

    assert.equal(first.status, 201);
    assert.equal(duplicate.status, 409);
    assert.match(duplicateBody.error, /event_id/i);
    assert.equal(storedEvent.elder_id, "E001");
    assert.equal(crossElderTask, undefined);
  });
});

test("GET /api/dashboard includes seven recent dates and excludes team test data from operations", async () => {
  db.resetDemoData();

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/dashboard`);
    const body = await response.json();
    const testSubject = body.elders.find((entry) => entry.elder.elder_id === "TEST001");

    assert.equal(response.status, 200);
    assert.equal(testSubject.elder.subject_kind, "team_test");
    assert(Array.isArray(testSubject.recent_snapshots));
    assert.equal(body.operational_summary.elder_count, 4);
    assert.equal(body.operational_summary.included_subject_kind, "elder");
  });
});

test("resolving a caregiver task resolves every event linked to that task", async () => {
  db.resetDemoData();

  await withServer(async (baseUrl) => {
    const eventResponse = await fetch(`${baseUrl}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        elder_id: "E001",
        event_type: "voice_symptom",
        source: "demo",
        occurred_at: new Date().toISOString(),
        raw_text: "我有点头晕",
        payload: { symptom_keywords: ["头晕"] },
      }),
    });
    const eventBody = await eventResponse.json();
    const taskResponse = await fetch(`${baseUrl}/api/tasks/${eventBody.task.task_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "resolved", handled_by: "护工A" }),
    });
    const taskBody = await taskResponse.json();
    const dashboard = await (await fetch(`${baseUrl}/api/dashboard`)).json();
    const elder = dashboard.elders.find((entry) => entry.elder.elder_id === "E001");
    const savedEvent = elder.events.find(
      (event) => event.event_id === eventBody.event.event_id,
    );

    assert.equal(taskBody.task.status, "resolved");
    assert.equal(savedEvent.status, "resolved");
    assert.equal(elder.active_events.some((event) => event.event_id === savedEvent.event_id), false);
  });
});

test("caregiver lifecycle notes do not reopen a task after the care loop is resolved", async () => {
  db.resetDemoData();

  await withServer(async (baseUrl) => {
    const eventResponse = await fetch(`${baseUrl}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        elder_id: "E001",
        event_type: "sos",
        source: "mock",
        occurred_at: new Date().toISOString(),
        payload: { action: "long_press" },
      }),
    });
    const eventBody = await eventResponse.json();
    await fetch(`${baseUrl}/api/tasks/${eventBody.task.task_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "resolved", handled_by: "caregiver" }),
    });

    const noteResponse = await fetch(`${baseUrl}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        elder_id: "E001",
        event_type: "manual_note",
        source: "dashboard",
        occurred_at: new Date().toISOString(),
        raw_text: "Care loop completed.",
        payload: { action: "caregiver_completed", note: "Care loop completed." },
      }),
    });
    const noteBody = await noteResponse.json();
    const dashboard = await (await fetch(`${baseUrl}/api/dashboard`)).json();
    const elder = dashboard.elders.find((entry) => entry.elder.elder_id === "E001");

    assert.equal(noteResponse.status, 201);
    assert.equal(noteBody.task, null);
    assert.equal(
      elder.tasks.some((task) => !["resolved", "cancelled"].includes(task.status)),
      false,
    );
  });
});

test("urgent tasks cannot be cancelled and non-urgent cancellation closes linked events", async () => {
  db.resetDemoData();

  await withServer(async (baseUrl) => {
    const urgentEventResponse = await fetch(`${baseUrl}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        elder_id: "E001",
        event_type: "sos",
        source: "mock",
        occurred_at: new Date().toISOString(),
        payload: { action: "long_press" },
      }),
    });
    const urgentEvent = await urgentEventResponse.json();
    const urgentCancel = await fetch(`${baseUrl}/api/tasks/${urgentEvent.task.task_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    });
    const urgentTask = db
      .getDb()
      .prepare("SELECT status FROM tasks WHERE task_id = ?")
      .get(urgentEvent.task.task_id);

    assert.equal(urgentCancel.status, 409);
    assert.equal(urgentTask.status, "open");

    db.resetDemoData();
    const attentionEventResponse = await fetch(`${baseUrl}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        elder_id: "E001",
        event_type: "voice",
        source: "mock",
        occurred_at: new Date().toISOString(),
        raw_text: "我有点头晕",
        payload: { action: "symptom_report" },
      }),
    });
    const attentionEvent = await attentionEventResponse.json();
    const cancelResponse = await fetch(`${baseUrl}/api/tasks/${attentionEvent.task.task_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "cancelled", handled_by: "护工A" }),
    });
    const cancelledEvent = db
      .getDb()
      .prepare("SELECT status, resolved_by FROM events WHERE event_id = ?")
      .get(attentionEvent.event.event_id);

    assert.equal(cancelResponse.status, 200);
    assert.equal(cancelledEvent.status, "resolved");
    assert.equal(cancelledEvent.resolved_by, "护工A");
  });
});

test("local demo reset preserves TEST001 wearable snapshots", async () => {
  db.insertSnapshot({
    elder_id: "TEST001",
    date: "2026-07-11",
    data_source: "Apple Health Export",
    heart_rate_avg: 78,
    resting_heart_rate: 68,
    steps: 4321,
    active_minutes: 35,
    sleep_duration: 7.2,
    wear_time_hours: 20,
    data_quality: 92,
  });

  await withServer(async (baseUrl) => {
    const resetResponse = await fetch(`${baseUrl}/api/demo/reset`, { method: "POST" });
    const dashboard = await (await fetch(`${baseUrl}/api/dashboard`)).json();
    const testSubject = dashboard.elders.find(
      (entry) => entry.elder.elder_id === "TEST001",
    );

    assert.equal(resetResponse.status, 200);
    assert.equal(testSubject.latest_snapshot.steps, 4321);
  });
});

test("CSV preview is read-only and confirm imports idempotently with server metadata", async () => {
  db.resetDemoData();
  const csv = [
    "elder_id,date,data_source,heart_rate_avg,resting_heart_rate,steps,active_minutes,sleep_duration,wear_time_hours,data_quality",
    "WRONG,2026-07-09,Untrusted,82,,1200,24,6.1,17,85",
  ].join("\n");

  const postCsv = async (baseUrl, suffix) => {
    const form = new FormData();
    form.append("elder_id", "E001");
    form.append("source", "CSV Import");
    form.append("file", new Blob([csv], { type: "text/csv" }), "daily.csv");
    return fetch(`${baseUrl}/api/import/daily-snapshots-csv${suffix}`, {
      method: "POST",
      body: form,
    });
  };

  await withServer(async (baseUrl) => {
    const before = db.getRecentSnapshots("E001", 31).length;
    const previewResponse = await postCsv(baseUrl, "/preview");
    const preview = await previewResponse.json();

    assert.equal(previewResponse.status, 200);
    assert.equal(preview.count, 1);
    assert.equal(preview.snapshots[0].elder_id, "E001");
    assert.equal(preview.snapshots[0].data_source, "CSV Import");
    assert.equal(preview.snapshots[0].resting_heart_rate, null);
    assert.equal(db.getRecentSnapshots("E001", 31).length, before);

    const firstResponse = await postCsv(baseUrl, "");
    const first = await firstResponse.json();
    const secondResponse = await postCsv(baseUrl, "");
    const second = await secondResponse.json();

    assert.equal(firstResponse.status, 201);
    assert.match(first.import_id, /^[0-9a-f-]{36}$/);
    assert.equal(first.preview.quality_summary.average, 85);
    assert.deepEqual(first.date_range, first.preview.date_range);
    assert.deepEqual(first.quality_summary, first.preview.quality_summary);
    assert.deepEqual(first.warnings, first.preview.warnings);
    assert.equal(second.count, 1);
    assert.equal(
      db.getRecentSnapshots("E001", 31).filter((row) => row.date === "2026-07-09").length,
      1,
    );

    const history = await (
      await fetch(`${baseUrl}/api/import/daily-snapshots-csv/history?elder_id=E001`)
    ).json();
    assert.equal(history.imports.length, 2);
  });
});

test("Agent analysis accepts only an elder reference and rebuilds rule-owned context", async () => {
  db.resetDemoData();

  await withServer(async (baseUrl) => {
    const forgedResponse = await fetch(`${baseUrl}/api/agent/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        elder_id: "E001",
        risk_result: { status_level: "stable", risk_score: 0 },
      }),
    });
    assert.equal(forgedResponse.status, 400);

    const eventResponse = await fetch(`${baseUrl}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        elder_id: "E001",
        event_type: "sos",
        source: "esp32",
        occurred_at: new Date().toISOString(),
        payload: { action: "long_press", precise_location: "should-not-reach-agent" },
      }),
    });
    const eventBody = await eventResponse.json();

    const response = await fetch(`${baseUrl}/api/agent/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        elder_id: "E001",
        source_event_id: eventBody.event.event_id,
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.agent_result.status_level, "urgent");
    assert.equal(body.meta.provider, "mock");
    assert.equal(body.meta.validation_status, "valid");
    assert.equal(body.elder_id, "E001");
    assert.equal(body.source_event_id, eventBody.event.event_id);

    const run = db.getDb().prepare("SELECT * FROM agent_runs ORDER BY created_at DESC LIMIT 1").get();
    assert.equal(run.elder_id, "E001");
    assert.equal(run.validation_status, "valid");
    assert.equal(run.input_summary.includes("precise_location"), false);

    const dashboard = await (await fetch(`${baseUrl}/api/dashboard`)).json();
    const dashboardRun = dashboard.elders.find(
      (entry) => entry.elder.elder_id === "E001",
    ).latest_agent_run;
    assert.equal(dashboardRun.provider, "mock");
    assert.equal("input_summary" in dashboardRun, false);
    assert.equal("raw_response_excerpt" in dashboardRun, false);
    assert.equal("error_reason" in dashboardRun, false);
  });
});

test("TEST001 uses Mock unless real team-test Agent access is explicitly enabled", async () => {
  db.resetDemoData();
  const previous = {
    provider: process.env.AGENT_PROVIDER,
    allow: process.env.ALLOW_TEAM_TEST_REAL_AGENT,
    baseUrl: process.env.QWENPAW_BASE_URL,
    timeout: process.env.QWENPAW_TIMEOUT_MS,
  };
  process.env.AGENT_PROVIDER = "qwenpaw";
  process.env.ALLOW_TEAM_TEST_REAL_AGENT = "false";
  process.env.QWENPAW_BASE_URL = "http://127.0.0.1:1";
  process.env.QWENPAW_TIMEOUT_MS = "20";

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/agent/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ elder_id: "TEST001" }),
      });
      const body = await response.json();

      assert.equal(response.status, 201);
      assert.equal(body.meta.provider, "mock");
      assert.equal(body.meta.requested_provider, "qwenpaw");
      assert.equal(body.meta.policy_forced_mock, true);
      assert.equal(body.meta.fallback_used, false);

      const dashboard = await (await fetch(`${baseUrl}/api/dashboard`)).json();
      const testRun = dashboard.elders.find(
        (entry) => entry.elder.elder_id === "TEST001",
      ).latest_agent_run;
      assert.equal(testRun.provider, "mock");
    });
  } finally {
    restoreEnv("AGENT_PROVIDER", previous.provider);
    restoreEnv("ALLOW_TEAM_TEST_REAL_AGENT", previous.allow);
    restoreEnv("QWENPAW_BASE_URL", previous.baseUrl);
    restoreEnv("QWENPAW_TIMEOUT_MS", previous.timeout);
  }
});

test("failed Agent runs are audited as failed instead of completed", () => {
  db.resetDemoData();
  const run = db.insertAgentRun({
    elder_id: "E001",
    provider: "qwenpaw",
    validation_status: "failed",
    fallback_used: false,
    error_reason: "synthetic failure",
  });
  const audit = db
    .getDb()
    .prepare("SELECT action FROM audit_logs WHERE target_type = 'agent_run' AND target_id = ?")
    .get(run.run_id);

  assert.equal(audit.action, "agent.failed");
});

test("POST /api/events ignores forged risk results and excludes stale events", async () => {
  db.resetDemoData();

  await withServer(async (baseUrl) => {
    const forgedResponse = await fetch(`${baseUrl}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        elder_id: "E004",
        event_type: "manual_note",
        source: "dashboard",
        occurred_at: new Date().toISOString(),
        payload: { action: "routine_note" },
        risk_result: { status_level: "urgent", risk_score: 100 },
      }),
    });
    const forgedBody = await forgedResponse.json();

    const staleResponse = await fetch(`${baseUrl}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        elder_id: "E004",
        event_type: "sos",
        source: "mock",
        occurred_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        payload: { action: "long_press" },
      }),
    });
    const staleBody = await staleResponse.json();

    assert.equal(forgedBody.risk_result.status_level, "stable");
    assert.equal(forgedBody.task, null);
    assert.equal(staleBody.risk_result.status_level, "stable");
    assert.equal(staleBody.task, null);
  });
});
