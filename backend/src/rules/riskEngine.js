// backend/src/rules/riskEngine.js
//
// CareBand Stage 4 — deterministic six-level care risk engine.
//
// Pure function: no third-party dependencies, no classes, no configuration
// framework, no database access, no logging. The engine never trusts
// client-supplied risk fields (status_level / risk_score / key_reasons /
// recommended_action); it always recomputes them from structured inputs.
//
// Levels (fixed): data_insufficient | stable | observation | attention | high_risk | urgent

const SAFETY_DISCLAIMER = "本结果仅为照护风险提示，不构成医疗诊断。";

// status values that mean an event is no longer in effect.
const RESOLVED_STATUSES = new Set(["resolved", "cancelled", "dismissed"]);

// minimal canonical event_type aliases.
const EVENT_TYPE_ALIASES = {
  sos_long_press: "sos",
  fall_detected: "fall",
  voice_symptom: "voice",
  medication_reminder: "medication",
  medication_confirmed: "medication",
  medication_missed: "medication",
};

// structured dizziness keywords (no raw-text scanning).
const DIZZINESS_TERMS = ["dizzy", "dizziness", "头晕"];

/**
 * Resolve a canonical event type from its raw event_type, applying the
 * minimal alias map. Unknown / non-string types are kept as-is (null if not a
 * string) so callers can still match explicit types like "sos" or "fall".
 */
function canonicalEventType(type) {
  if (typeof type !== "string") return null;
  if (Object.prototype.hasOwnProperty.call(EVENT_TYPE_ALIASES, type)) {
    return EVENT_TYPE_ALIASES[type];
  }
  return type;
}

/**
 * Convert a temporal value (Date | number epoch-ms | ISO string | integer
 * string) to epoch milliseconds. Returns NaN when the value is absent or
 * unparseable; callers decide how to treat that.
 */
