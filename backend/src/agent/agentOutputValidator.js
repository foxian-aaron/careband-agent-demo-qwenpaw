import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";

export const SAFETY_DISCLAIMER = "本结果仅为照护风险提示，不构成医疗诊断。";

const schema = JSON.parse(
  readFileSync(new URL("../schemas/agent_output.schema.json", import.meta.url), "utf8"),
);
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

const prohibitedPatterns = [
  /确诊|確診|诊断为|診斷為|患有|罹患|diagnosed\s+with/iu,
  /(?:这是|這是|属于|屬於|考虑为|考慮為|怀疑|懷疑|疑似).{0,20}(?:病|症|炎|癌|综合征|綜合徵)/iu,
  /(?:你|您|他|她|长者|長者|老人|患者).{0,4}(?:得了|有|是).{0,16}(?:病|症|炎|癌|综合征|綜合徵)/iu,
  /\b(?:you|he|she|the\s+elder|the\s+patient)\s+(?:has|have|is)\s+.{0,30}(?:diabetes|disease|cancer|syndrome)\b/iu,
  /(?:开具|開具|给出|給出|提供).{0,20}(?:处方|處方)/iu,
  /(?:请|請|建议|建議)?\s*(?:给|給|为|為).{0,12}(?:开|開|开具|開具).{0,20}(?:药|藥|阿司匹林)/iu,
  /(?:请|請|建议|建議)?\s*(?:把|将|將).{0,20}(?:药|藥).{0,12}(?:改成|改为|改為|换成|換成|更换|更換)/iu,
  /(?:建议|建議|请|請|应该|應該|需要|立即)\s*(?:吃|服用|口服|注射|停药|停藥|停用|加用|改用)/iu,
  /(?:每天|每日|一天|一日).{0,8}(?:吃|服用|口服|注射).{0,30}(?:药|藥|阿司匹林|\d+\s*(?:mg|ml|g))/iu,
  /(?:调整|調整|增加|减少|減少).{0,8}(?:剂量|劑量|药量|藥量|dose)/iu,
  /\b(?:take|start|stop(?:\s+taking)?|inject|prescribe|increase|reduce|change|switch).{0,40}(?:aspirin|insulin|medication|medicine|drug|dose|\d+\s*(?:mg|ml|g))\b/iu,
];

export const hasProhibitedMedicalLanguage = (text) =>
  prohibitedPatterns.some((pattern) => pattern.test(String(text ?? "")));

export class AgentOutputValidationError extends Error {
  constructor(errors) {
    super("AGENT_OUTPUT_INVALID");
    this.name = "AgentOutputValidationError";
    this.code = "QWENPAW_OUTPUT_INVALID";
    this.errors = [...new Set(errors)];
  }
}

const schemaErrors = () =>
  (validateSchema.errors ?? []).map((error) => {
    const location = error.instancePath || "$";
    return `${location} ${error.keyword} ${error.message ?? "invalid"}`;
  });

const sameReasons = (actual, expected) =>
  Array.isArray(actual) &&
  Array.isArray(expected) &&
  actual.length === expected.length &&
  actual.every((reason, index) => reason === expected[index]);

export function validateAgentOutput(output, ruleResult) {
  const errors = [];
  if (!validateSchema(output)) errors.push(...schemaErrors());

  if (!ruleResult || typeof ruleResult !== "object" || Array.isArray(ruleResult)) {
    errors.push("risk_result is required");
  } else {
    if (output?.status_level !== ruleResult.status_level) {
      errors.push("status_level must exactly match risk_result");
    }
    if (output?.risk_score !== ruleResult.risk_score) {
      errors.push("risk_score must exactly match risk_result");
    }
    if (!sameReasons(output?.key_reasons, ruleResult.key_reasons)) {
      errors.push("key_reasons must exactly match risk_result");
    }
    if (output?.recommended_action !== ruleResult.recommended_action) {
      errors.push("recommended_action must exactly match risk_result");
    }
  }

  const generatedText = [
    output?.recommended_action,
    output?.caregiver_summary,
    output?.family_summary,
    output?.institution_summary,
  ].filter(Boolean).join("\n");
  if (hasProhibitedMedicalLanguage(generatedText)) {
    errors.push("prohibited medical language");
  }

  if (errors.length > 0) throw new AgentOutputValidationError(errors);
  return output;
}

export function parseAndValidateAgentOutput(responseText, ruleResult) {
  if (typeof responseText !== "string") {
    throw new AgentOutputValidationError(["response must be one JSON object"]);
  }
  let output;
  try {
    output = JSON.parse(responseText);
  } catch {
    throw new AgentOutputValidationError(["response must be one JSON object"]);
  }
  return validateAgentOutput(output, ruleResult);
}

export const agentOutputJsonSchema = schema;
