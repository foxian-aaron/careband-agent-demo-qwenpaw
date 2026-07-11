import type { RiskLevel } from "../types";
import type { CareLoopStatus, DisplayStatus } from "./displayStatus";

export interface InstitutionElderRowInput {
  elderId: string;
  riskLevel: RiskLevel;
  riskScore: number;
  displayStatusLabel: string;
  displayStatusTone: DisplayStatus["tone"] | string;
  careLoopStatus: CareLoopStatus;
  taskStatus?: "pending" | "in_progress" | "completed" | "cancelled";
  dataCompleteness: number;
  isTeamTest?: boolean;
  hadHighRiskToday?: boolean;
}

export interface InstitutionMetrics {
  currentOpenHighRiskCount: number;
  todayEverHighRiskCount: number;
  followedUpHighRiskCount: number;
  pendingTaskCount: number;
  averageDataCompleteness: number;
}

const isHighRiskOrUrgent = (riskLevel: RiskLevel) =>
  riskLevel === "high_risk" || riskLevel === "urgent";

export const isOperationalSubject = (subjectKind?: "elder" | "team_test") =>
  subjectKind !== "team_test";

const careDateKey = (value: string | Date) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Macau",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const pick = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
};

export const isSameCareDay = (value: string, reference: string | Date = new Date()) =>
  careDateKey(value) === careDateKey(reference);

const isClosedCareLoop = (careLoopStatus: CareLoopStatus) =>
  careLoopStatus === "completed" || careLoopStatus === "follow_up";

export const deriveInstitutionMetrics = (
  rows: InstitutionElderRowInput[],
): InstitutionMetrics => {
  const operationalRows = rows.filter((row) => !row.isTeamTest);
  const todayHighRiskRows = operationalRows.filter(
    (row) => row.hadHighRiskToday ?? isHighRiskOrUrgent(row.riskLevel),
  );
  const currentOpenHighRiskRows = operationalRows.filter(
    (row) =>
      isHighRiskOrUrgent(row.riskLevel) &&
      !isClosedCareLoop(row.careLoopStatus),
  );
  const followedUpHighRiskRows = todayHighRiskRows.filter(
    (row) =>
      isClosedCareLoop(row.careLoopStatus) ||
      row.displayStatusTone === "follow_up" ||
      row.taskStatus === "completed",
  );
  const averageDataCompleteness =
    operationalRows.length === 0
      ? 0
      : Math.round(
          (operationalRows.reduce((sum, row) => sum + row.dataCompleteness, 0) /
            operationalRows.length) *
            100,
        );

  return {
    currentOpenHighRiskCount: currentOpenHighRiskRows.length,
    todayEverHighRiskCount: todayHighRiskRows.length,
    followedUpHighRiskCount: followedUpHighRiskRows.length,
    pendingTaskCount: operationalRows.filter((row) => row.taskStatus === "pending").length,
    averageDataCompleteness,
  };
};
