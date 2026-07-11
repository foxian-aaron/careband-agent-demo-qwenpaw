import { SAFETY_DISCLAIMER } from "../constants.js";
import { hasProhibitedMedicalLanguage } from "./agentOutputValidator.js";

const statusText = {
  stable: "状态稳定",
  observation: "建议观察",
  attention: "需要关注",
  high_risk: "高风险",
  urgent: "紧急",
  data_insufficient: "数据不足",
};

export function runMockAgent({ elder_profile, daily_snapshot, risk_result }, options = {}) {
  const elderName = elder_profile?.name ?? elder_profile?.elder_name ?? "长者";
  const level = risk_result?.status_level ?? "data_insufficient";
  const reasons = risk_result?.key_reasons ?? ["暂无明显异常"];
  const safeReasons = reasons.filter((reason) => !hasProhibitedMedicalLanguage(reason));
  const reasonSummary = safeReasons.length
    ? safeReasons.join("；")
    : "规则引擎记录到一项需要照护人员人工复核的健康相关反馈。";
  const source = daily_snapshot?.data_source ?? "Demo Seed";
  const quality = daily_snapshot?.data_quality ?? 0;

  const fallbackPrefix = options.fallbackLabel ? "Mock fallback：" : "";

  return {
    status_level: level,
    risk_score: Number(risk_result?.risk_score ?? 0),
    key_reasons: reasons,
    caregiver_summary: `${fallbackPrefix}${elderName}当前为“${statusText[level] ?? level}”。数据来源：${source}，数据质量 ${quality}%。${reasonSummary} 请照护人员结合现场情况复核。`,
    family_summary:
      level === "stable"
        ? `${elderName}今日状态整体平稳，照护团队会继续常规观察。`
        : `${elderName}今日有需要关注的变化，照护团队已收到提示并会继续跟进。`,
    institution_summary: `${elderName}今日风险等级为“${statusText[level] ?? level}”，建议按任务优先级安排巡查与记录。`,
    recommended_action:
      risk_result?.recommended_action ?? "保持常规照护与日常观察。",
    safety_disclaimer: SAFETY_DISCLAIMER,
  };
}
