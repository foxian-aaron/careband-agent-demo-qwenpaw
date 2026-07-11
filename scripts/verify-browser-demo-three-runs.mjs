const targetUrl = process.env.CAREBAND_DEMO_URL ?? "http://127.0.0.1:5173";
const apiUrl = process.env.CAREBAND_API_URL ?? "http://127.0.0.1:3001";
const browserPath =
  process.env.CAREBAND_BROWSER_PATH ??
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const firstAgentResponseDelayMs = Math.max(
  0,
  Number(process.env.CAREBAND_TEST_FIRST_AGENT_RESPONSE_DELAY_MS ?? 0) || 0,
);
const csvFilename = "E001-browser-gate.csv";
const expectedLatestCsvSnapshot = {
  date: "2026-07-10",
  data_source: "CSV Import",
  data_quality: 91,
};
const csvPayload = [
  "elder_id,date,data_source,heart_rate_avg,resting_heart_rate,steps,active_minutes,sleep_duration,wear_time_hours,data_quality",
  "E001,2026-07-04,CSV,74,66,2300,44,6.8,18.0,84",
  "E001,2026-07-05,CSV,75,67,2200,42,6.6,18.2,86",
  "E001,2026-07-06,CSV,76,67,2050,39,6.4,17.8,87",
  "E001,2026-07-07,CSV,78,68,1880,35,6.1,17.3,89",
  "E001,2026-07-08,CSV,80,69,1620,30,5.9,16.8,88",
  "E001,2026-07-09,CSV,82,70,1380,25,5.6,16.2,90",
  "E001,2026-07-10,CSV,85,72,980,18,5.2,15.6,91",
].join("\n");

const { chromium } = await import("playwright-core");
const { validateAgentOutput } = await import("../backend/src/agent/agentOutputValidator.js");
const browser = await chromium.launch({ headless: true, executablePath: browserPath });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const browserErrors = [];

const requireCondition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const fetchDashboard = async () => {
  const response = await fetch(`${apiUrl}/api/dashboard`);
  requireCondition(response.ok, `GET /api/dashboard returned ${response.status}`);
  return response.json();
};

const findE001 = (dashboard, run) => {
  const row = dashboard.elders?.find((entry) => entry.elder?.elder_id === "E001");
  requireCondition(row, `Run ${run}: dashboard did not contain E001`);
  return row;
};

const distinctSnapshotDates = (row) =>
  new Set((row.recent_snapshots ?? []).map((snapshot) => snapshot.date));

const persistedAgentResult = (output) => ({
  status_level: output.status_level,
  risk_score: output.risk_score,
  key_reasons: output.key_reasons,
  recommended_action: output.recommended_action,
  caregiver_summary: output.caregiver_summary,
  family_summary: output.family_summary,
  institution_summary: output.institution_summary,
  safety_disclaimer: output.safety_disclaimer,
});

if (firstAgentResponseDelayMs > 0) {
  let firstAgentResponsePending = true;
  await page.route(`${apiUrl}/api/agent/analyze`, async (route) => {
    if (!firstAgentResponsePending) {
      await route.continue();
      return;
    }
    firstAgentResponsePending = false;
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, firstAgentResponseDelayMs));
    await route.fulfill({ response });
  });
}

page.on("console", (message) => {
  if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));

const expectResponse = (predicate, timeout = 20_000) =>
  page.waitForResponse(predicate, { timeout });
const requestBody = (request) => {
  try {
    return request.postDataJSON();
  } catch {
    return null;
  }
};
const eventPost = (eventType, action) =>
  expectResponse(
    (response) => {
      const body = requestBody(response.request());
      return (
        response.url().endsWith("/api/events") &&
        response.request().method() === "POST" &&
        body?.event_type === eventType &&
        (!action || body?.payload?.action === action)
      );
    },
  );
const taskPatch = (taskId, status) =>
  expectResponse(
    (response) =>
      response.url().endsWith(`/api/tasks/${taskId}`) &&
      response.request().method() === "PATCH" &&
      requestBody(response.request())?.status === status,
  );
const agentAnalyze = (elderId) =>
  expectResponse(
    (response) => {
      const body = requestBody(response.request());
      return (
        response.url().endsWith("/api/agent/analyze") &&
        response.request().method() === "POST" &&
        body?.elder_id === elderId &&
        typeof body?.source_event_id === "string"
      );
    },
    90_000,
  );
