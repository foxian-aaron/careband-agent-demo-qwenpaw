import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  SAFETY_DISCLAIMER,
  AgentOutputValidationError,
  parseAndValidateAgentOutput,
  validateAgentOutput,
} from "../src/agent/agentOutputValidator.js";
import { analyzeAgent } from "../src/agent/agentService.js";

const ruleResult = {
  status_level: "high_risk",
  risk_score: 78,
  key_reasons: ["Dizziness and an unconfirmed medication record occurred together."],
  recommended_action: "Ask a caregiver to check the situation and verify the record.",
};
const input = {
  elder_profile: { elder_id: "E001", display_name: "Demo Elder" },
  daily_snapshot: { data_quality: 88, data_source: "Demo Seed" },
  risk_result: ruleResult,
};
const validOutput = {
  ...ruleResult,
  caregiver_summary: "Please verify the record and the current situation.",
  family_summary: "The rule result needs attention; verification is recommended.",
  institution_summary: "E001 is in the high-risk review queue based on the rule result.",
  safety_disclaimer: "本结果仅为照护风险提示，不构成医疗诊断。",
};

const trace = (responseText, id = "chat-1") => ({
  requested_provider: "qwenpaw",
  actual_provider: "qwenpaw",
  provider: "zhipu-cn-codingplan",
  model: "glm-5.2",
  chatId: id,
  sessionId: `careband-runtime:${id}`,
  responseText,
  fallback_used: false,
});

test("bundled and worker schemas stay identical", () => {
  const bundled = JSON.parse(readFileSync(new URL("../src/schemas/agent_output.schema.json", import.meta.url), "utf8"));
  const worker = JSON.parse(readFileSync(new URL("../../.agents/skills/agent-json-summary-validator/references/agent_output.schema.json", import.meta.url), "utf8"));
  assert.deepEqual(worker, bundled);
});

test("valid strict output passes and returns the same object", () => {
  assert.deepEqual(validateAgentOutput(validOutput, ruleResult), validOutput);
  assert.deepEqual(parseAndValidateAgentOutput(JSON.stringify(validOutput), ruleResult), validOutput);
  assert.equal(SAFETY_DISCLAIMER, validOutput.safety_disclaimer);
});

test("non-JSON, prose wrappers, extra fields, and wrong disclaimer are rejected", () => {
  for (const value of [
    "not-json",
    `\`\`\`json\n${JSON.stringify(validOutput)}\n\`\`\``,
    JSON.stringify({ ...validOutput, extra: true }),
    JSON.stringify({ ...validOutput, safety_disclaimer: "For reference only." }),
  ]) {
    assert.throws(() => parseAndValidateAgentOutput(value, ruleResult), AgentOutputValidationError);
  }
});

test("all four deterministic rule fields are immutable", () => {
  const variants = [
    { status_level: "stable" },
    { risk_score: 5 },
    { key_reasons: ["Model changed the reason."] },
    { recommended_action: "Continue observation." },
  ];
  for (const patch of variants) {
    assert.throws(() => validateAgentOutput({ ...validOutput, ...patch }, ruleResult), AgentOutputValidationError);
  }
});

test("diagnosis, prescription, medication change, and dose advice are rejected", () => {
  for (const caregiver_summary of [
    "这是糖尿病。",
    "你得了糖尿病。",
    "You have diabetes.",
    "请吃阿司匹林 100mg。",
    "每天吃阿司匹林 100mg。",
    "请给陈伯开阿司匹林。",
    "请停用阿司匹林。",
    "为陈伯开具降压药处方。",
    "请把降压药改成另一种药。",
    "The elder is diagnosed with diabetes.",
    "Prescribe insulin.",
    "Stop insulin.",
    "Change the medication to insulin.",
    "Increase the medication dose to 100 mg.",
  ]) {
    assert.throws(
      () => validateAgentOutput({ ...validOutput, caregiver_summary }, ruleResult),
      (error) => error instanceof AgentOutputValidationError && error.errors.includes("prohibited medical language"),
    );
  }
  assert.doesNotThrow(() => validateAgentOutput(validOutput, ruleResult));
});

test("one invalid response is retried once with only allowlisted agent inputs", async () => {
  const calls = [];
  const result = await analyzeAgent(input, {
    providerOptions: { runId: "stage8-test" },
    runners: {
      qwenpaw: async (task, options) => {
        calls.push({ task, options });
        return calls.length === 1
          ? trace(JSON.stringify({ status_level: "stable" }), "chat-bad")
          : trace(JSON.stringify(validOutput), "chat-good");
      },
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.runId, "stage8-test-a1");
  assert.equal(calls[1].options.runId, "stage8-test-a2");
  assert.deepEqual(Object.keys(calls[0].task).sort(), ["daily_snapshot", "risk_result"]);
  assert.deepEqual(calls[1].task, calls[0].task);
  assert.equal(result.meta.actual_provider, "qwenpaw");
  assert.equal(result.meta.fallback_used, false);
  assert.equal(result.meta.attempts, 2);
  assert.deepEqual(result.meta.provider_request_ids, ["chat-bad", "chat-good"]);
});

test("two invalid outputs use explicit validated Mock fallback", async () => {
  let calls = 0;
  const result = await analyzeAgent(input, {
    runners: { qwenpaw: async () => { calls += 1; return trace("{}", `chat-${calls}`); } },
  });
  assert.equal(calls, 2);
  assert.equal(result.meta.requested_provider, "qwenpaw");
  assert.equal(result.meta.actual_provider, "mock");
  assert.equal(result.meta.fallback_used, true);
  assert.equal(result.meta.failure_reason, "QWENPAW_OUTPUT_INVALID");
  assert.match(result.agent_result.caregiver_summary, /Mock fallback/);
  assert.deepEqual(
    Object.fromEntries(Object.keys(ruleResult).map((key) => [key, result.agent_result[key]])),
    ruleResult,
  );
  assert.doesNotThrow(() => validateAgentOutput(result.agent_result, ruleResult));
});

test("provider failures and injected codes use fixed non-leaking reasons", async () => {
  for (const error of [
    new Error("secret token at C:\\Users\\demo\\key.txt"),
    Object.assign(new Error("secret"), { code: "QWENPAW_SECRET_TOKEN" }),
  ]) {
    let calls = 0;
    const result = await analyzeAgent(input, {
      runners: { qwenpaw: async () => { calls += 1; throw error; } },
    });
    assert.equal(calls, 2);
    assert.equal(result.meta.actual_provider, "mock");
    assert.equal(result.meta.failure_reason, "QWENPAW_PROVIDER_FAILED");
    assert.doesNotMatch(JSON.stringify(result.meta), /secret token|Users|key\.txt|SECRET_TOKEN/);
  }
});

test("explicit mock never calls QwenPaw and is not labelled fallback", async () => {
  let calls = 0;
  const result = await analyzeAgent(input, {
    provider: "mock",
    runners: { qwenpaw: async () => { calls += 1; } },
  });
  assert.equal(calls, 0);
  assert.equal(result.meta.actual_provider, "mock");
  assert.equal(result.meta.fallback_used, false);
  assert.equal(result.meta.attempts, 0);
  assert.doesNotThrow(() => validateAgentOutput(result.agent_result, ruleResult));
});

test("unsupported providers are rejected instead of silently switched", async () => {
  await assert.rejects(() => analyzeAgent(input, { provider: "openai" }), /AGENT_PROVIDER_UNSUPPORTED/);
});
