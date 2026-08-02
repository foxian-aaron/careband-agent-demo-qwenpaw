import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { analyzeAgent } from "../backend/src/agent/agentService.js";
import { createApp } from "../backend/src/app.js";
import { closeDb, getDb, openDatabase } from "../backend/src/db.js";

const DISCLAIMER = "本结果仅为照护风险提示，不构成医疗诊断。";
const RUN_ID = "RUN-20260802-CB-STAGE16-THREE-RUNS-001";
const EVIDENCE_OUTPUT = `docs/rebuild/EVIDENCE/${RUN_ID}/three-runs.json`;
const EXPECTED_LEVELS = new Set([
  "data_insufficient",
  "stable",
  "observation",
  "attention",
  "high_risk",
  "urgent",
]);

const requireCondition = (condition, message) => {
  if (!condition) throw new Error(`THREE_RUN_GATE_FAILED: ${message}`);
};

const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
requireCondition(
  nodeMajor === 22 && nodeMinor >= 12,
  `Node 22 required; received ${process.version}`,
);

const csvText = [
  "elder_id,date,data_source,heart_rate_avg,resting_heart_rate,steps,active_minutes,sleep_duration,wear_time_hours,data_quality",
  "TEST001,2026-08-01,CSV,72,64,4100,52,7.2,19.0,93",
  "TEST001,2026-08-02,CSV,74,65,3950,48,7.0,18.5,92",
].join("\n");

const server = createApp().listen(0, "127.0.0.1");
await new Promise((resolveReady, reject) => {
  server.once("listening", resolveReady);
  server.once("error", reject);
});
const address = server.address();
requireCondition(address && typeof address === "object", "ephemeral server did not expose a port");
const baseUrl = `http://127.0.0.1:${address.port}`;

const requestJson = async (path, options = {}, expectedStatus = 200) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
  });
  requireCondition(
    response.status === expectedStatus,
    `${options.method ?? "GET"} ${path} returned ${response.status}; expected ${expectedStatus}`,
  );
  requireCondition(
    (response.headers.get("content-type") ?? "").toLowerCase().includes("application/json"),
    `${path} did not return JSON`,
  );
  const body = await response.json();
  requireCondition(body?.ok === true, `${path} returned ok != true`);
  return body;
};

const post = (path, body, expectedStatus = 200) => requestJson(
  path,
  { method: "POST", body: JSON.stringify(body) },
  expectedStatus,
);
const patch = (path, body) => requestJson(
  path,
  { method: "PATCH", body: JSON.stringify(body) },
  200,
);

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const assertLockedRisk = (agent, risk, label) => {
  for (const field of ["status_level", "risk_score", "key_reasons", "recommended_action"]) {
    requireCondition(same(agent[field], risk[field]), `${label}: Agent changed ${field}`);
  }
  requireCondition(agent.safety_disclaimer === DISCLAIMER, `${label}: disclaimer mismatch`);
};

const explicitMockSummary = async (riskResult, activeEvents) => {
  const result = await analyzeAgent(
    {
      daily_snapshot: null,
      personal_baseline: {},
      active_events: activeEvents,
      risk_result: riskResult,
    },
    { provider: "mock" },
  );
  requireCondition(result.meta.requested_provider === "mock", "Agent request was not explicit mock");
  requireCondition(result.meta.actual_provider === "mock", "Agent actual provider was not mock");
  requireCondition(result.meta.fallback_used === false, "explicit mock was mislabeled as fallback");
  requireCondition(result.meta.validation_status === "valid", "mock Agent output was not valid");
  return result;
};

const persistAgentEvidence = (elderId, result, now) => {
  const db = getDb();
  db.prepare("INSERT INTO agent_outputs (elder_id, payload, created_at) VALUES (?, ?, ?)")
    .run(elderId, JSON.stringify(result.agent_result), now);
  db.prepare("INSERT INTO agent_runs (elder_id, payload, created_at) VALUES (?, ?, ?)")
    .run(elderId, JSON.stringify({ ...result.meta, evidence_mode: "validation_harness" }), now);
};

const rowsFor = (dashboard, elderId) => {
  const row = dashboard.rows?.find((entry) => entry.elder?.elder_id === elderId);
  requireCondition(row, `dashboard missing ${elderId}`);
  return row;
};

