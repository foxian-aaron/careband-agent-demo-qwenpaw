import assert from "node:assert/strict";

process.env.DATABASE_PATH = ":memory:";
process.env.AGENT_PROVIDER = "mock";
process.env.NODE_ENV = "test";
process.env.ALLOW_DEMO_RESET = "true";

const { createApp } = await import("../src/server.js");

const server = createApp().listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

const request = async (path, init = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: init.body ? { "content-type": "application/json", ...(init.headers ?? {}) } : init.headers,
  });
  const body = await response.json();
  assert.equal(response.ok, true, `${init.method ?? "GET"} ${path}: ${JSON.stringify(body)}`);
  return body;
};

const postJson = (path, body) =>
  request(path, { method: "POST", body: JSON.stringify(body) });

const waitForAgentOutput = async (elderId, sourceEventId) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const dashboard = await request("/api/dashboard");
    const elder = dashboard.elders.find((entry) => entry.elder.elder_id === elderId);
    if (elder?.latest_agent_output?.source_event_id === sourceEventId) return elder;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for Agent output for ${sourceEventId}`);
};

const demoCsv = [
  "elder_id,date,data_source,heart_rate_avg,resting_heart_rate,steps,active_minutes,sleep_duration,wear_time_hours,data_quality",
  "E001,2026-07-01,CSV Import,74,67,2280,44,6.8,19,85",
  "E001,2026-07-02,CSV Import,75,67,2110,40,6.4,18,85",
  "E001,2026-07-03,CSV Import,73,66,2360,46,6.7,19,85",
  "E001,2026-07-04,CSV Import,77,68,1980,35,6.3,17,85",
  "E001,2026-07-05,CSV Import,79,69,1620,30,5.7,16,85",
  "E001,2026-07-06,CSV Import,82,70,1140,24,5.1,15,85",
  "E001,2026-07-07,CSV Import,86,72,820,18,4.8,15,85",
].join("\n");

const importDemoCsv = async () => {
  const form = new FormData();
  form.append("elder_id", "E001");
  form.append("source", "CSV Import");
  form.append("file", new Blob([demoCsv], { type: "text/csv" }), "e001-demo.csv");
  const response = await fetch(`${baseUrl}/api/import/daily-snapshots-csv`, {
    method: "POST",
    body: form,
  });
  const body = await response.json();
  assert.equal(response.ok, true, `CSV import failed: ${JSON.stringify(body)}`);
  assert.equal(body.count, 7);
  assert.equal(body.quality_summary.average, 85);
  return body;
};

const results = [];

try {
  for (let run = 1; run <= 3; run += 1) {
    const startedAt = Date.now();
    await request("/api/demo/reset", { method: "POST" });
    await importDemoCsv();
    await importDemoCsv();
    const importedDashboard = await request("/api/dashboard");
    const importedElder = importedDashboard.elders.find(
      (entry) => entry.elder.elder_id === "E001",
    );
    assert.equal(
      importedElder.recent_snapshots.filter((snapshot) => snapshot.date === "2026-07-07").length,
      1,
    );

    const riskEvent = await postJson("/api/events", {
      elder_id: "E001",
      event_type: "sos",
      source: "esp32",
      occurred_at: new Date().toISOString(),
      raw_text: "CareBand SOS request",
      payload: { action: "long_press", button_press_seconds: 3 },
    });

    assert.equal(riskEvent.risk_result.status_level, "urgent");
    assert.ok(riskEvent.task?.task_id);
    assert.equal(riskEvent.agent_dispatch.status, "queued");

    const hardwareAgentElder = await waitForAgentOutput("E001", riskEvent.event.event_id);
    assert.equal(hardwareAgentElder.latest_agent_output.status_level, "urgent");
    assert.equal(hardwareAgentElder.latest_agent_run.provider, "mock");
    assert.equal(hardwareAgentElder.latest_agent_run.validation_status, "valid");

    for (const status of ["acknowledged", "in_progress"]) {
      await request(`/api/tasks/${riskEvent.task.task_id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, handled_by: "demo-caregiver" }),
      });
    }
    await postJson("/api/events", {
      elder_id: "E001",
      event_type: "medication",
      source: "dashboard",
      occurred_at: new Date().toISOString(),
      raw_text: "Evening medication confirmed by caregiver",
      payload: { action: "confirmed", medication_confirmed: true },
    });
    const resolved = await request(`/api/tasks/${riskEvent.task.task_id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "resolved",
        handled_by: "demo-caregiver",
        handled_note: "On-site check completed for the synthetic demo persona.",
      }),
    });
    assert.equal(resolved.task.status, "resolved");

    const staleDashboard = await request("/api/dashboard");
    const staleElder = staleDashboard.elders.find(
      (entry) => entry.elder.elder_id === "E001",
    );
    assert.equal(staleElder.latest_agent_output, null);
    assert.equal(staleElder.latest_agent_output_stale, true);

    const completionEvent = await postJson("/api/events", {
      elder_id: "E001",
      event_type: "manual_note",
      source: "dashboard",
      occurred_at: new Date().toISOString(),
      raw_text: "Synthetic caregiver follow-up completed.",
      payload: { action: "caregiver_completed", note: "Synthetic follow-up completed." },
    });
    const finalAgent = await postJson("/api/agent/analyze", {
      elder_id: "E001",
      source_event_id: completionEvent.event.event_id,
    });
    assert.equal(finalAgent.meta.provider, "mock");
    assert.equal(finalAgent.meta.validation_status, "valid");

    const dashboard = await request("/api/dashboard");
    const elder = dashboard.elders.find((entry) => entry.elder.elder_id === "E001");
    assert.ok(elder);
    assert.equal(elder.active_events.some((event) => event.event_id === riskEvent.event.event_id), false);
    assert.equal(["urgent", "high_risk"].includes(elder.risk_result.status_level), false);
    assert.equal(elder.latest_agent_output.output_id, finalAgent.output_id);

    results.push({
      run,
      duration_ms: Date.now() - startedAt,
      initial_risk: riskEvent.risk_result.status_level,
      final_risk: elder.risk_result.status_level,
      task_status: resolved.task.status,
      agent_provider: finalAgent.meta.provider,
      validation_status: finalAgent.meta.validation_status,
      csv_quality: 85,
      csv_idempotent: true,
    });
  }

  console.log(JSON.stringify({ ok: true, runs: results }, null, 2));
} finally {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
