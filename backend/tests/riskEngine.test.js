import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRisk } from "../src/rules/riskEngine.js";

const elder = { elder_id: "E001", name: "陈伯" };
const baseline = {
  avg_steps_7d: 2000,
  avg_sleep_7d: 8,
  avg_active_minutes_7d: 40,
  resting_hr_baseline: 70,
};
const snapshot = {
  data_quality: 88,
  steps: 900,
  sleep_duration: 5.5,
  active_minutes: 20,
  heart_rate_avg: 76,
};
const healthySnapshot = {
  data_quality: 90,
  steps: 2000,
  sleep_duration: 8,
  active_minutes: 40,
  heart_rate_avg: 100,
  resting_heart_rate: 70,
  wear_time_hours: 18,
};

test("legacy sos_long_press remains compatible and creates urgent", () => {
  const result = evaluateRisk({
    elder,
    baseline,
    snapshot,
    events: [{ event_type: "sos_long_press", raw_text: "SOS 长按求助", payload: {} }],
  });

  assert.equal(result.status_level, "urgent");
  assert.equal(result.safety_disclaimer, "本結果僅為照護風險提示，不構成醫療診斷。");
});

test("fall_detected creates urgent", () => {
  const result = evaluateRisk({
    elder,
    baseline,
    snapshot,
    events: [{ event_type: "fall_detected", raw_text: "检测到跌倒", payload: {} }],
  });

  assert.equal(result.status_level, "urgent");
});

test("normalized SOS is urgent even when no snapshot is available", () => {
  const result = evaluateRisk({
    elder,
    baseline,
    snapshot: null,
    events: [{ event_type: "sos", raw_text: "SOS 长按求助", payload: { action: "long_press" } }],
  });

  assert.equal(result.status_level, "urgent");
  assert.equal(result.risk_score, 100);
});

test("low data quality becomes data_insufficient when no hard event exists", () => {
  const result = evaluateRisk({
    elder,
    baseline,
    snapshot: { ...snapshot, data_quality: 32 },
    events: [],
  });

  assert.equal(result.status_level, "data_insufficient");
});

test("wear time below six hours becomes data_insufficient", () => {
  const result = evaluateRisk({
    elder,
    baseline,
    snapshot: { ...healthySnapshot, wear_time_hours: 5.9 },
    events: [],
  });

  assert.equal(result.status_level, "data_insufficient");
});

test("dizziness plus the latest unconfirmed medication signal is high_risk", () => {
  const result = evaluateRisk({
    elder,
    baseline,
    snapshot: healthySnapshot,
    events: [
      {
        event_type: "voice",
        occurred_at: "2026-07-11T12:00:00.000Z",
        raw_text: "我有点头晕",
        payload: { action: "symptom_report" },
      },
      {
        event_type: "medication",
        occurred_at: "2026-07-11T12:01:00.000Z",
        payload: { action: "reminder", medication_confirmed: false },
      },
    ],
  });

  assert.equal(result.status_level, "high_risk");
});

test("fall risk uses confidence rather than treating every signal as urgent", () => {
  const mediumConfidence = evaluateRisk({
    elder,
    baseline,
    snapshot: healthySnapshot,
    events: [{ event_type: "fall", payload: { confidence: 0.6 } }],
  });
  const lowConfidence = evaluateRisk({
    elder,
    baseline,
    snapshot: healthySnapshot,
    events: [{ event_type: "fall", payload: { confidence: 0.3 } }],
  });

  assert.equal(mediumConfidence.status_level, "high_risk");
  assert.equal(lowConfidence.status_level, "observation");
});

test("fall confidence remains actionable when no wearable snapshot is available", () => {
  const mediumConfidence = evaluateRisk({
    elder,
    baseline,
    snapshot: null,
    events: [{ event_type: "fall", payload: { confidence: 0.6 } }],
  });
  const lowConfidence = evaluateRisk({
    elder,
    baseline,
    snapshot: null,
    events: [{ event_type: "fall", payload: { confidence: 0.3 } }],
  });

  assert.equal(mediumConfidence.status_level, "high_risk");
  assert.equal(lowConfidence.status_level, "observation");
});

test("multiple fall signals use the highest active confidence", () => {
  const result = evaluateRisk({
    elder,
    baseline,
    snapshot: healthySnapshot,
    events: [
      {
        event_type: "fall",
        occurred_at: "2026-07-11T09:00:00.000Z",
        payload: { confidence: 0.2 },
      },
      {
        event_type: "fall",
        occurred_at: "2026-07-11T10:00:00.000Z",
        payload: { confidence: 0.95 },
      },
    ],
  });

  assert.equal(result.status_level, "urgent");
  assert.equal(result.risk_score, 95);
});

test("baseline comparison uses resting_heart_rate and ignores resolved events", () => {
  const averageOnly = evaluateRisk({
    elder,
    baseline,
    snapshot: healthySnapshot,
    events: [{ event_type: "sos", status: "resolved", payload: {} }],
  });
  const restingElevated = evaluateRisk({
    elder,
    baseline,
    snapshot: { ...healthySnapshot, resting_heart_rate: 84 },
    events: [],
  });

  assert.equal(averageOnly.status_level, "stable");
  assert.equal(restingElevated.status_level, "observation");
});
