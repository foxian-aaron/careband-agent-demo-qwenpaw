import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  analyzeAppleHealthXmlFile,
  getAppleLocalDateKey,
  getAppleLocalDateTimeParts,
  normalizeExerciseMinutes,
  parseAppleHealthTimestamp,
  parseAppleHealthXml,
  previewAppleHealthXml,
} from "../src/importers/appleHealthXml.js";
import { parseDailySnapshotsCsv } from "../src/importers/csvImporter.js";

test("CSV importer parses daily snapshot rows", () => {
  const csv = [
    "elder_id,date,data_source,heart_rate_avg,resting_heart_rate,steps,active_minutes,sleep_duration,wear_time_hours,data_quality",
    "E001,2026-06-19,Apple Health Export,84,72,980,24,5.1,18.2,88",
  ].join("\n");
  const rows = parseDailySnapshotsCsv(csv);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].data_source, "Apple Health Export");
  assert.equal(rows[0].steps, 980);
});

test("CSV importer keeps missing wearable metrics as null", () => {
  const csv = [
    "elder_id,date,data_source,heart_rate_avg,resting_heart_rate,steps,active_minutes,sleep_duration,wear_time_hours,data_quality",
    "E001,2026-06-20,CSV Import,84,,980,,,18.2,85",
  ].join("\n");

  const [row] = parseDailySnapshotsCsv(csv);

  assert.equal(row.resting_heart_rate, null);
  assert.equal(row.active_minutes, null);
  assert.equal(row.sleep_duration, null);
  assert.equal(row.data_quality, 85);
});

test("CSV importer can apply server-controlled elder and source metadata", () => {
  const csv = [
    "elder_id,date,data_source,heart_rate_avg,resting_heart_rate,steps,active_minutes,sleep_duration,wear_time_hours,data_quality",
    "WRONG,2026-06-20,Untrusted Source,84,70,980,20,6.2,18.2,85",
  ].join("\n");

  const [row] = parseDailySnapshotsCsv(csv, {
    elderId: "E001",
    dataSource: "CSV Import",
  });

  assert.equal(row.elder_id, "E001");
  assert.equal(row.data_source, "CSV Import");
});

test("CSV importer rejects a blank data_quality instead of coercing it to zero", () => {
  const csv = [
    "elder_id,date,data_source,heart_rate_avg,resting_heart_rate,steps,active_minutes,sleep_duration,wear_time_hours,data_quality",
    "E001,2026-06-20,CSV Import,84,70,980,20,6.2,18.2,",
  ].join("\n");

  assert.throws(() => parseDailySnapshotsCsv(csv), /CSV/);
});

test("Apple Health timestamp parsing is deterministic for +0800 values", () => {
  const value = "2026-06-18 20:15:00 +0800";
  const parsed = parseAppleHealthTimestamp(value);
  const parts = getAppleLocalDateTimeParts(value);

  assert.equal(parsed.toISOString(), "2026-06-18T12:15:00.000Z");
  assert.equal(getAppleLocalDateKey(value), "2026-06-18");
  assert.equal(parts.offsetMinutes, 480);
  assert.equal(parts.dateKey, "2026-06-18");
});

test("Apple Health sleep uses wake-date strategy and ignores InBed/Awake", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<HealthData>
  <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Apple Watch" startDate="2026-06-18 23:30:00 +0800" endDate="2026-06-19 06:30:00 +0800" value="HKCategoryValueSleepAnalysisAsleepCore"/>
  <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Apple Watch" startDate="2026-06-18 23:00:00 +0800" endDate="2026-06-19 06:45:00 +0800" value="HKCategoryValueSleepAnalysisInBed"/>
  <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Apple Watch" startDate="2026-06-19 03:00:00 +0800" endDate="2026-06-19 03:10:00 +0800" value="HKCategoryValueSleepAnalysisAwake"/>
</HealthData>`;

  const rows = parseAppleHealthXml(xml, { elderId: "E001" });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2026-06-19");
  assert.equal(rows[0].sleep_duration, 7);
});

test("Apple Health sleep merges overlapping asleep intervals on the wake date", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<HealthData>
  <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Apple Watch" startDate="2026-06-18 22:00:00 +0800" endDate="2026-06-19 03:00:00 +0800" value="HKCategoryValueSleepAnalysisAsleepCore"/>
  <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Apple Watch" startDate="2026-06-18 23:00:00 +0800" endDate="2026-06-19 04:00:00 +0800" value="HKCategoryValueSleepAnalysisAsleepDeep"/>
</HealthData>`;

  const rows = parseAppleHealthXml(xml, { elderId: "TEST001" });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2026-06-19");
  assert.equal(rows[0].sleep_duration, 6);
});

test("step source strategy prefer_watch avoids iPhone plus Watch double counting", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<HealthData>
  <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Apple Watch" startDate="2026-06-17 09:00:00 +0800" endDate="2026-06-17 09:10:00 +0800" value="1000"/>
  <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" startDate="2026-06-17 09:00:00 +0800" endDate="2026-06-17 09:10:00 +0800" value="2000"/>
</HealthData>`;

  const preferWatch = parseAppleHealthXml(xml, { elderId: "TEST001" });
  const allSources = parseAppleHealthXml(xml, { elderId: "TEST001", stepSourceStrategy: "all_sources" });
  const preview = previewAppleHealthXml(xml, { elderId: "TEST001" });

  assert.equal(preferWatch[0].steps, 1000);
  assert.equal(allSources[0].steps, 3000);
  assert(preview.warnings.some((warning) => warning.includes("prefer_watch")));
});

test("step source strategy falls back to iPhone when no Watch steps exist", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<HealthData>
  <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" startDate="2026-06-17 09:00:00 +0800" endDate="2026-06-17 09:10:00 +0800" value="777"/>
</HealthData>`;

  const rows = parseAppleHealthXml(xml, { elderId: "TEST001" });

  assert.equal(rows[0].steps, 777);
});

