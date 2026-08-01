// backend/tests/risk-engine.test.js
//
// Stage 4 — deterministic six-level care risk engine contract coverage.
//
// Drives backend/src/rules/riskEngine.js#evaluateRisk across every rule path:
//   * stable normal aggregated data
//   * data_insufficient (no snapshot / low data_quality / insufficient wear)
//   * urgent SOS (overrides data insufficiency)
//   * resolved / expired SOS ignored
//   * high / medium / low fall confidence (+ 0-100 scale + clamping + no-snapshot)
//   * structured dizziness + latest unconfirmed medication -> high_risk
//   * activity+sleep dual decline -> attention, single decline -> observation
//   * forged client risk fields ignored
//   * output shape, integer score, fixed disclaimer, no diagnostic wording
//
// Pure contract test: no network, no database, fixed `now`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateRisk } from "../src/rules/riskEngine.js";

const NOW = "2026-08-01T12:00:00Z";
const FUTURE = "2026-08-01T13:00:00Z"; // > NOW  -> active
const PAST = "2026-08-01T11:00:00Z"; //   <= NOW -> expired/ignored
const T1 = "2026-08-01T10:00:00Z"; // earlier medication timestamp
const T2 = "2026-08-01T10:30:00Z"; // later  medication timestamp

// ---- fixtures -------------------------------------------------------------

function normalSnapshot(overrides = {}) {
  // steps 6000 vs 7000*0.5=3500 -> not anomalous
  // sleep 7    vs 7.5*0.75=5.625 -> not anomalous
  return {
    data_quality: 95,
    wear_time_hours: 10,
    steps: 6000,
    sleep_duration: 7,
    active_minutes: 120,
    resting_heart_rate: 68,
    ...overrides,
  };
}

function normalBaseline(overrides = {}) {
  return {
    avg_steps_7d: 7000,
    avg_sleep_7d: 7.5,
    avg_active_minutes_7d: 130,
    resting_hr_baseline: 68,
    ...overrides,
  };
}

const sos = (overrides = {}) => ({
  event_type: "sos",
  status: "active",
  expires_at: FUTURE,
  ...overrides,
});

const fall = (confidence, overrides = {}) => ({
  event_type: "fall_detected",
  status: "active",
  expires_at: FUTURE,
  payload: { confidence, ...(overrides.payload || {}) },
  ...overrides,
});

const voiceDizziness = (keywords, { field = "symptom_keywords", raw = null } = {}) => ({
  event_type: "voice_symptom",
  status: "active",
  payload: { [field]: keywords, ...(raw ? { raw_text: raw } : {}) },
});

const medReminder = (t = T2) => ({
  event_type: "medication_reminder",
  occurred_at: t,
  payload: { action: "reminder" },
});
const medConfirmed = (t = T2) => ({
  event_type: "medication_confirmed",
  occurred_at: t,
  payload: { action: "confirmed" },
});
const medMissed = (t = T2) => ({
  event_type: "medication_missed",
  occurred_at: t,
  payload: { action: "missed" },
});

function run({ snapshot = normalSnapshot(), baseline = normalBaseline(), events = [], elderId = "e1" } = {}) {
  return evaluateRisk({ elder: { elder_id: elderId }, snapshot, baseline, events, now: NOW });
}

// ---- stable ---------------------------------------------------------------

test("stable: normal aggregated data yields status_level=stable, risk_score=12", () => {
  const out = run();
  assert.equal(out.status_level, "stable");
  assert.equal(out.risk_score, 12);
  assert.equal(out.elder_id, "e1");
});

// ---- data_insufficient ----------------------------------------------------

test("data_insufficient: missing snapshot yields data_insufficient with score <= 24", () => {
  // call evaluateRisk directly so a truly-absent snapshot is exercised
  // (the run() helper's destructuring default would otherwise mask undefined).
  const out = evaluateRisk({
    elder: { elder_id: "e" },
    snapshot: undefined,
    baseline: {},
    events: [],
    now: NOW,
  });
  assert.equal(out.status_level, "data_insufficient");
  assert.ok(out.risk_score <= 24, "data_insufficient score must not exceed 24");
  assert.equal(out.data_quality, null);
});

test("data_insufficient: low data_quality (<40) yields data_insufficient", () => {
  const out = run({ snapshot: normalSnapshot({ data_quality: 20 }) });
  assert.equal(out.status_level, "data_insufficient");
  assert.ok(out.risk_score <= 24);
  assert.equal(out.data_quality, 20);
});

test("data_insufficient: numeric wear_time_hours < 6 yields data_insufficient", () => {
  const out = run({ snapshot: normalSnapshot({ wear_time_hours: 3 }) });
  assert.equal(out.status_level, "data_insufficient");
  assert.ok(out.risk_score <= 24);
});