function toEpochMs(value) {
  if (value === null || value === undefined) return NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return NaN;
    if (/^[+-]?\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : NaN;
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

/** First parseable timestamp among occurred_at / timestamp / created_at. */
function eventTimestampMs(ev) {
  for (const key of ["occurred_at", "timestamp", "created_at"]) {
    const ms = toEpochMs(ev ? ev[key] : undefined);
    if (Number.isFinite(ms)) return ms;
  }
  return NaN;
}

/** Clamp a normalised confidence into [0, 1]. */
function clamp01(c) {
  if (!Number.isFinite(c)) return 0;
  if (c < 0) return 0;
  if (c > 1) return 1;
  return c;
}

/**
 * Normalise fall confidence. Accepts 0-1 or 0-100 scales (any value > 1 is
 * treated as a percentage and divided by 100), then clamps to [0, 1].
 * Non-numeric / missing values become 0 (no fall signal).
 */
function normalizeConfidence(raw) {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  const scaled = raw > 1 ? raw / 100 : raw;
  return clamp01(scaled);
}

/**
 * Detect a structured dizziness signal from payload.symptom_keywords or
 * payload.symptomKeywords. Never inspects free-form text fields.
 */
function hasStructuredDizziness(payload) {
  if (!payload || typeof payload !== "object") return false;
  const keywords = Array.isArray(payload.symptom_keywords)
    ? payload.symptom_keywords
    : Array.isArray(payload.symptomKeywords)
      ? payload.symptomKeywords
      : null;
  if (!keywords) return false;
  for (const kw of keywords) {
    if (typeof kw !== "string") continue;
    const lower = kw.toLowerCase();
    for (const term of DIZZINESS_TERMS) {
      if (lower.includes(term.toLowerCase())) return true;
    }
  }
  return false;
}

/**
 * An event is "active" (counts toward risk) unless it is resolved/cancelled/
 * dismissed, or it carries a parseable expires_at that is at or before `now`.
 */
function isActiveEvent(ev, nowMs) {
  if (!ev || typeof ev !== "object") return false;
  if (typeof ev.status === "string" && RESOLVED_STATUSES.has(ev.status)) return false;
  if (ev.expires_at !== undefined && ev.expires_at !== null) {
    const expMs = toEpochMs(ev.expires_at);
    if (Number.isFinite(expMs) && expMs <= nowMs) return false;
  }
  return true;
}

/**
 * Among medication events, return whether the chronologically latest one is
 * confirmed. Confirmation = payload.action === "confirmed" OR
 * payload.medication_confirmed === true; anything else is unconfirmed.
 */
function isLatestMedicationConfirmed(medications) {
  if (medications.length === 0) return null; // no medication event at all
  let latest = medications[0];
  let latestMs = eventTimestampMs(medications[0]);
  for (let i = 1; i < medications.length; i++) {
    const ms = eventTimestampMs(medications[i]);
    // events without a parseable timestamp sort oldest, so dated events win.
    const a = Number.isFinite(ms) ? ms : -Infinity;
    const b = Number.isFinite(latestMs) ? latestMs : -Infinity;
    if (a > b) {
      latest = medications[i];
      latestMs = ms;
    }
  }
  const p = latest && latest.payload;
  return Boolean(p && (p.action === "confirmed" || p.medication_confirmed === true));
}

function buildResult({ elderId, statusLevel, riskScore, keyReasons, triggeredRules, recommendedAction, dataQuality }) {
  return {
    elder_id: elderId,
    status_level: statusLevel,
    risk_score: riskScore,
    key_reasons: keyReasons,
    triggered_rules: triggeredRules,
    recommended_action: recommendedAction,
    data_quality: dataQuality,
    safety_disclaimer: SAFETY_DISCLAIMER,
  };
}

/**
 * Evaluate care risk for one elder.
 *
 * @param {object}  opts
 * @param {object}  [opts.elder]            - must carry elder_id
 * @param {object}  [opts.snapshot]         - snake_case daily aggregation
 * @param {object}  [opts.baseline={}]      - 7-day baselines
 * @param {Array}   [opts.events=[]]        - canonical events
 * @param {*}       [opts.now]              - fixed reference time (tests pass ISO)
 * @returns {object} fresh risk result (see SAFETY_DISCLAIMER + fields above)
 */
export function evaluateRisk({ elder, snapshot, baseline = {}, events = [], now } = {}) {
  const safeBaseline = baseline && typeof baseline === "object" ? baseline : {};

  // Parse only the caller-supplied `now`. When it is missing/invalid, leave
  // nowMs non-finite (NaN) instead of falling back to the wall clock: the
  // engine must stay pure/deterministic. isActiveEvent then treats any
  // finite expires_at as not-yet-expired (expMs <= NaN is false), so hard
  // events (SOS / fall) remain conservatively active; non-event rules do not
  // depend on nowMs.
  const nowMs = toEpochMs(now);

  const elderId = elder && elder.elder_id !== undefined ? elder.elder_id : null;

  const dataQuality =
    snapshot && typeof snapshot.data_quality === "number" && Number.isFinite(snapshot.data_quality)
      ? snapshot.data_quality
      : null;

  // --- gather active signals -------------------------------------------------
  const active = [];
  for (const ev of Array.isArray(events) ? events : []) {
    if (isActiveEvent(ev, nowMs)) active.push(ev);
  }

  let hasSos = false;
  let maxFallConfidence = -1; // -1 = no active fall signal
  let hasDizziness = false;
  const medications = [];

  for (const ev of active) {
    const type = canonicalEventType(ev.event_type);
    if (type === "sos") hasSos = true;
    if (type === "fall") {
      const c = normalizeConfidence(ev.payload && ev.payload.confidence);
      if (c > maxFallConfidence) maxFallConfidence = c;
    }
    if (hasStructuredDizziness(ev.payload)) hasDizziness = true;
    if (type === "medication") medications.push(ev);
  }

  // --- Rule 1: active SOS ----------------------------------------------------
  if (hasSos) {
    return buildResult({
      elderId,
      statusLevel: "urgent",
      riskScore: 100,
      keyReasons: ["检测到活跃 SOS 求救信号"],
      triggeredRules: ["sos_active"],
      recommendedAction: "立即联系老人核实情况，必要时联系紧急联系人",
      dataQuality,
    });
  }

  // --- Rules 2-4: falls (hard events, evaluated before data insufficiency) ---
  if (maxFallConfidence >= 0.8) {
    return buildResult({
      elderId,
      statusLevel: "urgent",
      riskScore: 95,
      keyReasons: ["检测到高置信跌倒事件"],
      triggeredRules: ["fall_high_confidence"],
      recommendedAction: "立即核实跌倒情况并联系老人",
      dataQuality,
    });
  }
  if (maxFallConfidence >= 0.5) {
    return buildResult({
      elderId,
      statusLevel: "high_risk",
      riskScore: 82,
      keyReasons: ["检测到中置信跌倒事件"],
      triggeredRules: ["fall_medium_confidence"],
      recommendedAction: "尽快联系老人核实跌倒情况",
      dataQuality,
    });
  }
  if (maxFallConfidence > 0) {
    return buildResult({
      elderId,
      statusLevel: "observation",
      riskScore: 35,
      keyReasons: ["检测到低置信跌倒事件"],
      triggeredRules: ["fall_low_confidence"],
      recommendedAction: "关注老人近期活动与跌倒风险",
      dataQuality,
    });
  }

  // --- Rule 5: data insufficiency (only when no hard event) ------------------
  const insufficient =
    !snapshot ||
    (typeof snapshot.data_quality === "number" && snapshot.data_quality < 40) ||
    (typeof snapshot.wear_time_hours === "number" &&
      Number.isFinite(snapshot.wear_time_hours) &&
      snapshot.wear_time_hours < 6);
  if (insufficient) {
    const dq = dataQuality === null ? 0 : dataQuality;
    return buildResult({
      elderId,
      statusLevel: "data_insufficient",
      riskScore: Math.min(24, Math.floor(dq * 0.24)),
      keyReasons: ["佩戴或数据质量不足"],
      triggeredRules: ["data_insufficient"],
      recommendedAction: "请确认设备佩戴与数据上传情况",
      dataQuality,
    });
  }

  // --- Rule 6: structured dizziness + latest medication still unconfirmed ----
  if (hasDizziness && medications.length > 0 && isLatestMedicationConfirmed(medications) === false) {
    return buildResult({
      elderId,
      statusLevel: "high_risk",
      riskScore: 86,
      keyReasons: ["结构化头晕信号且最近用药未确认"],
      triggeredRules: ["dizziness_medication_unconfirmed"],
      recommendedAction: "提醒确认用药情况并尽快联系老人",
      dataQuality,
    });
  }

  // --- Rules 7-9: activity / sleep anomalies --------------------------------
  const steps = snapshot.steps;
  const sleep = snapshot.sleep_duration;
  const avgSteps = safeBaseline.avg_steps_7d;
  const avgSleep = safeBaseline.avg_sleep_7d;

  const stepsAnomaly =
    typeof avgSteps === "number" &&
    avgSteps > 0 &&
    typeof steps === "number" &&
    Number.isFinite(steps) &&
    steps < avgSteps * 0.5;
  const sleepAnomaly =
    typeof avgSleep === "number" &&
    avgSleep > 0 &&
    typeof sleep === "number" &&
    Number.isFinite(sleep) &&
    sleep < avgSleep * 0.75;

  if (stepsAnomaly && sleepAnomaly) {
    return buildResult({
      elderId,
      statusLevel: "attention",
      riskScore: 62,
      keyReasons: ["步数与睡眠同时显著下降"],
      triggeredRules: ["activity_sleep_dual_decline"],
      recommendedAction: "关注老人近期活动量与睡眠情况",
      dataQuality,
    });
  }
  if (stepsAnomaly || sleepAnomaly) {
    return buildResult({
      elderId,
      statusLevel: "observation",
      riskScore: 38,
      keyReasons: ["单项活动或睡眠指标异常"],
      triggeredRules: ["single_anomaly"],
      recommendedAction: "留意老人单项指标变化",
      dataQuality,
    });
  }

  // --- Rule 9: stable --------------------------------------------------------
  return buildResult({
    elderId,
    statusLevel: "stable",
    riskScore: 12,
    keyReasons: ["指标整体平稳"],
    triggeredRules: ["stable"],
    recommendedAction: "维持日常照护",
    dataQuality,
  });
}