test("exercise units are converted or skipped safely", () => {
  assert.equal(normalizeExerciseMinutes(30, "min").minutes, 30);
  assert.equal(normalizeExerciseMinutes(60, "sec").minutes, 1);
  assert.equal(normalizeExerciseMinutes(2, "hour").minutes, 120);
  assert.equal(normalizeExerciseMinutes(30, "count").minutes, null);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<HealthData>
  <Record type="HKQuantityTypeIdentifierAppleExerciseTime" sourceName="Apple Watch" unit="min" startDate="2026-06-18 18:00:00 +0800" endDate="2026-06-18 18:30:00 +0800" value="10"/>
  <Record type="HKQuantityTypeIdentifierAppleExerciseTime" sourceName="Apple Watch" unit="sec" startDate="2026-06-18 19:00:00 +0800" endDate="2026-06-18 19:01:00 +0800" value="60"/>
  <Record type="HKQuantityTypeIdentifierAppleExerciseTime" sourceName="Apple Watch" unit="hour" startDate="2026-06-18 20:00:00 +0800" endDate="2026-06-18 21:00:00 +0800" value="1"/>
  <Record type="HKQuantityTypeIdentifierAppleExerciseTime" sourceName="Apple Watch" unit="count" startDate="2026-06-18 21:00:00 +0800" endDate="2026-06-18 21:30:00 +0800" value="30"/>
</HealthData>`;

  const rows = parseAppleHealthXml(xml, { elderId: "TEST001" });
  const preview = previewAppleHealthXml(xml, { elderId: "TEST001" });

  assert.equal(rows[0].active_minutes, 71);
  assert(preview.warnings.some((warning) => warning.includes("converted")));
  assert(preview.warnings.some((warning) => warning.includes("unknown unit skipped")));
});

test("zero values are preserved and data quality is based on record existence", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<HealthData>
  <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Apple Watch" startDate="2026-06-18 09:00:00 +0800" endDate="2026-06-18 09:10:00 +0800" value="0"/>
  <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Apple Watch" startDate="2026-06-18 10:00:00 +0800" endDate="2026-06-18 10:01:00 +0800" value="80"/>
  <Record type="HKQuantityTypeIdentifierAppleExerciseTime" sourceName="Apple Watch" unit="min" startDate="2026-06-18 18:00:00 +0800" endDate="2026-06-18 18:30:00 +0800" value="0"/>
  <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Apple Watch" startDate="2026-06-18 23:00:00 +0800" endDate="2026-06-18 23:00:00 +0800" value="HKCategoryValueSleepAnalysisAsleepCore"/>
</HealthData>`;

  const rows = parseAppleHealthXml(xml, { elderId: "TEST001" });

  assert.equal(rows[0].steps, 0);
  assert.equal(rows[0].active_minutes, 0);
  assert.equal(rows[0].sleep_duration, 0);
  assert.equal(rows[0].data_quality, 90);
});

test("Apple Health XML preview returns safe summary and limit days", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<HealthData>
  <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Apple Watch" startDate="2026-06-17 09:00:00 +0800" endDate="2026-06-17 09:10:00 +0800" value="1000"/>
  <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" startDate="2026-06-17 09:00:00 +0800" endDate="2026-06-17 09:10:00 +0800" value="1000"/>
  <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Apple Watch" startDate="2026-06-18 09:00:00 +0800" endDate="2026-06-18 09:10:00 +0800" value="40000"/>
  <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Apple Watch" startDate="2026-06-18 10:00:00 +0800" endDate="2026-06-18 10:01:00 +0800" value="999"/>
  <Record type="HKQuantityTypeIdentifierAppleExerciseTime" sourceName="Apple Watch" unit="count" startDate="2026-06-18 18:00:00 +0800" endDate="2026-06-18 18:30:00 +0800" value="30"/>
</HealthData>`;

  const preview = previewAppleHealthXml(xml, { elderId: "TEST001", limitDays: 1 });

  assert.equal(preview.days_detected, 2);
  assert.equal(preview.sample_daily_snapshots.length, 1);
  assert.equal(preview.sample_daily_snapshots[0].date, "2026-06-18");
  assert.deepEqual(preview.source_names, ["Apple Watch", "iPhone"]);
  assert.equal(preview.record_counts.steps, 3);
  assert.equal(preview.step_source_strategy, "prefer_watch");
  assert.equal(preview.sleep_grouping_strategy, "wake_date");
  assert(preview.warnings.some((warning) => warning.includes("Both Apple Watch and iPhone")));
  assert(preview.warnings.some((warning) => warning.includes("Unusually high steps")));
  assert(preview.warnings.some((warning) => warning.includes("impossible heart-rate")));
  assert(preview.warnings.some((warning) => warning.includes("unknown unit skipped")));
});

test("file-based Apple Health analyzer returns safe aggregate preview", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<HealthData>
  <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Apple Watch" startDate="2026-06-19 09:00:00 +0800" endDate="2026-06-19 09:10:00 +0800" value="321"/>
</HealthData>`;
  const filePath = path.join(os.tmpdir(), `careband-apple-health-${Date.now()}.xml`);

  try {
    fs.writeFileSync(filePath, xml, "utf8");
    const result = await analyzeAppleHealthXmlFile(filePath, { elderId: "TEST001" });

    assert.equal(result.snapshots.length, 1);
    assert.equal(result.snapshots[0].steps, 321);
    assert.equal(result.preview.record_counts.steps, 1);
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});
