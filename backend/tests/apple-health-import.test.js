import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  analyzeAppleHealthXmlFile,
  getAppleLocalDateKey,
  parseAppleHealthTimestamp,
  resolvePrivateAppleHealthInput,
  resolvePrivateDerivedOutput,
  snapshotsToCsv,
  writePrivateDerivedCsv,
} from "../src/importers/appleHealthXml.js";
import { parseDailySnapshotsCsv } from "../src/importers/csvImporter.js";

const tempRoots = [];

test.afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function makeTempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "careband-apple-health-"));
  tempRoots.push(root);
  fs.mkdirSync(path.join(root, "private_data", "apple_health"), { recursive: true });
  return root;
}

function writeExport(projectRoot, content) {
  const file = path.join(projectRoot, "private_data", "apple_health", "export.xml");
  fs.writeFileSync(file, content);
  return file;
}

const tag = (attributes) =>
  `<Record ${Object.entries(attributes).map(([key, value]) => `${key}="${value}"`).join(" ")} />`;

test("timestamps preserve the recorded local date and parse explicit offsets", () => {
  assert.equal(getAppleLocalDateKey("2026-08-02 00:30:00 +0800"), "2026-08-02");
  assert.equal(parseAppleHealthTimestamp("2026-08-02 00:30:00 +0800")?.toISOString(), "2026-08-01T16:30:00.000Z");
  assert.equal(parseAppleHealthTimestamp("2026-02-30 00:30:00 +0800"), null);
  assert.equal(parseAppleHealthTimestamp("not-a-date"), null);
});

test("streams supported records into one TEST001 daily aggregate", async () => {
  const project = makeTempProject();
  const xml = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?><HealthData>",
    tag({ type: "HKQuantityTypeIdentifierStepCount", sourceName: "Aaron Apple Watch", unit: "count", value: "1000", startDate: "2026-08-02 08:00:00 +0800", endDate: "2026-08-02 08:10:00 +0800" }),
    tag({ type: "HKQuantityTypeIdentifierStepCount", sourceName: "Aaron iPhone", unit: "count", value: "500", startDate: "2026-08-02 08:00:00 +0800", endDate: "2026-08-02 08:10:00 +0800" }),
    tag({ type: "HKQuantityTypeIdentifierHeartRate", unit: "count/min", value: "60", startDate: "2026-08-02 09:00:00 +0800", endDate: "2026-08-02 09:00:00 +0800" }),
    tag({ type: "HKQuantityTypeIdentifierHeartRate", unit: "count/min", value: "80", startDate: "2026-08-02 10:00:00 +0800", endDate: "2026-08-02 10:00:00 +0800" }),
    tag({ type: "HKQuantityTypeIdentifierRestingHeartRate", unit: "count/min", value: "55", startDate: "2026-08-02 10:00:00 +0800", endDate: "2026-08-02 10:00:00 +0800" }),
    tag({ type: "HKQuantityTypeIdentifierAppleExerciseTime", unit: "min", value: "30", startDate: "2026-08-02 10:00:00 +0800", endDate: "2026-08-02 10:30:00 +0800" }),
    tag({ type: "HKCategoryTypeIdentifierSleepAnalysis", value: "HKCategoryValueSleepAnalysisAsleepCore", startDate: "2026-08-01 22:00:00 +0800", endDate: "2026-08-02 02:00:00 +0800" }),
    tag({ type: "HKCategoryTypeIdentifierSleepAnalysis", value: "HKCategoryValueSleepAnalysisAsleepREM", startDate: "2026-08-02 01:00:00 +0800", endDate: "2026-08-02 03:00:00 +0800" }),
    tag({ type: "HKCategoryTypeIdentifierSleepAnalysis", value: "HKCategoryValueSleepAnalysisInBed", startDate: "2026-08-01 21:00:00 +0800", endDate: "2026-08-02 04:00:00 +0800" }),
    "</HealthData>",
  ].join("\n");
  const result = await analyzeAppleHealthXmlFile(writeExport(project, xml));
  assert.equal(result.snapshots.length, 1);
  assert.deepEqual(result.snapshots[0], {
    elder_id: "TEST001",
    date: "2026-08-02",
    data_source: "Apple Health Local Aggregate",
    heart_rate_avg: 70,
    resting_heart_rate: 55,
    steps: 1000,
    active_minutes: 30,
    sleep_duration: 5,
    wear_time_hours: null,
    data_quality: 100,
  });
  assert.equal(result.preview.warning_counts.mixed_step_sources, 1);
  assert.equal(result.preview.sample_daily_snapshots.length, 1);
  assert.ok(!JSON.stringify(result.preview).includes("Aaron"));
});

