import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { createApp } from "../src/app.js";
import { closeDb, getDb, openDatabase } from "../src/db.js";

const DISCLAIMER = "本结果仅为照护风险提示，不构成医疗诊断。";
let tmpRoot;
let seq = 0;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "careband-stage18-agent-"));
});

after(() => {
  closeDb();
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

const startServer = (agentOptions) => new Promise((resolve, reject) => {
  openDatabase(join(tmpRoot, `agent-${process.pid}-${Date.now()}-${seq++}.sqlite`));
  const server = createApp({ agentOptions }).listen(0, "127.0.0.1", () => {
    resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
  });
  server.on("error", reject);
});

const stopServer = (server) => new Promise((resolve) => server.close(resolve));

const withServer = async (agentOptions, run) => {
  const context = await startServer(agentOptions);
  try {
    return await run(context);
  } finally {
    await stopServer(context.server);
  }
};

const postJson = (baseUrl, body) => fetch(`${baseUrl}/api/agent/analyze`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify(body),
});

const strictOutput = (risk) => ({
  status_level: risk.status_level,
  risk_score: risk.risk_score,
  key_reasons: [...risk.key_reasons],
  recommended_action: risk.recommended_action,
  caregiver_summary: "请护工按规则动作核实当前情况。",
  family_summary: "照护团队正在按规则结果核实情况。",
  institution_summary: "请机构按规则结果安排照护跟进。",
  safety_disclaimer: DISCLAIMER,
});

const qwenTrace = (responseText, chatId) => ({
  requested_provider: "qwenpaw",
  actual_provider: "qwenpaw",
  provider: "zhipu-cn-codingplan",
  model: "glm-5.2",
  chatId,
  sessionId: `careband-runtime:${chatId}`,
  responseText,
  fallback_used: false,
});

test("POST /api/agent/analyze builds server input, persists strict Mock output and safe run trace", () =>
  withServer({ provider: "mock" }, async ({ baseUrl }) => {
    const response = await postJson(baseUrl, { elder_id: "E001" });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
    assert.equal(body.elder_id, "E001");
    assert.equal(body.source_event_id, null);
    assert.equal(body.agent_result.safety_disclaimer, DISCLAIMER);
    assert.deepEqual(
      Object.fromEntries(["status_level", "risk_score", "key_reasons", "recommended_action"]
        .map((key) => [key, body.agent_result[key]])),
      Object.fromEntries(["status_level", "risk_score", "key_reasons", "recommended_action"]
        .map((key) => [key, body.risk_result[key]])),
    );
    assert.equal(body.meta.requested_provider, "mock");
    assert.equal(body.meta.actual_provider, "mock");
    assert.equal(body.meta.fallback_used, false);
    assert.equal(body.meta.validation_status, "valid");
    assert.equal("input" in body, false);
    assert.equal("raw_response" in body, false);

    const db = getDb();
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM agent_outputs").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM agent_runs").get().count, 1);

    const dashboard = await fetch(`${baseUrl}/api/elders/E001/dashboard`).then((result) => result.json());
    assert.equal(dashboard.latest_agent_output.caregiver_summary, body.agent_result.caregiver_summary);
    assert.equal(dashboard.latest_agent_run.actual_provider, "mock");
    assert.equal(dashboard.latest_agent_run.fallback_used, false);
  }));

