const pick = (source, keys) =>
  Object.fromEntries(
    keys.filter((key) => source && source[key] !== undefined).map((key) => [key, source[key]]),
  );

const snapshotFields = [
  "elder_id",
  "date",
  "data_source",
  "heart_rate_avg",
  "resting_heart_rate",
  "steps",
  "active_minutes",
  "sleep_duration",
  "wear_time_hours",
  "data_quality",
  "created_at",
];

const baselineFields = [
  "avg_steps_7d",
  "avg_sleep_7d",
  "avg_active_minutes_7d",
  "resting_hr_baseline",
  "baseline_confidence",
  "baseline_label",
  "usable_days",
];

const eventPayloadFields = [
  "action",
  "button_pattern",
  "button_press_seconds",
  "click_count",
  "symptom_keywords",
  "transcript_summary",
  "medication_confirmed",
  "medication_name",
  "safe_zone_status",
  "fall_confidence",
  "no_response_seconds",
  "activity_drop_percent",
  "night_wakeup_count",
  "device_id",
  "battery_pct",
  "note",
];

const riskFields = [
  "status_level",
  "risk_score",
  "key_reasons",
  "triggered_rules",
  "recommended_action",
  "data_quality",
  "safety_disclaimer",
];

export function buildAgentInput({ elder, snapshot, baseline, events = [], riskResult }) {
  return {
    task_type: "careband_elder_state_summary",
    elder_profile: {
      elder_id: elder.elder_id,
      name: elder.name,
      subject_kind: elder.subject_kind ?? "scripted_demo",
      care_context: "CareBand competition demo; human verification required",
    },
    daily_snapshot: pick(snapshot ?? {}, snapshotFields),
    baseline: pick(baseline ?? {}, baselineFields),
    events: events.map((event) => ({
      ...pick(event, [
        "event_id",
        "event_type",
        "source",
        "occurred_at",
        "received_at",
        "severity_hint",
        "data_quality",
        "status",
      ]),
      payload: pick(event.payload ?? {}, eventPayloadFields),
    })),
    risk_result: pick(riskResult ?? {}, riskFields),
    roles: ["caregiver", "family", "institution"],
    tools_allowed: [],
    output_schema: "agent_output.schema.json",
    fallback: { enabled: true, strategy: "deterministic_mock_summary" },
  };
}
