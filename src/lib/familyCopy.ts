import type {
  CareTask,
  DailySnapshot,
  ElderProfile,
  RiskResult,
} from "../types";
import type { CareLoopStatus, DisplayStatus } from "./displayStatus";

export const buildFamilyStatusMessage = (
  profile: ElderProfile,
  riskResult: RiskResult,
  displayStatus: DisplayStatus,
  snapshot: DailySnapshot,
  activeTask?: CareTask,
  careLoopStatus: CareLoopStatus = "none",
  familyCanViewMedicationStatus = false,
) => {
  if (careLoopStatus === "completed" || displayStatus.tone === "follow_up") {
    const medicationText = familyCanViewMedicationStatus ? "晚药已确认，" : "用药状态未授权显示，";
    return `护工已查看${profile.name}，${medicationText}系统将继续观察明早活动与睡眠情况。`;
  }

  if (careLoopStatus === "medication_confirmed") {
    return familyCanViewMedicationStatus
      ? "晚药已确认，护工正在完成处理记录。"
      : "护工正在完成处理记录，用药状态未授权显示。";
  }

  if (careLoopStatus === "checked") {
    return familyCanViewMedicationStatus
      ? `护工已到场查看${profile.name}，正在确认用药和休息情况。`
      : `护工已到场查看${profile.name}，正在确认照护情况。`;
  }

  if (careLoopStatus === "in_progress" || activeTask?.status === "in_progress") {
    return `护工已接单，正在查看${profile.name}情况。`;
  }

  if (riskResult.riskLevel === "data_insufficient") {
    return `${profile.name}今日数据暂不完整，系统建议先确认设备佩戴或数据同步。`;
  }

  const medicationText = familyCanViewMedicationStatus ? "晚药尚未确认，" : "用药状态未授权显示，";
  return `${profile.name}今日活动量较平时偏低，${medicationText}护工端已收到关注提醒。`;
};