const runResults = [];
try {
  for (let run = 1; run <= 3; run += 1) {
    const started = Date.now();
    openDatabase(":memory:");
    const now = new Date().toISOString();

    const health = await requestJson("/api/health");
    requireCondition(health.mode === "local", `run ${run}: health mode was not local`);

    const importBody = {
      elder_id: "TEST001",
      csv_text: csvText,
      file_name: "stage16-daily-snapshots.csv",
    };
    const preview = await post("/api/import/daily-snapshots-csv/preview", importBody);
    requireCondition(preview.count === 2, `run ${run}: preview count mismatch`);
    const imported = await post("/api/import/daily-snapshots-csv", importBody, 201);
    requireCondition(imported.imported === 2, `run ${run}: import count mismatch`);
    await post("/api/import/daily-snapshots-csv", importBody, 201);
    requireCondition(
      getDb().prepare("SELECT COUNT(*) AS count FROM snapshots WHERE elder_id = 'TEST001'").get().count === 2,
      `run ${run}: idempotent import duplicated snapshot dates`,
    );
    const history = await requestJson("/api/import/daily-snapshots-csv/history?elder_id=TEST001&limit=20");
    requireCondition(history.runs.length === 2, `run ${run}: import history mismatch`);

    const sos = await post(
      "/api/events",
      { elder_id: "E001", event_type: "sos", source: "software_simulator", occurred_at: now, payload: {} },
      201,
    );
    requireCondition(sos.event.source === "software_simulator", `run ${run}: source mismatch`);
    requireCondition(sos.risk_result.status_level === "urgent", `run ${run}: SOS was not urgent`);
    requireCondition(sos.task?.status === "open", `run ${run}: open task missing`);

    const before = await explicitMockSummary(sos.risk_result, [sos.event]);
    assertLockedRisk(before.agent_result, sos.risk_result, `run ${run} before resolution`);
    persistAgentEvidence("E001", before, now);

    const firstDashboard = await requestJson("/api/dashboard");
    const firstElder = rowsFor(firstDashboard, "E001");
    requireCondition(firstElder.latest_agent_output?.family_summary, `run ${run}: family summary missing`);
    requireCondition(firstElder.latest_agent_output?.institution_summary, `run ${run}: institution summary missing`);

    const taskId = sos.task.task_id;
    for (const status of ["acknowledged", "in_progress", "resolved"]) {
      const transition = await patch(`/api/tasks/${taskId}`, { status });
      requireCondition(transition.task.status === status, `run ${run}: task did not reach ${status}`);
    }

    const resolvedDashboard = await requestJson("/api/dashboard");
    const resolvedElder = rowsFor(resolvedDashboard, "E001");
    requireCondition(resolvedElder.active_events.length === 0, `run ${run}: resolved SOS remained active`);
    requireCondition(
      resolvedElder.tasks.find((task) => task.task_id === taskId)?.status === "resolved",
      `run ${run}: resolved task missing from dashboard`,
    );
    requireCondition(EXPECTED_LEVELS.has(resolvedElder.risk_result.status_level), `run ${run}: invalid final risk`);
    requireCondition(resolvedElder.risk_result.status_level !== "urgent", `run ${run}: final risk remained urgent`);

    const after = await explicitMockSummary(resolvedElder.risk_result, []);
    assertLockedRisk(after.agent_result, resolvedElder.risk_result, `run ${run} after resolution`);
    persistAgentEvidence("E001", after, now);
    const finalElder = rowsFor(await requestJson("/api/dashboard"), "E001");
    requireCondition(finalElder.latest_agent_output?.elder_id === "E001", `run ${run}: Agent elder mismatch`);
    requireCondition(
      Number.isInteger(finalElder.latest_agent_output?.agent_output_id),
      `run ${run}: Agent output id missing`,
    );
    for (const [field, value] of Object.entries(after.agent_result)) {
      requireCondition(
        same(finalElder.latest_agent_output[field], value),
        `run ${run}: Agent field ${field} did not round-trip through dashboard`,
      );
    }
    requireCondition(finalElder.latest_agent_run?.actual_provider === "mock", `run ${run}: provider evidence missing`);
    requireCondition(finalElder.latest_agent_run?.fallback_used === false, `run ${run}: mock mislabeled fallback`);

    runResults.push({
      run,
      duration_ms: Date.now() - started,
      csv: { previewed: preview.count, imported: imported.imported, persisted_dates: 2, history_runs: 2 },
      sos: { source: sos.event.source, status_level: sos.risk_result.status_level, task_created: true },
      agent: {
        requested_provider: before.meta.requested_provider,
        actual_provider: before.meta.actual_provider,
        fallback_used: before.meta.fallback_used,
        validation_status: before.meta.validation_status,
        real_qwenpaw_called: false,
      },
      closeout: {
        task_status: "resolved",
        active_events: 0,
        status_level: finalElder.risk_result.status_level,
        family_summary_present: true,
        institution_summary_present: true,
      },
    });
  }
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  closeDb();
}

const evidence = {
  schema_version: 1,
  run_id: RUN_ID,
  generated_at: new Date().toISOString(),
  node: process.version,
  mode: "deterministic_validation_harness",
  real_qwenpaw_runtime_called: false,
  runs: runResults,
  summary: {
    expected_runs: 3,
    passed_runs: runResults.length,
    all_passed: runResults.length === 3,
    agent_evidence: "explicit_mock_not_fallback",
  },
};
requireCondition(evidence.summary.all_passed, "did not complete three runs");

const outputIndex = process.argv.indexOf("--output");
if (outputIndex >= 0) {
  const requested = process.argv[outputIndex + 1];
  requireCondition(requested === EVIDENCE_OUTPUT, "invalid evidence output");
  requireCondition(!isAbsolute(requested), "evidence output must be repository-relative");
  const evidenceRoot = resolve("docs/rebuild/EVIDENCE");
  const target = resolve(requested);
  const targetDirectory = dirname(target);
  const targetRelative = relative(evidenceRoot, target);
  requireCondition(
    targetRelative !== "" && !targetRelative.startsWith(`..${sep}`) && targetRelative !== "..",
    "evidence output escaped docs/rebuild/EVIDENCE",
  );
  mkdirSync(targetDirectory, { recursive: true });
  for (const directory of [evidenceRoot, targetDirectory]) {
    const stat = lstatSync(directory);
    requireCondition(stat.isDirectory() && !stat.isSymbolicLink(), "evidence directory is not a real directory");
  }
  const realEvidenceRoot = realpathSync(evidenceRoot);
  const realTargetDirectory = realpathSync(targetDirectory);
  const realTargetRelative = relative(realEvidenceRoot, realTargetDirectory);
  requireCondition(
    realTargetRelative === "" || (!realTargetRelative.startsWith(`..${sep}`) && realTargetRelative !== ".."),
    "real evidence output escaped docs/rebuild/EVIDENCE",
  );
  const temporary = `${target}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    renameSync(temporary, target);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

process.stdout.write(`${JSON.stringify(evidence)}\n`);
