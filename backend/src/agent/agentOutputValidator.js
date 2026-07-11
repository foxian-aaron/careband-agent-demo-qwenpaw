import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { SAFETY_DISCLAIMER } from "../constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceSkillSchemaPath = path.resolve(
  __dirname,
  "../../../.agents/skills/agent-json-summary-validator/references/agent_output.schema.json",
);
const bundledSchemaPath = path.resolve(__dirname, "../schemas/agent_output.schema.json");
const schemaPath = fs.existsSync(workspaceSkillSchemaPath)
  ? workspaceSkillSchemaPath
  : bundledSchemaPath;
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile(schema);

const prohibitedPatterns = [
  /确诊|確診|诊断为|診斷為/u,
  /患有.{0,8}(疾病|病症|病|症)/u,
  /(?:症状|症狀|表现|表現|情况|情況).{0,8}(?:说明|說明|表明|意味着|意味著).{0,20}(?:病|症|炎|癌|综合征|綜合徵)/u,
  /(?:考虑|考慮|判断|判斷|推断|推斷|怀疑|懷疑|疑似)(?:是|为|為)?[^。；\n]{0,20}(?:病|症|炎|癌|综合征|綜合徵)/u,
  /(?:这是|這是|属于|屬於)[^。；\n]{0,20}(?:病|症|炎|癌|综合征|綜合徵)/u,
  /调整药量|調整藥量|增加剂量|增加劑量|减少剂量|減少劑量|停药|停藥/u,
  /(?:建议|建議|应该|應該|可以|需)(?:立即|马上|馬上|按时|按時|每日|每天|睡前|饭后|飯後|餐后|餐後)?(?:服用|口服|使用|注射|加用|改用)/u,
  /开具处方|開具處方|修改处方|修改處方/u,
  /diagnosed\s+with|(?:likely|appears?\s+to\s+be|suspected)\s+.{0,30}(?:disease|disorder|syndrome)|increase\s+(?:the\s+)?dose|reduce\s+(?:the\s+)?dose|stop\s+taking|prescribe|recommend\s+(?:taking|using)/iu,
];

export class AgentOutputValidationError extends Error {
  constructor(errors) {
    super(`Agent output validation failed: ${errors.join("; ")}`);
    this.name = "AgentOutputValidationError";
    this.errors = errors;
  }
}

const formatSchemaErrors = () =>
  (validateSchema.errors ?? []).map((error) => {
    const location = error.instancePath || "$";
    return `${location} ${error.message ?? "is invalid"}`.trim();
  });

const hasSameReasons = (actual, expected) =>
  Array.isArray(actual) &&
  Array.isArray(expected) &&
  actual.length === expected.length &&
  actual.every((reason, index) => reason === expected[index]);

export function validateAgentOutput(output, ruleResult) {
  const errors = [];

  if (!validateSchema(output)) errors.push(...formatSchemaErrors());

  if (output?.safety_disclaimer !== SAFETY_DISCLAIMER) {
    errors.push("safety_disclaimer must use the fixed CareBand disclaimer");
  }

  const safetyText = [
    ...(output?.key_reasons ?? []),
    output?.recommended_action,
    output?.caregiver_summary,
    output?.family_summary,
    output?.institution_summary,
  ]
    .filter(Boolean)
    .join("\n");
  for (const pattern of prohibitedPatterns) {
    if (pattern.test(safetyText)) {
      errors.push(`prohibited diagnosis or prescription language: ${pattern.source}`);
    }
  }

  if (ruleResult) {
    if (output?.status_level !== ruleResult.status_level) {
      errors.push("status_level must exactly match the deterministic rule result");
    }
    if (Number(output?.risk_score) !== Number(ruleResult.risk_score)) {
      errors.push("risk_score must exactly match the deterministic rule result");
    }
    if (!hasSameReasons(output?.key_reasons, ruleResult.key_reasons)) {
      errors.push("key_reasons must exactly match the deterministic rule evidence");
    }
  }

  if (errors.length) throw new AgentOutputValidationError([...new Set(errors)]);
  return output;
}

export const agentOutputJsonSchema = schema;
