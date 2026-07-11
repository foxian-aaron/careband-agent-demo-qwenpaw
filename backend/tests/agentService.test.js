import assert from "node:assert/strict";
import test from "node:test";

import { SAFETY_DISCLAIMER } from "../src/constants.js";
import { analyzeAgent } from "../src/agent/agentService.js";
import { buildOpenAiPromptInput } from "../src/agent/openaiAgent.js";

const input = {
  elder_profile: { elder_id: "E001", name: "陈伯" },
  daily_snapshot: { elder_id: "E001", data_source: "Demo Seed", data_quality: 88 },
  baseline: { avg_steps_7d: 2100 },
  events: [],
  risk_result: {
    status_level: "high_risk",
    risk_score: 78,
    key_reasons: ["头晕反馈与晚药未确认同时出现。"],
    recommended_action: "请护工立即查看。",
  },
};

test("invalid real Agent output retries once then uses labelled deterministic fallback", async () => {
  let attempts = 0;
  const response = await analyzeAgent(input, {
    provider: "qwenpaw",
    runners: {
      qwenpaw: async () => {
        attempts += 1;
        return {
          result: {
            status_level: "stable",
            risk_score: 5,
            key_reasons: ["模型自行改写风险。"],
            recommended_action: "继续观察。",
            caregiver_summary: "状态稳定。",
            family_summary: "状态稳定。",
            institution_summary: "状态稳定。",
            safety_disclaimer: SAFETY_DISCLAIMER,
          },
          rawResponse: "{}",
        };
      },
    },
  });

  assert.equal(attempts, 2);
  assert.equal(response.meta.provider, "mock");
  assert.equal(response.meta.requested_provider, "qwenpaw");
  assert.equal(response.meta.fallback_used, true);
  assert.equal(response.agent_result.status_level, "high_risk");
  assert.equal(response.agent_result.risk_score, 78);
  assert.match(response.agent_result.caregiver_summary, /Mock fallback/);
});

test("OpenAI repair retries include the previous validation errors in the prompt", () => {
  const prompt = JSON.parse(
    buildOpenAiPromptInput(input, {
      repairErrors: ["status_level must exactly match the deterministic rule result"],
    }),
  );

  assert.deepEqual(prompt.validation_repair_errors, [
    "status_level must exactly match the deterministic rule result",
  ]);
});

test("provider fallback warnings do not expose local diagnostic paths", async () => {
  const response = await analyzeAgent(input, {
    provider: "qwenpaw",
    runners: {
      qwenpaw: async () => {
        throw new Error(
          "MODEL_UNAUTHORIZED_ACCESS: token expired\n(Details: C:\\Users\\demo\\AppData\\Local\\Temp\\provider.json)",
        );
      },
    },
  });

  assert.equal(response.meta.fallback_used, true);
  assert.match(response.meta.warning, /token expired/);
  assert.doesNotMatch(response.meta.warning, /C:\\\\Users|AppData|provider\.json/);
});

test("provider fallback warnings redact bearer tokens and credential-like values", async () => {
  const response = await analyzeAgent(input, {
    provider: "qwenpaw",
    runners: {
      qwenpaw: async () => {
        throw new Error(
          "request failed: Bearer cb_test_REVIEW_TOKEN_123456789; api_key=review-secret-value; DASHSCOPE_ACCESS_KEY_ID='review-access-key'",
        );
      },
    },
  });

  assert.equal(response.meta.fallback_used, true);
  assert.match(response.meta.warning, /Bearer \[redacted\]/);
  assert.match(response.meta.warning, /api_key=\[redacted\]/i);
  assert.match(response.meta.warning, /DASHSCOPE_ACCESS_KEY_ID=\[redacted\]/i);
  assert.doesNotMatch(
    response.meta.warning,
    /cb_test_REVIEW_TOKEN|review-secret-value|review-access-key/,
  );
});
