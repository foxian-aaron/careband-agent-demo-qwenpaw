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

const validRuleResult = {
  status_level: "high_risk",
  risk_score: 78,
  key_reasons: validOutput.key_reasons,
  recommended_action: validOutput.recommended_action,
};

test("Agent output accepts the PRD six-level risk contract", () => {
  const result = validateAgentOutput(validOutput, validRuleResult);

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
          recommended_action: validOutput.recommended_action,
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
            recommended_action: validOutput.recommended_action,
          },
        ),
      /prohibited diagnosis or prescription language/,
    );
  }
});

test("Agent output rejects direct diagnosis and imperative prescription language", () => {
  for (const caregiverSummary of [
    "The elder has Parkinson disease.",
    "The elder has diabetes.",
    "The elder has hypertension.",
    "Take aspirin 100 mg every day.",
    "Take aspirin.",
    "Start aspirin.",
    "陈伯患有帕金森病。",
    "陈伯患帕金森病。",
    "陈伯有糖尿病。",
    "陈伯是糖尿病患者。",
    "请每天服用阿司匹林 100 mg。",
    "吃阿司匹林。",
    "陈伯需要吃阿司匹林。",
  ]) {
    assert.throws(
      () =>
        validateAgentOutput(
          { ...validOutput, caregiver_summary: caregiverSummary },
          {
            status_level: "high_risk",
            risk_score: 78,
            key_reasons: validOutput.key_reasons,
            recommended_action: validOutput.recommended_action,
          },
        ),
      /prohibited diagnosis or prescription language/,
    );
  }
});

test("rule-owned evidence may quote a medical claim without turning summaries into a diagnosis", () => {
  const quotedReason = "User report: diagnosed with Parkinson disease and dizzy.";
  const output = { ...validOutput, key_reasons: [quotedReason] };

  assert.doesNotThrow(() =>
    validateAgentOutput(output, {
      status_level: "high_risk",
      risk_score: 78,
      key_reasons: [quotedReason],
      recommended_action: validOutput.recommended_action,
    }),
  );
});

test("safe care observations using has language remain valid", () => {
  for (const caregiverSummary of [
    "The elder has lower activity today; the care team will follow up.",
    "She has a caregiver visit scheduled.",
    "Chen has received support from the care team.",
  ]) {
    assert.doesNotThrow(() =>
      validateAgentOutput({ ...validOutput, caregiver_summary: caregiverSummary }, validRuleResult),
    );
  }
});

test("safe Chinese care observations are not mistaken for diagnosis or prescription", () => {
  for (const caregiverSummary of [
    "陈伯有一项活动下降，护工会跟进。",
    "请护工确认陈伯是否吃过晚饭。",
    "晚药服用记录尚未确认，请护工核对。",
    "陈伯是本次演示的照护对象。",
  ]) {
    assert.doesNotThrow(() =>
      validateAgentOutput({ ...validOutput, caregiver_summary: caregiverSummary }, validRuleResult),
    );
  }
});

test("Agent output cannot rewrite the deterministic recommended action", () => {
  assert.throws(
    () =>
      validateAgentOutput(
        { ...validOutput, recommended_action: "Different but safe follow-up." },
        {
          status_level: "high_risk",
          risk_score: 78,
          key_reasons: validOutput.key_reasons,
          recommended_action: validOutput.recommended_action,
        },
      ),
    /recommended_action must exactly match/,
  );
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
          recommended_action: validOutput.recommended_action,
        },
      ),
    /status_level must exactly match|risk_score must exactly match/,
  );
});