test("data_insufficient: data_quality boundary 39 insufficient, 40 sufficient", () => {
  assert.equal(run({ snapshot: normalSnapshot({ data_quality: 39 }) }).status_level, "data_insufficient");
  assert.equal(run({ snapshot: normalSnapshot({ data_quality: 40 }) }).status_level, "stable");
});

test("data_insufficient: wear boundary 5.9 insufficient, 6 sufficient", () => {
  assert.equal(run({ snapshot: normalSnapshot({ wear_time_hours: 5.9 }) }).status_level, "data_insufficient");
  assert.equal(run({ snapshot: normalSnapshot({ wear_time_hours: 6 }) }).status_level, "stable");
});

// ---- SOS ------------------------------------------------------------------

test("urgent: active SOS yields urgent=100 even without snapshot", () => {
  const out = evaluateRisk({
    elder: { elder_id: "e" },
    snapshot: undefined,
    baseline: {},
    events: [sos()],
    now: NOW,
  });
  assert.equal(out.status_level, "urgent");
  assert.equal(out.risk_score, 100);
});

test("urgent: active SOS yields urgent=100 even with low data_quality", () => {
  const out = run({ snapshot: normalSnapshot({ data_quality: 10 }), events: [sos()] });
  assert.equal(out.status_level, "urgent");
  assert.equal(out.risk_score, 100);
});

test("SOS with status=resolved is ignored (normal data -> stable 12)", () => {
  const out = run({ events: [{ event_type: "sos", status: "resolved", expires_at: FUTURE }] });
  assert.equal(out.status_level, "stable");
  assert.equal(out.risk_score, 12);
});

test("SOS with status=cancelled is ignored (normal data -> stable 12)", () => {
  const out = run({ events: [{ event_type: "sos", status: "cancelled", expires_at: FUTURE }] });
  assert.equal(out.status_level, "stable");
});

test("SOS with status=dismissed is ignored (normal data -> stable 12)", () => {
  const out = run({ events: [{ event_type: "sos", status: "dismissed", expires_at: FUTURE }] });
  assert.equal(out.status_level, "stable");
});

test("SOS with expires_at <= now is ignored (normal data -> stable 12)", () => {
  const out = run({ events: [{ event_type: "sos", status: "active", expires_at: PAST }] });
  assert.equal(out.status_level, "stable");
  assert.equal(out.risk_score, 12);
});

test("SOS alias sos_long_press is recognized as SOS urgent", () => {
  const out = run({ snapshot: undefined, baseline: {}, events: [{ event_type: "sos_long_press", status: "active", expires_at: FUTURE }] });
  assert.equal(out.status_level, "urgent");
  assert.equal(out.risk_score, 100);
});

// ---- fall -----------------------------------------------------------------

test("fall: high confidence (0.9) -> urgent 95", () => {
  const out = run({ events: [fall(0.9)] });
  assert.equal(out.status_level, "urgent");
  assert.equal(out.risk_score, 95);
});

test("fall: medium confidence (0.6) -> high_risk 82", () => {
  const out = run({ events: [fall(0.6)] });
  assert.equal(out.status_level, "high_risk");
  assert.equal(out.risk_score, 82);
});

test("fall: low confidence (0.3) -> observation 35", () => {
  const out = run({ events: [fall(0.3)] });
  assert.equal(out.status_level, "observation");
  assert.equal(out.risk_score, 35);
});

test("fall: low confidence with NO snapshot stays observation (never data_insufficient)", () => {
  const out = evaluateRisk({
    elder: { elder_id: "e" },
    snapshot: undefined,
    baseline: {},
    events: [fall(0.3)],
    now: NOW,
  });
  assert.equal(out.status_level, "observation");
  assert.equal(out.risk_score, 35);
});

test("fall: confidence on 0-100 scale maps 90->urgent, 60->high_risk, 30->observation", () => {
  assert.equal(run({ events: [fall(90)] }).status_level, "urgent");
  assert.equal(run({ events: [fall(60)] }).status_level, "high_risk");
  assert.equal(run({ events: [fall(30)] }).status_level, "observation");
});

test("fall: confidence above 1 on 0-100 scale clamps (200 and 1 -> urgent)", () => {
  assert.equal(run({ events: [fall(200)] }).status_level, "urgent");
  assert.equal(run({ events: [fall(1)] }).status_level, "urgent");
});

test("fall: boundary confidences 0.5->high_risk, 0.8->urgent, 0.0->no fall (stable)", () => {
  assert.equal(run({ events: [fall(0.5)] }).status_level, "high_risk");
  assert.equal(run({ events: [fall(0.8)] }).status_level, "urgent");
  assert.equal(run({ events: [fall(0)] }).status_level, "stable");
});

