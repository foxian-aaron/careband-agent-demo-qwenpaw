import { describe, expect, it } from "vitest";
import {
  deriveInstitutionMetrics,
  isOperationalSubject,
  isSameCareDay,
  type InstitutionElderRowInput,
} from "../lib/institutionMetrics";
import { deriveCareLoopStatus, deriveDisplayStatus } from "../lib/displayStatus";
import {
  createInitialDemoState,
  demoReducer,
  getActiveTaskForElder,
  getEventsForElder,
  getRiskForElder,
  getTaskForElder,
  type DemoState,
} from "../store/demoStore";

const row = (
  overrides: Partial<InstitutionElderRowInput>,
): InstitutionElderRowInput => ({
  elderId: "E001",
  riskLevel: "attention",
  riskScore: 55,
  displayStatusLabel: "需关注",
  displayStatusTone: "attention",
  careLoopStatus: "none",
  dataCompleteness: 0.82,
  ...overrides,
});

describe("deriveInstitutionMetrics", () => {
  it("keeps team-test subjects out of operational queues", () => {
    expect(isOperationalSubject("elder")).toBe(true);
    expect(isOperationalSubject("team_test")).toBe(false);
  });

  it("compares today history in Macau time instead of against snapshot date", () => {
    const reference = "2026-07-11T03:00:00.000Z";
    expect(isSameCareDay("2026-07-10T16:30:00.000Z", reference)).toBe(true);
    expect(isSameCareDay("2026-07-10T15:59:59.000Z", reference)).toBe(false);
  });

  it("does not count Chen initial attention state as high risk", () => {
    const metrics = deriveInstitutionMetrics([row({})]);

    expect(metrics.currentOpenHighRiskCount).toBe(0);
    expect(metrics.todayEverHighRiskCount).toBe(0);
    expect(metrics.followedUpHighRiskCount).toBe(0);
  });

  it("counts dizziness high risk pending task as open high risk and pending task", () => {
    const metrics = deriveInstitutionMetrics([
      row({
        riskLevel: "high_risk",
        riskScore: 82,
        displayStatusLabel: "高风险待处理",
        displayStatusTone: "high_risk",
        careLoopStatus: "pending",
        taskStatus: "pending",
      }),
    ]);

    expect(metrics.currentOpenHighRiskCount).toBe(1);
    expect(metrics.todayEverHighRiskCount).toBe(1);
    expect(metrics.followedUpHighRiskCount).toBe(0);
    expect(metrics.pendingTaskCount).toBe(1);
  });

  it("keeps accepted high risk open but removes it from pending tasks", () => {
    const metrics = deriveInstitutionMetrics([
      row({
        riskLevel: "high_risk",
        displayStatusLabel: "高风险处理中",
        displayStatusTone: "high_risk",
        careLoopStatus: "in_progress",
        taskStatus: "in_progress",
      }),
    ]);

    expect(metrics.currentOpenHighRiskCount).toBe(1);
    expect(metrics.todayEverHighRiskCount).toBe(1);
    expect(metrics.followedUpHighRiskCount).toBe(0);
    expect(metrics.pendingTaskCount).toBe(0);
  });

  it("moves completed high risk into followed up instead of open high risk", () => {
    const metrics = deriveInstitutionMetrics([
      row({
        riskLevel: "high_risk",
        displayStatusLabel: "已跟进 / 持续观察",
        displayStatusTone: "follow_up",
        careLoopStatus: "completed",
        taskStatus: "completed",
      }),
    ]);

    expect(metrics.currentOpenHighRiskCount).toBe(0);
    expect(metrics.todayEverHighRiskCount).toBe(1);
    expect(metrics.followedUpHighRiskCount).toBe(1);
    expect(metrics.pendingTaskCount).toBe(0);
  });

  it("counts unfinished SOS as open urgent risk", () => {
    const metrics = deriveInstitutionMetrics([
      row({
        riskLevel: "urgent",
        displayStatusLabel: "紧急待处理",
        displayStatusTone: "urgent",
        careLoopStatus: "pending",
        taskStatus: "pending",
      }),
    ]);

    expect(metrics.currentOpenHighRiskCount).toBe(1);
    expect(metrics.todayEverHighRiskCount).toBe(1);
    expect(metrics.followedUpHighRiskCount).toBe(0);
  });

  it("rounds average data completeness as integer percentage", () => {
    const metrics = deriveInstitutionMetrics([
      row({ elderId: "E001", dataCompleteness: 0.82 }),
      row({ elderId: "E002", dataCompleteness: 0.75 }),
      row({ elderId: "E003", dataCompleteness: 0.4 }),
    ]);

    expect(metrics.averageDataCompleteness).toBe(66);
  });

  it("excludes team wearable test profiles from institution operating metrics", () => {
    const metrics = deriveInstitutionMetrics([
      row({ elderId: "E001", dataCompleteness: 0.8 }),
      row({
        elderId: "TEST001",
        isTeamTest: true,
        riskLevel: "urgent",
        careLoopStatus: "pending",
        taskStatus: "pending",
        dataCompleteness: 0.2,
      }),
    ]);

    expect(metrics.currentOpenHighRiskCount).toBe(0);
    expect(metrics.todayEverHighRiskCount).toBe(0);
    expect(metrics.pendingTaskCount).toBe(0);
    expect(metrics.averageDataCompleteness).toBe(80);
  });

  it("keeps a same-day resolved high-risk task in today-ever history after current risk drops", () => {
    const metrics = deriveInstitutionMetrics([
      row({
        riskLevel: "attention",
        careLoopStatus: "completed",
        taskStatus: "completed",
        hadHighRiskToday: true,
      }),
    ]);

    expect(metrics.currentOpenHighRiskCount).toBe(0);
    expect(metrics.todayEverHighRiskCount).toBe(1);
    expect(metrics.followedUpHighRiskCount).toBe(1);
  });
});