test("invalid metrics and unsupported units are ignored with controlled counts", async () => {
  const project = makeTempProject();
  const xml = [
    "<HealthData>",
    tag({ type: "HKQuantityTypeIdentifierStepCount", unit: "count", value: "42", startDate: "2026-08-02 08:00:00 +0800", endDate: "2026-08-02 08:00:00 +0800" }),
    tag({ type: "HKQuantityTypeIdentifierHeartRate", unit: "count/min", value: "999", startDate: "2026-08-02 09:00:00 +0800", endDate: "2026-08-02 09:00:00 +0800" }),
    tag({ type: "HKQuantityTypeIdentifierAppleExerciseTime", unit: "fortnight", value: "2", startDate: "2026-08-02 10:00:00 +0800", endDate: "2026-08-02 10:00:00 +0800" }),
    tag({ type: "HKQuantityTypeIdentifierAppleExerciseTime", unit: "hours", value: "25", startDate: "2026-08-02 11:00:00 +0800", endDate: "2026-08-02 11:00:00 +0800" }),
    tag({ type: "UnsupportedPrivateType", value: "PRIVATE_VALUE", startDate: "2026-08-02 10:00:00 +0800", endDate: "2026-08-02 10:00:00 +0800" }),
    "</HealthData>",
  ].join("\n");
  const result = await analyzeAppleHealthXmlFile(writeExport(project, xml));
  assert.equal(result.snapshots[0].heart_rate_avg, null);
  assert.equal(result.snapshots[0].active_minutes, null);
  assert.equal(result.preview.warning_counts.invalid_metric, 2);
  assert.equal(result.preview.warning_counts.unsupported_unit, 1);
  assert.ok(!JSON.stringify(result).includes("PRIVATE_VALUE"));
});

test("strict numeric and unit validation rejects ambiguous Apple Health metrics", async () => {
  const project = makeTempProject();
  const xml = [
    "<HealthData>",
    tag({ type: "HKQuantityTypeIdentifierStepCount", unit: "count", value: "1e3", startDate: "2026-08-02 08:00:00 +0800", endDate: "2026-08-02 08:00:00 +0800" }),
    tag({ type: "HKQuantityTypeIdentifierStepCount", unit: "km", value: "1000", startDate: "2026-08-02 09:00:00 +0800", endDate: "2026-08-02 09:00:00 +0800" }),
    tag({ type: "HKQuantityTypeIdentifierHeartRate", unit: "bpm", value: "70", startDate: "2026-08-02 10:00:00 +0800", endDate: "2026-08-02 10:00:00 +0800" }),
    "</HealthData>",
  ].join("\n");
  const result = await analyzeAppleHealthXmlFile(writeExport(project, xml));
  assert.equal(result.snapshots.length, 0);
  assert.equal(result.preview.warning_counts.invalid_metric, 1);
  assert.equal(result.preview.warning_counts.unsupported_unit, 2);
});

