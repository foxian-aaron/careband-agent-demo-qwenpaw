import { SAFETY_DISCLAIMER } from "../constants.js";

const symptomKeywords = ["頭暈", "头晕", "胸悶", "胸闷", "跌倒", "不舒服"];
const dizzinessKeywords = ["頭暈", "头晕", "dizzy", "dizziness"];
const resolvedEventStatuses = new Set(["resolved", "cancelled", "dismissed"]);

const hasAnyKeyword = (text = "", keywords) => {
  const normalized = String(text).toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
};

const canonicalEventType = (event) => {
  const aliases = {
    sos_long_press: "sos",
    fall_detected: "fall",
    voice_symptom: "voice",
    medication_reminder: "medication",
    medication_confirmed: "medication",
    medication_missed: "medication",
  };
  return aliases[event.event_type] ?? event.event_type;
};

const eventAction = (event) => {
  if (event.payload?.action) return event.payload.action;
  const legacyActions = {
    sos_long_press: "long_press",
    fall_detected: "detected",
    voice_symptom: "symptom_report",
    medication_reminder: "reminder",
    medication_confirmed: "confirmed",
    medication_missed: "missed",
  };
  return legacyActions[event.event_type] ?? null;
};

const eventText = (event) =>
  [
    event.raw_text,
    event.payload?.note,
    event.payload?.transcript,
    ...(event.payload?.symptom_keywords ?? []),
    ...(event.payload?.symptomKeywords ?? []),
  ]
    .filter(Boolean)
    .join(" ");

const activeEvents = (events) =>
  events.filter((event) => !resolvedEventStatuses.has(event.status));

const eventTime = (event) =>
  Date.parse(event.occurred_at ?? event.timestamp ?? event.created_at ?? "") || 0;

const latestMedicationNeedsConfirmation = (events) => {
  const medicationEvents = events
    .filter((event) => canonicalEventType(event) === "medication")
    .sort((left, right) => eventTime(left) - eventTime(right));
  const latest = medicationEvents.at(-1);
  if (!latest) return false;

  const action = eventAction(latest);
  if (action === "confirmed" || latest.payload?.medication_confirmed === true) return false;
  return (
    ["reminder", "missed", "not_confirmed", "unconfirmed"].includes(action) ||
    latest.payload?.medication_confirmed === false ||
    hasAnyKeyword(eventText(latest), ["未確認", "未确认", "not confirmed"])
  );
};

const fallConfidence = (event) => {
  const raw =
    event.payload?.confidence ??
    event.payload?.fall_confidence ??
    (event.event_type === "fall_detected" ? 1 : 0);
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return 0;
  return numeric > 1 ? Math.min(1, numeric / 100) : Math.max(0, numeric);
};

const buildResult = ({
  elder,
  statusLevel,
  riskScore,
  keyReasons,
  triggeredRules,
  recommendedAction,
  dataQuality,
}) => ({
  elder_id: elder.elder_id,
  status_level: statusLevel,
  risk_score: Math.max(0, Math.min(100, Math.round(riskScore))),
  key_reasons: keyReasons,
  triggered_rules: triggeredRules,
  recommended_action: recommendedAction,
  data_quality: dataQuality,
  safety_disclaimer: SAFETY_DISCLAIMER,
});