test("public QwenPaw path receives only server-built allowlisted context and persists provider trace", () => {
  const tasks = [];
  return withServer({
    providerOptions: { runId: "stage18-api" },
    runners: {
      qwenpaw: async (task) => {
        tasks.push(task);
        return qwenTrace(JSON.stringify(strictOutput(task.risk_result)), "chat-stage18");
      },
    },
  }, async ({ baseUrl }) => {
    const response = await postJson(baseUrl, { elder_id: "E001" });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(tasks.length, 1);
    assert.deepEqual(Object.keys(tasks[0]).sort(), [
      "active_events", "daily_snapshot", "personal_baseline", "risk_result",
    ]);
    assert.doesNotMatch(JSON.stringify(tasks[0]), /raw_text|transcript|latitude|longitude|coordinates/i);
    assert.equal(body.meta.actual_provider, "qwenpaw");
    assert.equal(body.meta.provider, "zhipu-cn-codingplan");
    assert.equal(body.meta.model, "glm-5.2");
    assert.deepEqual(body.meta.provider_request_ids, ["chat-stage18"]);
    assert.deepEqual(body.agent_result, strictOutput(body.risk_result));
  });
});

test("two invalid QwenPaw responses persist one explicit validated Mock fallback", () => {
  let calls = 0;
  return withServer({
    runners: {
      qwenpaw: async () => {
        calls += 1;
        return qwenTrace("{}", `chat-invalid-${calls}`);
      },
    },
  }, async ({ baseUrl }) => {
    const response = await postJson(baseUrl, { elder_id: "E001" });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(calls, 2);
    assert.equal(body.meta.requested_provider, "qwenpaw");
    assert.equal(body.meta.actual_provider, "mock");
    assert.equal(body.meta.fallback_used, true);
    assert.equal(body.meta.validation_status, "fallback_valid");
    assert.equal(body.meta.failure_reason, "QWENPAW_OUTPUT_INVALID");
    assert.match(body.agent_result.caregiver_summary, /Mock fallback/);
    assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM agent_outputs").get().count, 1);
    assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM agent_runs").get().count, 1);
  });
});

test("forged fields, unknown elders and invalid source events fail closed without Agent persistence", () =>
  withServer({ provider: "mock" }, async ({ baseUrl }) => {
    const db = getDb();
    const otherEvent = db.prepare(
      "INSERT INTO events (elder_id, payload, created_at) VALUES (?, ?, ?)",
    ).run("E002", JSON.stringify({ event_type: "manual_note", status: "active" }), new Date().toISOString());

    const cases = [
      [{ elder_id: "E001", risk_score: 100 }, 400],
      [{ elder_id: "E001", provider: "mock" }, 400],
      [{ elder_id: " E001 " }, 400],
      [{ elder_id: "E999" }, 404],
      [{ elder_id: "E001", source_event_id: 0 }, 400],
      [{ elder_id: "E001", source_event_id: Number(otherEvent.lastInsertRowid) }, 404],
    ];
    for (const [request, expectedStatus] of cases) {
      const response = await postJson(baseUrl, request);
      const body = await response.json();
      assert.equal(response.status, expectedStatus);
      assert.equal(body.ok, false);
      assert.deepEqual(Object.keys(body).sort(), ["error", "ok"]);
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM agent_outputs").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM agent_runs").get().count, 0);
  }));

test("owned source_event_id is persisted as safe run linkage without altering strict output", () =>
  withServer({ provider: "mock" }, async ({ baseUrl }) => {
    const db = getDb();
    const event = db.prepare(
      "INSERT INTO events (elder_id, payload, created_at) VALUES (?, ?, ?)",
    ).run("E001", JSON.stringify({ event_type: "manual_note", status: "active" }), new Date().toISOString());
    const sourceEventId = Number(event.lastInsertRowid);

    const response = await postJson(baseUrl, { elder_id: "E001", source_event_id: sourceEventId });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.source_event_id, sourceEventId);
    const output = JSON.parse(db.prepare("SELECT payload FROM agent_outputs").get().payload);
    const run = JSON.parse(db.prepare("SELECT payload FROM agent_runs").get().payload);
    assert.deepEqual(Object.keys(output).sort(), [
      "caregiver_summary", "family_summary", "institution_summary", "key_reasons",
      "recommended_action", "risk_score", "safety_disclaimer", "status_level",
    ]);
    assert.equal(run.source_event_id, sourceEventId);
  }));