test("XML structure ignores comments and CDATA, preserves quoted greater-than, and rejects malformed roots", async () => {
  const project = makeTempProject();
  const xml = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE HealthData [",
    "  <!-- HealthKit Export Version: 14 -->",
    "  <!ELEMENT HealthData (Record*)>",
    "  <!ELEMENT Record EMPTY>",
    "]>",
    "<HealthData>",
    `<!-- ${tag({ type: "HKQuantityTypeIdentifierStepCount", unit: "count", value: "9999", startDate: "2026-08-02 08:00:00 +0800" })} -->`,
    `<![CDATA[${tag({ type: "HKQuantityTypeIdentifierStepCount", unit: "count", value: "8888", startDate: "2026-08-02 08:00:00 +0800" })}]]>`,
    tag({ type: "HKQuantityTypeIdentifierStepCount", unit: "count", sourceName: "Watch > Phone", value: "1200", startDate: "2026-08-02 08:00:00 +0800", endDate: "2026-08-02 08:00:00 +0800" }),
    "</HealthData>",
  ].join("\n");
  const result = await analyzeAppleHealthXmlFile(writeExport(project, xml));
  assert.equal(result.snapshots.length, 1);
  assert.equal(result.snapshots[0].steps, 1200);

  await assert.rejects(
    () => analyzeAppleHealthXmlFile(writeExport(project, `<Other>${tag({ type: "HKQuantityTypeIdentifierStepCount", unit: "count", value: "1", startDate: "2026-08-02 08:00:00 +0800" })}</Other>`)),
    (error) => error.code === "APPLE_HEALTH_INVALID_XML",
  );
  await assert.rejects(
    () => analyzeAppleHealthXmlFile(writeExport(project, "<HealthData><Record type=\"x\"></HealthData>")),
    (error) => error.code === "APPLE_HEALTH_INVALID_XML",
  );
  await assert.rejects(
    () => analyzeAppleHealthXmlFile(writeExport(project, '<!DOCTYPE HealthData SYSTEM "https://example.invalid/health.dtd"><HealthData></HealthData>')),
    (error) => error.code === "APPLE_HEALTH_INVALID_XML",
  );
});

test("XML nesting depth is bounded before stack memory can grow without limit", async () => {
  const project = makeTempProject();
  const nested = `${"<x>".repeat(65)}${"</x>".repeat(65)}`;
  await assert.rejects(
    () => analyzeAppleHealthXmlFile(writeExport(project, `<HealthData>${nested}</HealthData>`)),
    (error) => error.code === "APPLE_HEALTH_COMPLEXITY_LIMIT",
  );
});

test("overlapping sleep intervals are globally merged and assigned to the final wake date", async () => {
  const project = makeTempProject();
  const xml = [
    "<HealthData>",
    tag({ type: "HKCategoryTypeIdentifierSleepAnalysis", value: "HKCategoryValueSleepAnalysisAsleepCore", startDate: "2026-08-01 22:00:00 +0800", endDate: "2026-08-01 23:30:00 +0800" }),
    tag({ type: "HKCategoryTypeIdentifierSleepAnalysis", value: "HKCategoryValueSleepAnalysisAsleepREM", startDate: "2026-08-01 23:00:00 +0800", endDate: "2026-08-02 01:00:00 +0800" }),
    "</HealthData>",
  ].join("\n");
  const result = await analyzeAppleHealthXmlFile(writeExport(project, xml));
  assert.equal(result.snapshots.length, 1);
  assert.equal(result.snapshots[0].date, "2026-08-02");
  assert.equal(result.snapshots[0].sleep_duration, 3);
});

test("limitDays bounds retained daily state to the most recent dates", async () => {
  const project = makeTempProject();
  const records = [];
  for (let day = 1; day <= 20; day += 1) {
    const date = `2026-07-${String(day).padStart(2, "0")}`;
    records.push(tag({ type: "HKQuantityTypeIdentifierStepCount", unit: "count", value: "100", startDate: `${date} 08:00:00 +0800`, endDate: `${date} 08:00:00 +0800` }));
  }
  const result = await analyzeAppleHealthXmlFile(writeExport(project, `<HealthData>${records.join("")}</HealthData>`), { limitDays: 2 });
  assert.deepEqual(result.snapshots.map((snapshot) => snapshot.date), ["2026-07-19", "2026-07-20"]);
  assert.equal(result.preview.days_detected, 2);
});

