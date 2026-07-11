import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outputDir = path.join(projectRoot, "deliverables", "browser-video");
const outputPath = path.join(outputDir, "CareBand_v0.2_software_demo.webm");
const targetUrl = process.env.CAREBAND_DEMO_URL ?? "http://127.0.0.1:5173";
const apiUrl = process.env.CAREBAND_API_URL ?? "http://127.0.0.1:3001";
const browserPath =
  process.env.CAREBAND_BROWSER_PATH ??
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const playwrightSpecifier = process.env.PLAYWRIGHT_CORE_SPECIFIER ?? "playwright-core";

const { chromium } = await import(playwrightSpecifier);
await fs.mkdir(outputDir, { recursive: true });

const resetResponse = await fetch(`${apiUrl}/api/demo/reset`, { method: "POST" });
if (!resetResponse.ok) {
  throw new Error(`Demo reset failed with HTTP ${resetResponse.status}`);
}

const browser = await chromium.launch({ headless: true, executablePath: browserPath });
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  recordVideo: { dir: outputDir, size: { width: 1600, height: 900 } },
});
const page = await context.newPage();
const video = page.video();
const browserErrors = [];
page.on("console", (message) => {
  if (["error", "warning"].includes(message.type())) {
    browserErrors.push(`${message.type()}: ${message.text()}`);
  }
});
page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));

const startedAt = Date.now();
const pause = (milliseconds) => page.waitForTimeout(milliseconds);
const scene = async (name, action) => {
  console.log(`[scene] ${name}`);
  await action();
};
const waitForEventPost = () =>
  page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/events") && response.request().method() === "POST",
    { timeout: 20_000 },
  );
const waitForTaskPatch = () =>
  page.waitForResponse(
    (response) =>
      response.url().includes("/api/tasks/") && response.request().method() === "PATCH",
    { timeout: 20_000 },
  );

try {
  await scene("机构总览", async () => {
    await page.goto(`${targetUrl}/#/institution`, { waitUntil: "domcontentloaded" });
    await pause(8_000);
    await page.locator(".stats-grid").scrollIntoViewIfNeeded();
    await pause(6_000);
  });

  await scene("陈伯个人基线", async () => {
    await page.getByRole("link", { name: "陈伯驾驶舱" }).click();
    await page.waitForURL("**/#/elder/E001");
    await pause(8_000);
    await page.locator(".metric-grid").scrollIntoViewIfNeeded();
    await pause(8_000);
  });

  await scene("CSV 预览、确认与历史", async () => {
    await page.getByRole("link", { name: "穿戴数据导入" }).click();
    await page.waitForURL("**/wearable-import");
    await pause(5_000);
    await page.getByRole("button", { name: "填入陈伯 7 天示例" }).click();
    await page.getByRole("button", { name: "预览并校验 CSV" }).click();
    await page.getByRole("button", { name: "确认写入本地数据库" }).waitFor();
    await pause(5_000);
    await page.getByRole("button", { name: "确认写入本地数据库" }).click();
    await page.getByText("7 条记录已写入").waitFor();
    await pause(5_000);
    await page.getByText("Import History").scrollIntoViewIfNeeded();
    await pause(5_000);
  });

  await scene("硬件模拟 SOS", async () => {
    await page.getByRole("link", { name: "硬件模拟" }).click();
    await page.waitForURL("**/#/hardware-simulator");
    await pause(6_000);
    const eventResponse = waitForEventPost();
    await page.getByRole("button", { name: "长按求助" }).click();
    const response = await eventResponse;
    if (response.status() !== 201) throw new Error(`SOS returned HTTP ${response.status()}`);
    await pause(7_000);
  });

  await scene("紧急风险与 Agent fallback", async () => {
    await page.getByRole("link", { name: "陈伯驾驶舱" }).click();
    await page.waitForURL("**/#/elder/E001");
    await page.getByText("紧急待处理").first().waitFor();
    await pause(7_000);
    await page.locator(".agent-trace-panel").scrollIntoViewIfNeeded();
    await pause(8_000);
  });

  await scene("护工接单与查看", async () => {
    await page.getByRole("link", { name: "护工端" }).click();
    await page.waitForURL("**/#/caregiver");
    await pause(6_000);
    let response = waitForTaskPatch();
    await page.getByRole("button", { name: "接单" }).first().click();
    if ((await response).status() !== 200) throw new Error("Caregiver accept failed");
    await pause(6_000);
    response = waitForTaskPatch();
    await page.getByRole("button", { name: "标记已查看" }).first().click();
    if ((await response).status() !== 200) throw new Error("Caregiver view failed");
    await pause(6_000);
  });

  await scene("晚药确认与任务完成", async () => {
    let response = waitForEventPost();
    await page.getByRole("button", { name: "确认晚药" }).first().click();
    if ((await response).status() !== 201) throw new Error("Medication confirmation failed");
    await pause(6_000);
    response = waitForTaskPatch();
    await page.getByRole("button", { name: "完成并记录" }).first().click();
    const resolvedResponse = await response;
    const resolvedBody = await resolvedResponse.json();
    if (resolvedBody.task?.status !== "resolved") throw new Error("Care task did not resolve");
    await page.getByText("已结束任务").waitFor();
    await pause(7_000);
  });

  await scene("家属安心卡", async () => {
    await page.getByRole("link", { name: "家属端" }).click();
    await page.waitForURL("**/#/family/E001");
    await page.getByText("已跟进 / 持续观察").waitFor();
    await pause(10_000);
  });

  await scene("机构闭环统计", async () => {
    await page.getByRole("link", { name: "机构端" }).click();
    await page.waitForURL("**/#/institution");
    await page.locator(".stats-grid").scrollIntoViewIfNeeded();
    await pause(10_000);
  });
} finally {
  await context.close();
  await browser.close();
}

const rawVideoPath = await video.path();
await fs.copyFile(rawVideoPath, outputPath);
const durationMs = Date.now() - startedAt;

console.log(
  JSON.stringify(
    {
      ok: browserErrors.length === 0,
      output_path: outputPath,
      duration_ms: durationMs,
      browser_errors: browserErrors,
    },
    null,
    2,
  ),
);

if (browserErrors.length) process.exitCode = 1;