const csvPreview = () =>
  expectResponse(
    (response) =>
      response.url().endsWith("/api/import/daily-snapshots-csv/preview") &&
      response.request().method() === "POST",
  );
const csvConfirm = () =>
  expectResponse(
    (response) =>
      response.url().endsWith("/api/import/daily-snapshots-csv") &&
      response.request().method() === "POST",
  );
const csvHistory = () =>
  expectResponse(
    (response) =>
      response.url().includes("/api/import/daily-snapshots-csv/history") &&
      response.request().method() === "GET",
  );

const clickAndRequireResponses = async (locator, expectations) => {
  // The previous action may still be finishing Agent fallback + dashboard refresh.
  // Do not start the response timeout until this action is actually clickable.
  await locator.click({ trial: true, timeout: 60_000 });
  const results = await Promise.all([
    ...expectations.map(({ responseFactory }) => responseFactory()),
    locator.click({ timeout: 10_000 }),
  ]);
  const responses = results.slice(0, expectations.length);
  responses.forEach((response, index) => {
    const expectedStatus = expectations[index].expectedStatus;
    if (response.status() !== expectedStatus) {
      throw new Error(
        `${response.request().method()} ${response.url()} returned ${response.status()}; expected ${expectedStatus}`,
      );
    }
  });
  return responses;
};

const clickAndRequireStatus = async (locator, responseFactory, expectedStatus) =>
  (
    await clickAndRequireResponses(locator, [{ responseFactory, expectedStatus }])
  )[0];

const assertAgentPanel = async (panel, expectedSummary, expectedOutputId, expectedRun, run, role) => {
  await panel.getByText(expectedSummary, { exact: true }).waitFor({ timeout: 30_000 });
  const metadata = panel.locator('[aria-label="Agent output metadata"]');
  await metadata.waitFor();
  requireCondition(
    (await metadata.getAttribute("data-agent-output-id")) === expectedOutputId,
    `Run ${run}: ${role} page did not render Agent output ${expectedOutputId}`,
  );
  requireCondition(
    (await metadata.getAttribute("data-agent-source")) === "mock",
    `Run ${run}: ${role} page did not identify the output as mock`,
  );
  requireCondition(
    (await metadata.getAttribute("data-agent-validation")) === expectedRun.validation_status,
    `Run ${run}: ${role} page validation metadata was stale`,
  );
  await metadata.getByText("Mock fallback", { exact: true }).waitFor();
  await metadata
    .getByText(`JSON：${expectedRun.validation_status}`, { exact: true })
    .waitFor();
};

const assertCsvSnapshotInDashboard = async (run, phase) => {
  await page
    .getByText(`数据来源：${expectedLatestCsvSnapshot.data_source}`, { exact: true })
    .waitFor();
  await page
    .getByText(`数据质量 ${expectedLatestCsvSnapshot.data_quality}%`, { exact: true })
    .waitFor();
  await page
    .getByText(`快照日期：${expectedLatestCsvSnapshot.date}`, { exact: true })
    .waitFor();
  requireCondition(
    page.url().includes("/#/elder/E001"),
    `Run ${run}: ${phase} snapshot assertion was not on the E001 dashboard`,
  );
};

const runs = [];