export function evaluateRisk({ elder, snapshot, baseline = {}, events = [] }) {
  const currentEvents = activeEvents(events);
  const dataQuality = Number(snapshot?.data_quality ?? 0);
  const sosEvent = currentEvents.find((event) => canonicalEventType(event) === "sos");
  const fallEvent = currentEvents
    .filter((event) => canonicalEventType(event) === "fall")
    .reduce(
      (highest, event) =>
        !highest || fallConfidence(event) >= fallConfidence(highest) ? event : highest,
      null,
    );

  if (sosEvent) {
    return buildResult({
      elder,
      statusLevel: "urgent",
      riskScore: 100,
      keyReasons: ["長者觸發 SOS 求助，需要立即確認現場狀況。"],
      triggeredRules: ["sos => urgent"],
      recommendedAction: "請護工立即查看長者位置與現場狀態，並按機構應急流程處理。",
      dataQuality,
    });
  }

  const confidence = fallEvent ? fallConfidence(fallEvent) : 0;
  if (fallEvent && confidence >= 0.8) {
    return buildResult({
      elder,
      statusLevel: "urgent",
      riskScore: 95,
      keyReasons: [`偵測到高置信度跌倒事件（${Math.round(confidence * 100)}%），需要立即人工確認。`],
      triggeredRules: ["fall confidence >= 0.8 => urgent"],
      recommendedAction: "立即通知護工和機構負責人，並按機構應急流程處理。",
      dataQuality,
    });
  }

  const wearTimeHours = snapshot?.wear_time_hours;
  if (!snapshot || dataQuality < 40 || (typeof wearTimeHours === "number" && wearTimeHours < 6)) {
    const reason = !snapshot
      ? "尚無可用的每日聚合資料，不能判定長者狀態穩定。"
      : typeof wearTimeHours === "number" && wearTimeHours < 6
        ? "今日佩戴時長少於 6 小時，資料不足以判定長者狀態穩定。"
        : "今日數據品質低於 40%，需要先確認設備佩戴或資料同步。";
    return buildResult({
      elder,
      statusLevel: "data_insufficient",
      riskScore: Math.max(0, Math.min(24, dataQuality)),
      keyReasons: [reason],
      triggeredRules: ["missing snapshot, data_quality < 40, or wear_time_hours < 6 => data_insufficient"],
      recommendedAction: "請先確認設備佩戴和資料同步，再結合現場情況判斷是否需要跟進。",
      dataQuality,
    });
  }

  const latestText = currentEvents.map(eventText).join(" ");
  const symptomEvent = [...currentEvents].reverse().find((event) =>
    hasAnyKeyword(eventText(event), symptomKeywords),
  );
  const dizzinessReported = hasAnyKeyword(latestText, dizzinessKeywords);
  const medicationNotConfirmed = latestMedicationNeedsConfirmation(currentEvents);

  const steps = snapshot.steps;
  const sleep = snapshot.sleep_duration;
  const activeMinutes = snapshot.active_minutes;
  const restingHeartRate = snapshot.resting_heart_rate;
  const baselineSteps = Number(baseline.avg_steps_7d ?? 0);
  const baselineSleep = Number(baseline.avg_sleep_7d ?? 0);
  const baselineActive = Number(baseline.avg_active_minutes_7d ?? 0);
  const baselineRestingHr = Number(baseline.resting_hr_baseline ?? 0);

  const stepsDrop =
    typeof steps === "number" && baselineSteps > 0 && steps < baselineSteps * 0.5;
  const sleepDrop =
    typeof sleep === "number" && baselineSleep > 0 && sleep < baselineSleep * 0.75;
  const mildActivityDrop =
    !stepsDrop && typeof steps === "number" && baselineSteps > 0 && steps < baselineSteps * 0.75;
  const mildSleepDrop =
    !sleepDrop && typeof sleep === "number" && baselineSleep > 0 && sleep < baselineSleep * 0.9;
  const restingHeartRateElevated =
    typeof restingHeartRate === "number" &&
    baselineRestingHr > 0 &&
    restingHeartRate - baselineRestingHr >= 12;
  const activeMinutesDrop =
    typeof activeMinutes === "number" &&
    baselineActive > 0 &&
    activeMinutes < baselineActive * 0.6;

  const keyReasons = [];
  const triggeredRules = [];
  let score = 12;

  if (fallEvent && confidence >= 0.5) {
    keyReasons.push(`偵測到中等置信度跌倒事件（${Math.round(confidence * 100)}%），需要儘快人工確認。`);
    triggeredRules.push("fall confidence >= 0.5 => high_risk");
    score = Math.max(score, 82);
  } else if (fallEvent) {
    keyReasons.push(`收到低置信度跌倒信號（${Math.round(confidence * 100)}%），建議巡查複核。`);
    triggeredRules.push("fall confidence < 0.5 => observation");
    score = Math.max(score, 35);
  }

  if (symptomEvent) {
    keyReasons.push(`主訴或事件文字包含照護關鍵詞：「${eventText(symptomEvent)}」。`);
    triggeredRules.push("symptom report => attention at minimum");
    score = Math.max(score, 55);
  }

  if (medicationNotConfirmed && dizzinessReported) {
    keyReasons.push("頭暈反饋與晚藥未確認信號同時出現。");
    triggeredRules.push("dizziness + medication not confirmed => high_risk");
    score = Math.max(score, 86);
  }

  if (stepsDrop && sleepDrop) {
    const stepsDropPercent = Math.round((1 - steps / baselineSteps) * 100);
    const sleepDropPercent = Math.round((1 - sleep / baselineSleep) * 100);
    keyReasons.push(`步數較個人基線下降約 ${stepsDropPercent}%，睡眠較基線下降約 ${sleepDropPercent}%。`);
    triggeredRules.push("steps 50% lower and sleep 25% lower than baseline => attention");
    score = Math.max(score, 62);
  } else if (stepsDrop) {
    const stepsDropPercent = Math.round((1 - steps / baselineSteps) * 100);
    keyReasons.push(`步數較個人基線下降約 ${stepsDropPercent}%。`);
    triggeredRules.push("single strong activity abnormality => observation");
    score = Math.max(score, 38);
  } else if (sleepDrop) {
    const sleepDropPercent = Math.round((1 - sleep / baselineSleep) * 100);
    keyReasons.push(`睡眠較個人基線下降約 ${sleepDropPercent}%。`);
    triggeredRules.push("single strong sleep abnormality => observation");
    score = Math.max(score, 38);
  }

  const mildCount = [
    mildActivityDrop,
    mildSleepDrop,
    restingHeartRateElevated,
    activeMinutesDrop,
  ].filter(Boolean).length;
  if (mildCount === 1 && score < 45) {
    keyReasons.push("有一項輕度偏離個人基線。第一版以靜息心率而非平均心率比較基線。");
    triggeredRules.push("one mild abnormality => observation");
    score = Math.max(score, 30);
  } else if (mildCount >= 2 && score < 45) {
    keyReasons.push("有多項輕度偏離個人基線，建議巡查複核。" );
    triggeredRules.push("multiple mild abnormalities => attention");
    score = Math.max(score, 48);
  }

  if (medicationNotConfirmed && score < 45) {
    keyReasons.push("晚間用藥暫未確認。" );
    triggeredRules.push("medication not confirmed => observation");
    score = Math.max(score, 32);
  }

  let statusLevel = "stable";
  if (score >= 75) statusLevel = "high_risk";
  else if (score >= 45) statusLevel = "attention";
  else if (score >= 25) statusLevel = "observation";

  const recommendedActions = {
    stable: "保持常規照護與日常觀察。",
    observation: "建議護工在例行巡查中關注變化，必要時複核資料。",
    attention: "建議護工今日內查看狀態，並確認休息、活動與用藥情況。",
    high_risk: "請護工立即查看，並觀察不適是否持續；如現場情況需要，按機構流程升級處理。",
  };

  if (keyReasons.length === 0) {
    keyReasons.push("今日關鍵指標接近個人基線。" );
    triggeredRules.push("otherwise stable");
  }

  return buildResult({
    elder,
    statusLevel,
    riskScore: score,
    keyReasons,
    triggeredRules,
    recommendedAction: recommendedActions[statusLevel],
    dataQuality,
  });
}