test("strict UTF-8 and bounded Record tags fail with fixed sanitized codes", async () => {
  const project = makeTempProject();
  const invalidUtf8 = writeExport(project, Buffer.from([0x3c, 0x48, 0x3e, 0xff, 0x3c, 0x2f, 0x48, 0x3e]));
  await assert.rejects(() => analyzeAppleHealthXmlFile(invalidUtf8), (error) => {
    assert.equal(error.code, "APPLE_HEALTH_INVALID_ENCODING");
    assert.equal(error.message, "APPLE_HEALTH_INVALID_ENCODING");
    assert.ok(!error.message.includes(project));
    return true;
  });

  const oversized = writeExport(project, `<HealthData><Record ${"x".repeat(65 * 1024)}`);
  await assert.rejects(() => analyzeAppleHealthXmlFile(oversized), (error) => {
    assert.equal(error.code, "APPLE_HEALTH_TAG_TOO_LARGE");
    return true;
  });

  const closedOversized = writeExport(project, `<HealthData><Record value="${"x".repeat(65 * 1024)}" /></HealthData>`);
  await assert.rejects(() => analyzeAppleHealthXmlFile(closedOversized), (error) => {
    assert.equal(error.code, "APPLE_HEALTH_TAG_TOO_LARGE");
    return true;
  });
});

test("CSV output is Stage 9 compatible and contains no risk or raw record fields", async () => {
  const project = makeTempProject();
  const xml = `<HealthData>${tag({ type: "HKQuantityTypeIdentifierStepCount", unit: "count", value: "1200", startDate: "2026-08-02 08:00:00 +0800", endDate: "2026-08-02 08:00:00 +0800" })}</HealthData>`;
  const result = await analyzeAppleHealthXmlFile(writeExport(project, xml));
  const csv = snapshotsToCsv(result.snapshots);
  assert.equal(csv.split("\n")[0], "elder_id,date,data_source,heart_rate_avg,resting_heart_rate,steps,active_minutes,sleep_duration,wear_time_hours,data_quality");
  assert.match(csv, /^TEST001,2026-08-02,Apple Health Local Aggregate,/m);
  assert.doesNotMatch(csv, /status_level|risk_score|key_reasons|recommended_action|<Record|sourceName/);
  const parsed = parseDailySnapshotsCsv({ csvText: csv, elderId: "TEST001" });
  assert.equal(parsed.count, 1);
});

test("daily steps above Stage 9 bounds are discarded and empty CSV output is rejected", async () => {
  const project = makeTempProject();
  const xml = `<HealthData>${tag({ type: "HKQuantityTypeIdentifierStepCount", unit: "count", sourceName: "Apple Watch", value: "150000", startDate: "2026-08-02 08:00:00 +0800", endDate: "2026-08-02 08:00:00 +0800" })}${tag({ type: "HKQuantityTypeIdentifierStepCount", unit: "count", sourceName: "Apple Watch", value: "150000", startDate: "2026-08-02 09:00:00 +0800", endDate: "2026-08-02 09:00:00 +0800" })}</HealthData>`;
  const result = await analyzeAppleHealthXmlFile(writeExport(project, xml));
  assert.equal(result.snapshots[0].steps, null);
  assert.equal(result.preview.warning_counts.invalid_metric, 1);
  assert.doesNotThrow(() => parseDailySnapshotsCsv({ csvText: snapshotsToCsv(result.snapshots), elderId: "TEST001" }));
  assert.throws(() => snapshotsToCsv([]), (error) => error.code === "APPLE_HEALTH_NO_DATA");
});