try {
  for (let run = 1; run <= 3; run += 1) {
    const startedAt = Date.now();
    const reset = await fetch(`${apiUrl}/api/demo/reset`, { method: "POST" });
    if (!reset.ok) throw new Error(`Run ${run}: reset returned ${reset.status}`);

    await page.goto(`${targetUrl}/#/institution`, { waitUntil: "networkidle" });
    await page.evaluate(() => window.localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".heatmap-table").waitFor();

    await page.getByRole("link", { name: "陈伯驾驶舱" }).click();
    await page.waitForURL("**/#/elder/E001");
    await page.locator(".metric-grid").waitFor();

    await page.getByRole("link", { name: "穿戴数据导入" }).click();
    await page.waitForURL("**/wearable-import");
    await page.locator('input[type="file"][accept*=".csv"]').setInputFiles({
      name: csvFilename,
      mimeType: "text/csv",
      buffer: Buffer.from(csvPayload, "utf8"),
    });
    await page.getByText(`已选择：${csvFilename}`, { exact: false }).waitFor();

    const previewResponse = await clickAndRequireStatus(
      page.getByRole("button", { name: "预览并校验 CSV" }),
      csvPreview,
      200,
    );
    const previewBody = await previewResponse.json();
    requireCondition(previewBody.count === 7, `Run ${run}: CSV preview count was ${previewBody.count}`);
    requireCondition(!previewBody.import_id, `Run ${run}: preview unexpectedly created import_id`);
    requireCondition(
      previewBody.preview?.date_range?.start === "2026-07-04" &&
        previewBody.preview?.date_range?.end === expectedLatestCsvSnapshot.date,
      `Run ${run}: CSV preview date range was incorrect`,
    );
    requireCondition(
      previewBody.snapshots?.every((snapshot) => snapshot.data_source === "CSV Import"),
      `Run ${run}: CSV preview source was not normalized to CSV Import`,
    );

    const confirm = page.getByRole("button", { name: "确认写入本地数据库" });
    await confirm.waitFor();
    const [firstImportResponse, firstHistoryResponse] = await clickAndRequireResponses(confirm, [
      { responseFactory: csvConfirm, expectedStatus: 201 },
      { responseFactory: csvHistory, expectedStatus: 200 },
    ]);
    const firstImportBody = await firstImportResponse.json();
    const firstHistoryBody = await firstHistoryResponse.json();
    requireCondition(firstImportBody.import_id, `Run ${run}: confirmed import had no import_id`);
    requireCondition(
      firstHistoryBody.imports?.some((entry) => entry.import_id === firstImportBody.import_id),
      `Run ${run}: first import_id was absent from import history`,
    );
    await page.getByText("7 条记录已写入").waitFor();
    await page
      .getByText(`import_id：${firstImportBody.import_id}`, { exact: false })
      .first()
      .waitFor();

    const firstImportDashboard = await fetchDashboard();
    const firstImportE001 = findE001(firstImportDashboard, run);
    requireCondition(
      firstImportE001.latest_snapshot?.date === expectedLatestCsvSnapshot.date &&
        firstImportE001.latest_snapshot?.data_source === expectedLatestCsvSnapshot.data_source &&
        firstImportE001.latest_snapshot?.data_quality === expectedLatestCsvSnapshot.data_quality,
      `Run ${run}: latest snapshot did not come from the uploaded CSV`,
    );
    const firstDistinctDates = distinctSnapshotDates(firstImportE001);

    const [secondImportResponse, secondHistoryResponse] = await clickAndRequireResponses(confirm, [
      { responseFactory: csvConfirm, expectedStatus: 201 },
      { responseFactory: csvHistory, expectedStatus: 200 },
    ]);
    const secondImportBody = await secondImportResponse.json();
    const secondHistoryBody = await secondHistoryResponse.json();
    requireCondition(secondImportBody.import_id, `Run ${run}: repeated import had no import_id`);
    requireCondition(
      secondImportBody.import_id !== firstImportBody.import_id,
      `Run ${run}: repeated import did not create a separate history record`,
    );
    requireCondition(
      [firstImportBody.import_id, secondImportBody.import_id].every((importId) =>
        secondHistoryBody.imports?.some((entry) => entry.import_id === importId),
      ),
      `Run ${run}: repeated import history did not contain both import ids`,
    );
    requireCondition(
      firstImportBody.snapshots?.length === secondImportBody.snapshots?.length &&
        firstImportBody.snapshots?.every((snapshot) =>
          secondImportBody.snapshots.some(
            (reimported) =>
              reimported.date === snapshot.date && reimported.snapshot_id === snapshot.snapshot_id,
          ),
        ),
      `Run ${run}: repeated CSV import was not idempotent by elder and date`,
    );
    await page
      .getByText(`import_id：${secondImportBody.import_id}`, { exact: false })
      .first()
      .waitFor();

    const secondImportDashboard = await fetchDashboard();
    const secondImportE001 = findE001(secondImportDashboard, run);
    const secondDistinctDates = distinctSnapshotDates(secondImportE001);
    requireCondition(
      secondDistinctDates.size === firstDistinctDates.size &&
        [...secondDistinctDates].every((date) => firstDistinctDates.has(date)),
      `Run ${run}: repeated CSV import changed the distinct snapshot dates`,
    );

    await page.getByRole("link", { name: "返回驾驶舱" }).click();
    await page.waitForURL("**/#/elder/E001");
    await assertCsvSnapshotInDashboard(run, "post-import");
    await page.getByRole("link", { name: "打开硬件模拟器" }).click();
    await page.waitForURL("**/#/hardware-simulator");
    const [sosResponse, sosAgentResponse] = await clickAndRequireResponses(
      page.getByRole("button", { name: "长按求助" }),
      [
        { responseFactory: () => eventPost("sos"), expectedStatus: 201 },
        { responseFactory: () => agentAnalyze("E001"), expectedStatus: 201 },
      ],
    );
    const sosBody = await sosResponse.json();
    if (sosBody.event?.source !== "mock") {
      throw new Error(`Run ${run}: simulator source was ${sosBody.event?.source}`);
    }
    if (sosBody.event?.payload?.simulated_device !== "esp32") {
      throw new Error(`Run ${run}: simulator provenance marker missing`);
    }
    if (sosBody.risk_result?.status_level !== "urgent") {
      throw new Error(`Run ${run}: SOS did not become urgent`);
    }
    const sosTaskId = sosBody.task?.task_id;
    if (!sosTaskId) throw new Error(`Run ${run}: SOS did not create a task`);
    const sosEventId = sosBody.event?.event_id;
    requireCondition(sosEventId, `Run ${run}: SOS response had no event_id`);

    const sosAgentBody = await sosAgentResponse.json();
    validateAgentOutput(sosAgentBody.agent_result, sosBody.risk_result);
    requireCondition(
      sosAgentBody.source_event_id === sosEventId &&
        requestBody(sosAgentResponse.request())?.source_event_id === sosEventId,
      `Run ${run}: Agent response was not bound to SOS event ${sosEventId}`,
    );
    requireCondition(
      sosAgentBody.meta?.provider === "mock",
      `Run ${run}: SOS Agent provider was ${sosAgentBody.meta?.provider}`,
    );
    requireCondition(
      sosAgentBody.meta?.fallback_used === true,
      `Run ${run}: SOS Agent did not report fallback_used=true`,
    );
    requireCondition(
      ["valid", "fallback_valid"].includes(sosAgentBody.meta?.validation_status),
      `Run ${run}: SOS Agent validation status was ${sosAgentBody.meta?.validation_status}`,
    );
    requireCondition(
      sosAgentBody.agent_result.status_level === sosBody.risk_result.status_level &&
        sosAgentBody.agent_result.risk_score === sosBody.risk_result.risk_score,
      `Run ${run}: SOS Agent changed the rule-engine risk result`,
    );

    let sosAgentOutputId = sosAgentBody.output_id;
    if (!sosAgentOutputId) {
      const sosDashboard = await fetchDashboard();
      const sosE001 = findE001(sosDashboard, run);
      requireCondition(
        sosE001.latest_agent_output?.source_event_id === sosEventId,
        `Run ${run}: dashboard fallback output did not belong to the SOS`,
      );
      sosAgentOutputId = sosE001.latest_agent_output?.output_id;
    }
    requireCondition(sosAgentOutputId, `Run ${run}: SOS Agent output_id was unavailable`);

    await page.getByRole("link", { name: "陈伯驾驶舱" }).click();
    await page.waitForURL("**/#/elder/E001");
    await assertCsvSnapshotInDashboard(run, "post-event-refresh");
    await page.getByRole("link", { name: "护工端" }).click();
    await page.waitForURL("**/#/caregiver");
    await assertAgentPanel(
      page.locator(".ai-summary-card"),
      sosAgentBody.agent_result.caregiver_summary,
      sosAgentOutputId,
      sosAgentBody.meta,
      run,
      "caregiver SOS",
    );
    const chenTaskCard = page.locator(".task-card").filter({ hasText: "陈伯" }).first();
    await clickAndRequireStatus(
      chenTaskCard.getByRole("button", { name: "接单" }),
      () => taskPatch(sosTaskId, "acknowledged"),
      200,
    );
    await clickAndRequireStatus(
      chenTaskCard.getByRole("button", { name: "标记已查看" }),
      () => taskPatch(sosTaskId, "in_progress"),
      200,
    );
    await clickAndRequireStatus(
      chenTaskCard.getByRole("button", { name: "确认晚药" }),
      () => eventPost("medication", "confirmed"),
      201,
    );
    const [resolvedResponse, completedEventResponse, completedAgentResponse] =
      await clickAndRequireResponses(
      chenTaskCard.getByRole("button", { name: "完成并记录" }),
      [
        { responseFactory: () => taskPatch(sosTaskId, "resolved"), expectedStatus: 200 },
        {
          responseFactory: () => eventPost("manual_note", "caregiver_completed"),
          expectedStatus: 201,
        },
        { responseFactory: () => agentAnalyze("E001"), expectedStatus: 201 },
      ],
    );
    const resolvedBody = await resolvedResponse.json();
    if (resolvedBody.task?.status !== "resolved") {
      throw new Error(`Run ${run}: caregiver task was not resolved`);
    }
    const completedEventBody = await completedEventResponse.json();
    const completedAgentBody = await completedAgentResponse.json();
    requireCondition(
      completedAgentBody.source_event_id === completedEventBody.event?.event_id,
      `Run ${run}: completion Agent output was not bound to the completion event`,
    );
    validateAgentOutput(completedAgentBody.agent_result, completedEventBody.risk_result);

    const finalDashboard = await fetchDashboard();
    const e001 = findE001(finalDashboard, run);
    const latestTask = e001.tasks?.[0];
    if (latestTask?.status !== "resolved") {
      throw new Error(`Run ${run}: dashboard task state was ${latestTask?.status}`);
    }
    requireCondition(
      e001.latest_snapshot?.date === expectedLatestCsvSnapshot.date &&
        e001.latest_snapshot?.data_source === expectedLatestCsvSnapshot.data_source &&
        e001.latest_snapshot?.data_quality === expectedLatestCsvSnapshot.data_quality,
      `Run ${run}: event refresh replaced the uploaded CSV latest snapshot`,
    );

    const latestOutput = e001.latest_agent_output;
    const latestRun = e001.latest_agent_run;
    requireCondition(latestOutput?.output_id, `Run ${run}: dashboard had no latest Agent output`);
    requireCondition(latestRun, `Run ${run}: dashboard had no latest Agent run`);
    validateAgentOutput(persistedAgentResult(latestOutput), e001.risk_result);
    requireCondition(
      latestOutput.output_id === completedAgentBody.output_id &&
        latestOutput.source_event_id === latestRun.source_event_id,
      `Run ${run}: latest Agent output and run belonged to different events`,
    );
    requireCondition(
      latestOutput.agent_source === "mock" &&
        latestRun.provider === "mock" &&
        latestRun.fallback_used === true &&
        ["valid", "fallback_valid"].includes(latestRun.validation_status),
      `Run ${run}: latest Agent provenance metadata was invalid`,
    );

    await assertAgentPanel(
      page.locator(".ai-summary-card"),
      latestOutput.caregiver_summary,
      latestOutput.output_id,
      latestRun,
      run,
      "caregiver",
    );

    await page.getByRole("link", { name: "家属端" }).click();
    await page.waitForURL("**/#/family/E001");
    await page.getByText("已跟进 / 持续观察").waitFor();
    await assertAgentPanel(
      page.locator(".gentle-summary"),
      latestOutput.family_summary,
      latestOutput.output_id,
      latestRun,
      run,
      "family",
    );

    await page.getByRole("link", { name: "机构端" }).click();
    await page.waitForURL("**/#/institution");
    await page.locator(".stats-grid").waitFor();
    await assertAgentPanel(
      page.locator(".ai-summary-card"),
      latestOutput.institution_summary,
      latestOutput.output_id,
      latestRun,
      run,
      "institution",
    );

    runs.push({
      run,
      duration_ms: Date.now() - startedAt,
      sos_source: sosBody.event.source,
      risk: sosBody.risk_result.status_level,
      task: latestTask.status,
      csv_import_ids: [firstImportBody.import_id, secondImportBody.import_id],
      csv_distinct_dates: secondDistinctDates.size,
      csv_latest_date: e001.latest_snapshot.date,
      csv_source: e001.latest_snapshot.data_source,
      csv_quality: e001.latest_snapshot.data_quality,
      sos_agent_output_id: sosAgentOutputId,
      latest_agent_output_id: latestOutput.output_id,
      agent_provider: latestRun.provider,
      agent_fallback_used: latestRun.fallback_used,
      agent_validation_status: latestRun.validation_status,
      verified_roles: ["caregiver", "family", "institution"],
    });
  }
} finally {
  await context.close();
  await browser.close();
}

const report = {
  ok: browserErrors.length === 0,
  injected_first_agent_response_delay_ms: firstAgentResponseDelayMs,
  runs,
  browser_errors: browserErrors,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok || runs.length !== 3) process.exitCode = 1;
