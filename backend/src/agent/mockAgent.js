import { SAFETY_DISCLAIMER, hasProhibitedMedicalLanguage } from "./agentOutputValidator.js";

const statusText = {
  data_insufficient: "数据不足",
  stable: "状态稳定",
  observation: "建议观察",
  attention: "需要关注",
  high_risk: "高风险",
  urgent: "紧急",
};

export function runMockAgent(input, options = {}) {
  const risk = input?.risk_result ?? {};
  const reasons = Array.isArray(risk.key_reasons) ? risk.key_reasons : [];
  const safeReasons = reasons.filter((reason) => !hasProhibitedMedicalLanguage(reason));
  const reasonText = safeReasons.length > 0
    ? safeReasons.join("；")
    : "规则引擎记录到需要照护人员人工复核的信号。";
  const levelText = statusText[risk.status_level] ?? String(risk.status_level ?? "数据不足");
  const prefix = options.fallbackLabel ? "Mock fallback：" : "";

  return {
    status_level: risk.status_level,
    risk_score: risk.risk_score,
    key_reasons: reasons,
    recommended_action: risk.recommended_action,
    caregiver_summary: `${prefix}长者当前为“${levelText}”。${reasonText} 请结合现场情况复核。`,
    family_summary: risk.status_level === "stable"
      ? "长者今日规则结果整体平稳，建议继续常规观察。"
      : "长者今日有需要关注的规则信号，建议照护团队按规则动作核实。",
    institution_summary: `长者今日风险等级为“${levelText}”，建议按规则动作安排照护任务与记录。`,
    safety_disclaimer: SAFETY_DISCLAIMER,
  };
}
