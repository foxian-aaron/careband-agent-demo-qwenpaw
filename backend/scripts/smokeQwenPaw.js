import { SAFETY_DISCLAIMER } from "../src/constants.js";
import { analyzeAgent } from "../src/agent/agentService.js";

const reasons = [
  "头晕反馈与晚药未确认同时出现。",
  "今日步数较个人七日基线明显下降。",
];

const input = {
  task_type: "careband_elder_state_summary",
  elder_profile: {
    elder_id: "E001",
    name: "陈伯",
    subject_kind: "scripted_demo",
    care_context: "CareBand competition demo; no real elder data",
  },
  daily_snapshot: {
    elder_id: "E001",
    date: "2026-07-11",
    data_source: "Demo Seed",
    heart_rate_avg: 82,
    resting_heart_rate: 76,
    steps: 820,
    active_minutes: 18,
    sleep_duration: 4.8,
    wear_time_hours: 15,
    data_quality: 88,
  },
  baseline: {
    avg_steps_7d: 2150,
    avg_sleep_7d: 6.5,
    avg_active_minutes_7d: 46,
    resting_hr_baseline: 72,
    usable_days: 7,
  },
  events: [
    {
      event_id: "SMOKE-VOICE-E001",
      event_type: "voice",
      source: "dashboard",
      occurred_at: "2026-07-11T20:10:00+08:00",
      received_at: "2026-07-11T20:10:01+08:00",
      severity_hint: "urgent",
      data_quality: "high",
      status: "open",
      payload: { symptom_keywords: ["头晕"], transcript_summary: "长者反馈有点头晕。" },
    },
    {
      event_id: "SMOKE-MED-E001",
      event_type: "medication",
      source: "dashboard",
      occurred_at: "2026-07-11T20:00:00+08:00",
      received_at: "2026-07-11T20:00:01+08:00",
      severity_hint: "watch",
      data_quality: "high",
      status: "open",
      payload: { medication_name: "晚药", medication_confirmed: false },
    },
  ],
  risk_result: {
    status_level: "high_risk",
    risk_score: 78,
    key_reasons: reasons,
    triggered_rules: ["dizziness + medication not confirmed => high_risk"],
    recommended_action: "请护工立即查看，确认当前状态和晚药记录，并记录处理结果。",
    data_quality: 88,
    safety_disclaimer: SAFETY_DISCLAIMER,
  },
};

const response = await analyzeAgent(input, { provider: "qwenpaw" });
console.log(JSON.stringify({ meta: response.meta, agent_result: response.agent_result }, null, 2));

if (response.meta.provider !== "qwenpaw") process.exitCode = 1;
