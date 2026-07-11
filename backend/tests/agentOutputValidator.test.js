import assert from "node:assert/strict";
import test from "node:test";

import { SAFETY_DISCLAIMER } from "../src/constants.js";
import { validateAgentOutput } from "../src/agent/agentOutputValidator.js";

const validOutput = {
  status_level: "high_risk",
  risk_score: 78,
  key_reasons: ["头晕反馈与晚药未确认同时出现。"],
  recommended_action: "请护工立即查看并记录现场情况。",
  caregiver_summary: "陈伯需要优先查看，请核对晚药与当前状态。",
  family_summary: "陈伯今天有需要关注的变化，照护团队已收到提示。",
  institution_summary: "陈伯已进入高风险待处理队列。",
  safety_disclaimer: SAFETY_DISCLAIMER,
};

test("Agent output accepts the PRD six-level risk contract", () => {
  const result = validateAgentOutput(validOutput, {
    status_level: "high_risk",
    risk_score: 78,
    key_reasons: validOutput.key_reasons,
  });

  assert.deepEqual(result, validOutput);
});

test("Agent output rejects diagnosis and prescription language", () => {
  assert.throws(
    () =>
      validateAgentOutput(
        {
          ...validOutput,
          caregiver_summary: "陈伯已确诊某疾病，建议立即增加剂量。",
        },
        {
          status_level: "high_risk",
          risk_score: 78,
          key_reasons: validOutput.key_reasons,
        },
      ),
    /prohibited diagnosis or prescription language/,
  );
});

test("Agent output rejects indirect diagnosis and medication recommendations", () => {
  for (const caregiverSummary of [
    "陈伯的症状说明是帕金森病。",
    "建议服用阿司匹林。",
    "考虑为阿尔茨海默病。",
  ]) {
    assert.throws(
      () =>
        validateAgentOutput(
          { ...validOutput, caregiver_summary: caregiverSummary },
          {
            status_level: "high_risk",
            risk_score: 78,
            key_reasons: validOutput.key_reasons,
          },
        ),
      /prohibited diagnosis or prescription language/,
    );
  }
});

test("Agent output cannot override the deterministic risk result", () => {
  assert.throws(
    () =>
      validateAgentOutput(
        { ...validOutput, status_level: "stable", risk_score: 5 },
        {
          status_level: "high_risk",
          risk_score: 78,
          key_reasons: validOutput.key_reasons,
        },
      ),
    /status_level must exactly match|risk_score must exactly match/,
  );
});
