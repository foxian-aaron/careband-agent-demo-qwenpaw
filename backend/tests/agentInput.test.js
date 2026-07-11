import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentInput } from "../src/agent/agentInput.js";

test("Agent input keeps daily aggregates and removes raw health and precise location data", () => {
  const payload = buildAgentInput({
    elder: {
      elder_id: "E001",
      name: "陈伯",
      chronic_conditions: ["private"],
      apple_id: "private@example.com",
    },
    snapshot: {
      elder_id: "E001",
      date: "2026-07-11",
      data_source: "Demo Seed",
      data_quality: 88,
      steps: 900,
      heart_rate_avg: 82,
      raw_xml: "<HealthData />",
    },
    baseline: { avg_steps_7d: 2100, internal_note: "private" },
    events: [
      {
        event_id: "evt-1",
        event_type: "location",
        occurred_at: "2026-07-11T10:00:00+08:00",
        severity_hint: "watch",
        payload: {
          action: "geofence_exit",
          safe_zone_status: "outside",
          latitude: 22.19,
          longitude: 113.54,
          precise_address: "private",
        },
      },
    ],
    riskResult: {
      status_level: "attention",
      risk_score: 55,
      key_reasons: ["长者离开授权安全区域。"],
      recommended_action: "请护工确认区域状态。",
    },
  });

  const serialized = JSON.stringify(payload);
  assert.equal(payload.daily_snapshot.steps, 900);
  assert.equal(payload.events[0].payload.safe_zone_status, "outside");
  assert.equal(payload.events[0].payload.action, "geofence_exit");
  assert.doesNotMatch(serialized, /raw_xml|HealthData|apple_id|latitude|longitude|precise_address|chronic_conditions|internal_note/);
});