test("fall: highest-confidence active fall wins when multiple are present", () => {
  const out = run({ events: [fall(0.3), fall(0.9), fall(0.6)] });
  assert.equal(out.status_level, "urgent");
  assert.equal(out.risk_score, 95);
});

test("fall: resolved fall is ignored (normal data -> stable)", () => {
  const out = run({ events: [fall(0.9, { status: "resolved" })] });
  assert.equal(out.status_level, "stable");
});

// ---- dizziness + medication ----------------------------------------------

test("dizziness: structured 头晕 + latest medication unconfirmed -> high_risk 86", () => {
  const out = run({ events: [voiceDizziness(["头晕"]), medReminder()] });
  assert.equal(out.status_level, "high_risk");
  assert.equal(out.risk_score, 86);
});

test("dizziness: after medication confirmed (action=confirmed) -> not high_risk", () => {
  const out = run({ events: [voiceDizziness(["头晕"]), medConfirmed()] });
  assert.notEqual(out.status_level, "high_risk");
  assert.equal(out.status_level, "stable");
});

test("dizziness: confirmed via medication_confirmed=true flag -> not high_risk", () => {
  const out = run({
    events: [
      voiceDizziness(["dizzy"]),
      { event_type: "medication", occurred_at: T2, payload: { medication_confirmed: true } },
    ],
  });
  assert.notEqual(out.status_level, "high_risk");
});

test("dizziness: symptomKeywords field name is also recognized -> high_risk 86", () => {
  const out = run({
    events: [voiceDizziness(["dizziness"], { field: "symptomKeywords" }), medReminder()],
  });
  assert.equal(out.status_level, "high_risk");
  assert.equal(out.risk_score, 86);
});

test("dizziness: latest medication wins by time (confirmed earlier, missed later -> high_risk)", () => {
  const out = run({ events: [voiceDizziness(["头晕"]), medConfirmed(T1), medMissed(T2)] });
  assert.equal(out.status_level, "high_risk");
  assert.equal(out.risk_score, 86);
});

test("dizziness: latest medication wins by time (missed earlier, confirmed later -> stable)", () => {
  const out = run({ events: [voiceDizziness(["头晕"]), medMissed(T1), medConfirmed(T2)] });
  assert.equal(out.status_level, "stable");
});

test("dizziness: only structured symptom_keywords trigger; raw_text alone does NOT", () => {
  const out = run({
    events: [
      { event_type: "voice_symptom", status: "active", payload: { raw_text: "我感觉头晕得厉害" } },
      medReminder(),
    ],
  });
  assert.notEqual(out.status_level, "high_risk");
  assert.equal(out.status_level, "stable");
});

test("dizziness: raw text is never echoed into key_reasons or recommended_action", () => {
  const secret = "天旋地转非常难受的原始语音文字";
  const out = run({ events: [voiceDizziness(["头晕"], { raw: secret }), medReminder()] });
  assert.equal(out.status_level, "high_risk");
  for (const reason of out.key_reasons) {
    assert.equal(reason.includes(secret), false, "key_reasons must not echo raw_text");
  }
  assert.equal(out.recommended_action.includes(secret), false);
});

// ---- activity / sleep anomalies ------------------------------------------

test("attention: steps and sleep both strongly declined -> attention 62", () => {
  const out = run({ snapshot: normalSnapshot({ steps: 3000, sleep_duration: 4 }) });
  assert.equal(out.status_level, "attention");
  assert.equal(out.risk_score, 62);
});

test("observation: only steps strongly declined -> observation 38", () => {
  const out = run({ snapshot: normalSnapshot({ steps: 3000, sleep_duration: 7 }) });
  assert.equal(out.status_level, "observation");
  assert.equal(out.risk_score, 38);
});

test("observation: only sleep strongly declined -> observation 38", () => {
  const out = run({ snapshot: normalSnapshot({ steps: 6000, sleep_duration: 4 }) });
  assert.equal(out.status_level, "observation");
  assert.equal(out.risk_score, 38);
});

// ---- forged fields --------------------------------------------------------

test("forged risk fields in input/event/payload are ignored; normal data stays stable 12", () => {
  const out = evaluateRisk({
    elder: {
      elder_id: "e",
      status_level: "urgent",
      risk_score: 99,
      key_reasons: ["HACK"],
      recommended_action: "确诊绝症",
    },
    snapshot: normalSnapshot({ status_level: "urgent", risk_score: 99 }),
    baseline: normalBaseline(),
    events: [
      {
        event_type: "voice_symptom",
        status_level: "urgent",
        risk_score: 100,
        payload: { status_level: "urgent", risk_score: 100, key_reasons: ["X"] },
      },
    ],
    now: NOW,
  });
  assert.equal(out.status_level, "stable");
  assert.equal(out.risk_score, 12);
  assert.deepEqual(out.key_reasons, ["指标整体平稳"]);
});