const metricsFromDemoState = (state: DemoState) =>
  deriveInstitutionMetrics(
    Object.values(state.profiles).map((profile) => {
      const events = getEventsForElder(state, profile.elderId);
      const risk = getRiskForElder(state, profile.elderId);
      const careLoopStatus = deriveCareLoopStatus(profile.elderId, state.tasks, events);
      const displayStatus = deriveDisplayStatus(risk, careLoopStatus);
      const task =
        getActiveTaskForElder(state, profile.elderId) ??
        getTaskForElder(state, profile.elderId);

      return {
        elderId: profile.elderId,
        riskLevel: risk.riskLevel,
        riskScore: risk.riskScore,
        displayStatusLabel: displayStatus.label,
        displayStatusTone: displayStatus.tone,
        careLoopStatus,
        taskStatus: task?.status,
        dataCompleteness: risk.dataCompleteness,
        isTeamTest: profile.subjectKind === "team_test",
        hadHighRiskToday:
          ["high_risk", "urgent"].includes(risk.riskLevel) ||
          state.tasks.some(
            (candidate) =>
              candidate.elderId === profile.elderId &&
              ["high", "urgent"].includes(candidate.priority) &&
              isSameCareDay(candidate.createdAt),
          ),
      };
    }),
  );

describe("institution metrics across Chen demo flow", () => {
  it("matches the expected institution counters through the full care loop", () => {
    let state = createInitialDemoState();
    let metrics = metricsFromDemoState(state);
    expect(metrics.currentOpenHighRiskCount).toBe(0);
    expect(metrics.todayEverHighRiskCount).toBe(0);
    expect(metrics.followedUpHighRiskCount).toBe(0);

    state = demoReducer(state, { type: "TRIGGER_CHEN_DIZZINESS" });
    metrics = metricsFromDemoState(state);
    expect(metrics.currentOpenHighRiskCount).toBe(1);
    expect(metrics.todayEverHighRiskCount).toBe(1);
    expect(metrics.followedUpHighRiskCount).toBe(0);
    expect(metrics.pendingTaskCount).toBe(1);

    state = demoReducer(state, { type: "CAREGIVER_ACCEPT_TASK" });
    metrics = metricsFromDemoState(state);
    expect(metrics.currentOpenHighRiskCount).toBe(1);
    expect(metrics.pendingTaskCount).toBe(0);

    state = demoReducer(state, { type: "CAREGIVER_MARK_VIEWED" });
    metrics = metricsFromDemoState(state);
    expect(metrics.currentOpenHighRiskCount).toBe(1);
    expect(metrics.followedUpHighRiskCount).toBe(0);

    state = demoReducer(state, { type: "CONFIRM_EVENING_MEDICATION" });
    metrics = metricsFromDemoState(state);
    expect(metrics.currentOpenHighRiskCount).toBe(1);
    expect(metrics.followedUpHighRiskCount).toBe(0);

    state = demoReducer(state, { type: "COMPLETE_CARE_TASK" });
    metrics = metricsFromDemoState(state);
    expect(metrics.currentOpenHighRiskCount).toBe(0);
    expect(metrics.todayEverHighRiskCount).toBe(1);
    expect(metrics.followedUpHighRiskCount).toBe(1);
    expect(metrics.pendingTaskCount).toBe(0);
  });
});
