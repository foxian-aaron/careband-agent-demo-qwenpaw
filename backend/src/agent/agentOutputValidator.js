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
  /(?:患(?:有|上)?|罹患|得了).{0,12}(?:疾病|病症|病|症|炎|癌|综合征|綜合徵)/u,
  /(?:有|是|为|為)\s*(?:糖尿病|高血压|高血壓|低血压|低血壓|冠心病|心脏病|心臟病|帕金森病|阿尔茨海默病|阿茲海默症|痴呆|失智症|肺炎|癌症|抑郁症|抑鬱症|焦虑症|焦慮症)(?:患者|病人)?/u,
  /(?:症状|症狀|表现|表現|情况|情況).{0,8}(?:说明|說明|表明|意味着|意味著).{0,20}(?:病|症|炎|癌|综合征|綜合徵)/u,
  /(?:考虑|考慮|判断|判斷|推断|推斷|怀疑|懷疑|疑似)(?:是|为|為)?[^。；\n]{0,20}(?:病|症|炎|癌|综合征|綜合徵)/u,
  /(?:这是|這是|属于|屬於)[^。；\n]{0,20}(?:病|症|炎|癌|综合征|綜合徵)/u,
  /调整药量|調整藥量|增加剂量|增加劑量|减少剂量|減少劑量|停药|停藥/u,
  /(?:建议|建議|应该|應該|可以|需)(?:立即|马上|馬上|按时|按時|每日|每天|睡前|饭后|飯後|餐后|餐後)?(?:吃|服用|口服|使用|注射|加用|改用)/u,
  /(?:请|請|应当|應當|应该|應該|需|需要|立即|马上|馬上|每日|每天|每晚|睡前|饭后|飯後|餐后|餐後)\s*(?:吃|服用|口服|注射|加用|改用)/u,
  /(?:^|[。；！!\n])\s*(?:吃|服|服用|口服|注射|加用|改用)\s*(?!(?:饭|飯|早餐|午餐|晚餐|东西|東西|记录|紀錄|情况|情況|状态|狀態|确认|確認))[^。；！!\n]{1,40}/u,
  /(?:服用|口服|注射|加用|改用)[^。；！!\n]{0,40}(?:\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|毫克|克|毫升|片|粒)|每日|每天|每晚|每次|一日|一天)/iu,
  /开具处方|開具處方|修改处方|修改處方/u,
  /\b(?:should|must|needs?\s+to)\s+(?:take|start|begin|use|inject)\b/iu,
  /diagnosed\s+with|\b(?:has|have|suffers?\s+from)\s+(?:[a-z][a-z'-]*\s+){0,5}(?:disease|disorder|syndrome|cancer|dementia|diabetes|hypertension|hypotension|pneumonia|infection|stroke|asthma|parkinson(?:'s)?|alzheimer(?:'s)?)\b|\b(?:is|are)\s+(?:diabetic|hypertensive)\b|(?:likely|appears?\s+to\s+be|suspected)\s+.{0,30}(?:disease|disorder|syndrome)|increase\s+(?:the\s+)?dose|reduce\s+(?:the\s+)?dose|stop\s+taking|prescribe|recommend\s+(?:taking|using)/iu,
  /(?:^|[.!?;\n])\s*(?:take|start|begin|use|inject)\s+(?!(?:action|care|steps?|note|precautions?|follow-up|review|a\s+break|the\s+(?:care|emergency)\s+(?:process|protocol))\b)[a-z][^.!?;\n]{0,60}/imu,
  /(?:^|[.!?;\n])\s*(?:take|start|begin|use|inject)\s+[^.!?;\n]{0,60}(?:\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|tablets?|capsules?)|once|twice|daily|every\s+(?:day|night|morning|evening))/imu,
];

export const hasProhibitedMedicalLanguage = (text) =>
  prohibitedPatterns.some((pattern) => pattern.test(String(text ?? "")));

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
    output?.recommended_action,
    output?.caregiver_summary,
    output?.family_summary,
    output?.institution_summary,
  ]
    .filter(Boolean)
    .join("\n");
  if (hasProhibitedMedicalLanguage(safetyText)) {
    errors.push("prohibited diagnosis or prescription language");
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
    if (output?.recommended_action !== ruleResult.recommended_action) {
      errors.push("recommended_action must exactly match the deterministic rule action");
    }
  }

  if (errors.length) throw new AgentOutputValidationError([...new Set(errors)]);
  return output;
}

export const agentOutputJsonSchema = schema;