test("derived CSV uses an atomic fixed target and rejects hardlinked destinations", (t) => {
  const project = makeTempProject();
  const csv = "elder_id,date,data_source,heart_rate_avg,resting_heart_rate,steps,active_minutes,sleep_duration,wear_time_hours,data_quality\nTEST001,2026-08-02,Apple Health Local Aggregate,,,1200,,,,25";
  const target = writePrivateDerivedCsv(project, csv);
  assert.equal(target, path.join(project, "private_data", "derived", "apple-health-daily.csv"));
  assert.equal(fs.readFileSync(target, "utf8"), csv);
  assert.equal(writePrivateDerivedCsv(project, `${csv}\n`), target);
  assert.equal(fs.readFileSync(target, "utf8"), `${csv}\n`);

  const external = path.join(project, "external.csv");
  fs.writeFileSync(external, "outside");
  fs.rmSync(target);
  try {
    fs.linkSync(external, target);
    assert.throws(() => writePrivateDerivedCsv(project, csv), (error) => error.code === "APPLE_HEALTH_OUTPUT_REJECTED");
    assert.equal(fs.readFileSync(external, "utf8"), "outside");
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error.code)) t.diagnostic("Windows hardlink privilege unavailable");
    else throw error;
  }
});

test("private path guards reject outside paths and expose only the fixed derived target", async (t) => {
  const project = makeTempProject();
  const inside = writeExport(project, "<HealthData></HealthData>");
  assert.equal(resolvePrivateAppleHealthInput(inside, project), fs.realpathSync(inside));
  const outside = path.join(project, "outside.xml");
  fs.writeFileSync(outside, "<HealthData></HealthData>");
  assert.throws(() => resolvePrivateAppleHealthInput(outside, project), (error) => error.code === "APPLE_HEALTH_INPUT_REJECTED");
  assert.equal(
    resolvePrivateDerivedOutput(project),
    path.join(project, "private_data", "derived", "apple-health-daily.csv"),
  );

  const external = path.join(project, "external.xml");
  const linked = path.join(project, "private_data", "apple_health", "linked.xml");
  fs.writeFileSync(external, "<HealthData></HealthData>");
  try {
    fs.symlinkSync(external, linked, "file");
    assert.throws(() => resolvePrivateAppleHealthInput(linked, project), (error) => error.code === "APPLE_HEALTH_INPUT_REJECTED");
  } catch (error) {
    if (error.code === "EPERM") t.diagnostic("Windows symlink privilege unavailable; escape logic remains covered by realpath containment");
    else throw error;
  }

  const hardlinked = path.join(project, "private_data", "apple_health", "hardlinked.xml");
  try {
    fs.linkSync(external, hardlinked);
    await assert.rejects(() => analyzeAppleHealthXmlFile(hardlinked), (error) => error.code === "APPLE_HEALTH_INPUT_REJECTED");
  } catch (error) {
    if (!["EPERM", "EACCES"].includes(error.code)) throw error;
    t.diagnostic("Windows hardlink privilege unavailable");
  }
});

test("trusted private_data roots cannot be symlinks or junctions", (t) => {
  const project = makeTempProject();
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "careband-apple-health-external-"));
  tempRoots.push(externalRoot);
  fs.rmSync(path.join(project, "private_data"), { recursive: true, force: true });
  fs.mkdirSync(path.join(externalRoot, "apple_health"), { recursive: true });
  const externalInput = path.join(externalRoot, "apple_health", "export.xml");
  fs.writeFileSync(externalInput, "<HealthData></HealthData>");
  try {
    fs.symlinkSync(externalRoot, path.join(project, "private_data"), "junction");
    assert.throws(
      () => resolvePrivateAppleHealthInput(externalInput, project),
      (error) => error.code === "APPLE_HEALTH_INPUT_REJECTED",
    );
    assert.throws(
      () => writePrivateDerivedCsv(project, "private"),
      (error) => error.code === "APPLE_HEALTH_OUTPUT_REJECTED",
    );
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error.code)) t.diagnostic("Windows junction privilege unavailable");
    else throw error;
  }
});