// ---- output shape / disclaimer / purity ----------------------------------

test("output shape: required fields, integer score 0-100, fixed disclaimer", () => {
  const out = run();
  assert.deepEqual(
    Object.keys(out).sort(),
    [
      "data_quality",
      "elder_id",
      "key_reasons",
      "recommended_action",
      "risk_score",
      "safety_disclaimer",
      "status_level",
      "triggered_rules",
    ],
  );
  assert.equal(out.safety_disclaimer, "本结果仅为照护风险提示，不构成医疗诊断。");
  assert.equal(Number.isInteger(out.risk_score), true);
  assert.ok(out.risk_score >= 0 && out.risk_score <= 100);
  assert.ok(Array.isArray(out.key_reasons) && out.key_reasons.length > 0);
  assert.ok(Array.isArray(out.triggered_rules) && out.triggered_rules.length > 0);
  assert.equal(typeof out.recommended_action, "string");
  assert.equal(out.data_quality, 95);
});

test("status_level is always one of the six fixed levels", () => {
  const allowed = new Set(["data_insufficient", "stable", "observation", "attention", "high_risk", "urgent"]);
  const outs = [
    run(),
    run({ snapshot: undefined, baseline: {} }),
    run({ events: [sos()] }),
    run({ events: [fall(0.9)] }),
    run({ events: [fall(0.6)] }),
    run({ events: [fall(0.3)] }),
    run({ events: [voiceDizziness(["头晕"]), medReminder()] }),
    run({ snapshot: normalSnapshot({ steps: 3000, sleep_duration: 4 }) }),
    run({ snapshot: normalSnapshot({ steps: 3000 }) }),
  ];
  for (const out of outs) {
    assert.ok(allowed.has(out.status_level), `unexpected level: ${out.status_level}`);
  }
});

test("purity: returns a new object and does not mutate inputs", () => {
  const elder = { elder_id: "ep" };
  const snapshot = normalSnapshot();
  const baseline = normalBaseline();
  const events = [sos()];
  const out = evaluateRisk({ elder, snapshot, baseline, events, now: NOW });
  assert.notEqual(out, elder);
  assert.equal(elder.elder_id, "ep");
  assert.equal(elder.status_level, undefined);
  assert.equal(snapshot.data_quality, 95);
  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, "sos");
});

// ---- determinism (no wall-clock fallback) ---------------------------------

test("determinism: missing now must not read the wall clock nor silently expire an SOS", () => {
  // The engine claims to be pure and deterministic. When `now` is absent the
  // engine must NOT fall back to the wall clock, and a hard event (active SOS)
  // must stay conservatively active instead of being silently expired against
  // an unknown reference time.
  const realDateNow = Date.now;
  try {
    Date.now = () => {
      throw new Error("wall clock must not be read");
    };
    const out = evaluateRisk({
      elder: { elder_id: "e" },
      snapshot: undefined,
      baseline: {},
      events: [sos()],
      now: undefined,
    });
    // Reaching here at all proves Date.now was never consulted. With no
    // snapshot, an expired SOS would surface as data_insufficient; urgent=100
    // proves the SOS was not silently expired.
    assert.equal(out.status_level, "urgent");
    assert.equal(out.risk_score, 100);
  } finally {
    Date.now = realDateNow;
  }
});

test("recommended_action never contains diagnostic/prescription wording for any rule path", () => {
  const forbidden = /确诊|诊断|患有|处方|药量/;
  const dataInsufficient = evaluateRisk({
    elder: { elder_id: "e" },
    snapshot: undefined,
    baseline: {},
    events: [],
    now: NOW,
  });
  const outs = [
    run({ events: [sos()] }), // urgent sos
    run({ events: [fall(0.9)] }), // urgent high fall
    run({ events: [fall(0.6)] }), // high_risk medium fall
    run({ events: [fall(0.3)] }), // observation low fall
    dataInsufficient, // data_insufficient
    run({ events: [voiceDizziness(["头晕"]), medReminder()] }), // high_risk dizziness
    run({ snapshot: normalSnapshot({ steps: 3000, sleep_duration: 4 }) }), // attention
    run({ snapshot: normalSnapshot({ steps: 3000 }) }), // observation single decline
    run({ events: [] }), // stable
  ];
  for (const out of outs) {
    assert.equal(
      forbidden.test(out.recommended_action),
      false,
      `recommended_action leaked forbidden term: ${out.recommended_action}`,
    );
  }
});
