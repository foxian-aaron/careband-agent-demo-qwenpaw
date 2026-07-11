import { describe, expect, it } from "vitest";
import { mockBaselines } from "../data/mockBaselines";
import { mockEvents } from "../data/mockEvents";
import { mockProfiles } from "../data/mockProfiles";
import { mockSnapshots } from "../data/mockSnapshots";
import { deriveCareLoopStatus, deriveDisplayStatus } from "../lib/displayStatus";
import { buildFamilyStatusMessage } from "../lib/familyCopy";
import { calculateRisk } from "../lib/riskEngine";
import {
  createInitialDemoState,
  demoReducer,
  getEventsForElder,
  getRiskForElder,
} from "../store/demoStore";
import type { CareEvent, DailySnapshot } from "../types";

const byId = <T extends { elderId: string }>(items: T[], elderId: string) =>
  items.find((item) => item.elderId === elderId)!;

const inputFor = (
  elderId: string,
  extraEvents: CareEvent[] = [],
  snapshotOverride?: Partial<DailySnapshot>,
) => ({
  profile: byId(mockProfiles, elderId),
  baseline: byId(mockBaselines, elderId),
  snapshot: { ...byId(mockSnapshots, elderId), ...snapshotOverride },
  events: [
    ...mockEvents.filter((event) => event.elderId === elderId),
    ...extraEvents,
  ],
  evaluationTime: "2026-06-10T20:30:00+08:00",
});

describe("riskEngine", () => {
  it("calculates Chen initial state as attention or at least not stable", () => {
    const result = calculateRisk(inputFor("E001"));
    const reasons = result.keyReasons.join("；");

    expect(result.riskLevel).toBe("attention");
    expect(result.riskLevel).not.toBe("stable");
    expect(reasons).toContain("步数");
    expect(reasons).toContain("睡眠");
    expect(reasons).toContain("晚药尚未确认");
  });

  it("upgrades Chen to high_risk after dizziness voice symptom", () => {
    const voiceEvent: CareEvent = {
      eventId: "TEST-DIZZINESS",
      elderId: "E001",
      eventType: "voice_symptom",
      timestamp: "2026-06-10T20:15:00+08:00",
      title: "语音反馈：我有点头晕",
      rawText: "我有点头晕",
      source: "demo",
      severity: "high_risk",
      payload: {
        symptomKeywords: ["头晕"],
      },
    };
    const result = calculateRisk(inputFor("E001", [voiceEvent]));
    const reasons = result.keyReasons.join("；");

    expect(result.riskLevel).toBe("high_risk");
    expect(reasons).toContain("头晕");
    expect(reasons).toContain("晚药尚未确认");
    expect(reasons).toContain("步数");
  });

  it("keeps dizziness plus unconfirmed medication high_risk without activity decline", () => {
    const voiceEvent: CareEvent = {
      eventId: "TEST-DIZZINESS-NORMAL-ACTIVITY",
      elderId: "E001",
      eventType: "voice_symptom",
      timestamp: "2026-06-10T20:15:00+08:00",
      title: "语音反馈：我有点头晕",
      rawText: "我有点头晕",
      source: "demo",
      severity: "high_risk",
      payload: { symptomKeywords: ["头晕"] },
    };
    const baseline = byId(mockBaselines, "E001");
    const result = calculateRisk({
      profile: byId(mockProfiles, "E001"),
      baseline,
      snapshot: {
        ...byId(mockSnapshots, "E001"),
        stepsToday: baseline.avgSteps7d,
        activeMinutes: baseline.avgActiveMinutes7d,
        sleepDuration: baseline.avgSleep7d,
        heartRate: baseline.restingHrBaseline,
        restingHeartRate: baseline.restingHrBaseline,
      },
      events: [voiceEvent],
      evaluationTime: "2026-06-10T20:30:00+08:00",
    });

    expect(result.riskLevel).toBe("high_risk");
    expect(result.keyReasons.join("；")).toContain("头晕");
  });

  it("keeps Liang stable when today is close to baseline", () => {
    const result = calculateRisk(inputFor("E004"));

    expect(result.riskLevel).toBe("stable");
    expect(result.keyReasons.join("；")).toContain("接近本人近期基线");
  });

  it("returns data_insufficient when completeness is below 40 percent", () => {
    const result = calculateRisk(inputFor("E005", [], { wearTimeHours: 12 }));

    expect(result.riskLevel).toBe("data_insufficient");
    expect(result.riskScore).toBeLessThanOrEqual(30);
    expect(result.keyReasons.join("；")).toContain("数据完整度不足");
  });

  it("returns urgent and score >= 90 for SOS events", () => {
    const sosEvent: CareEvent = {
      eventId: "TEST-SOS",
      elderId: "E001",
      eventType: "sos",
      timestamp: "2026-06-10T20:18:00+08:00",
      title: "SOS 测试事件",
      source: "demo",
      severity: "urgent",
    };
    const result = calculateRisk(inputFor("E001", [sosEvent]));

    expect(result.riskLevel).toBe("urgent");
    expect(result.riskScore).toBeGreaterThanOrEqual(90);
  });

  it("keeps SOS urgent even when data completeness is below 40 percent", () => {
    const sosEvent: CareEvent = {
      eventId: "TEST-SOS-DATA-GAP",
      elderId: "E001",
      eventType: "sos",
      timestamp: "2026-06-10T20:18:00+08:00",
      title: "SOS 测试事件",
      source: "demo",
      severity: "urgent",
    };
    const result = calculateRisk(inputFor("E001", [sosEvent], { dataCompleteness: 0.32 }));

    expect(result.riskLevel).toBe("urgent");
    expect(result.riskScore).toBeGreaterThanOrEqual(90);
    expect(result.keyReasons.join("；")).toContain("SOS");
    expect(result.keyReasons.join("；")).toContain("优先按应急流程处理");
  });

  it("returns urgent for fall_detected with no response >= 30 seconds", () => {
    const fallEvent: CareEvent = {
      eventId: "TEST-FALL-NO-RESPONSE",
      elderId: "E001",
      eventType: "fall_detected",
      timestamp: "2026-06-10T20:19:00+08:00",
      title: "跌倒检测后未回应",
      source: "mock_wearable",
      severity: "urgent",
      payload: {
        noResponseSeconds: 35,
      },
    };
    const result = calculateRisk(inputFor("E001", [fallEvent]));

    expect(result.riskLevel).toBe("urgent");
    expect(result.riskScore).toBeGreaterThanOrEqual(90);
  });

  it("uses only unresolved events inside the active 24-hour window", () => {
    const ignoredEvents: CareEvent[] = [
      {
        eventId: "RESOLVED-SOS",
        elderId: "E004",
        eventType: "sos",
        timestamp: "2026-06-10T20:29:00+08:00",
        title: "resolved",
        source: "demo",
        status: "resolved",
      },
      {
        eventId: "STALE-SOS",
        elderId: "E004",
        eventType: "sos",
        timestamp: "2026-06-09T19:00:00+08:00",
        title: "stale",
        source: "demo",
        status: "open",
      },
      {
        eventId: "FUTURE-SOS",
        elderId: "E004",
        eventType: "sos",
        timestamp: "2026-06-10T20:36:00+08:00",
        title: "future",
        source: "demo",
        status: "open",
      },
    ];

    expect(calculateRisk(inputFor("E004", ignoredEvents)).riskLevel).toBe("stable");

    const acknowledgedSos: CareEvent = {
      ...ignoredEvents[0],
      eventId: "ACTIVE-ACKNOWLEDGED-SOS",
      status: "acknowledged",
    };
    expect(calculateRisk(inputFor("E004", [acknowledgedSos])).riskLevel).toBe("urgent");
  });

  it("applies the 0.8 and 0.5 fall-confidence thresholds", () => {
    const fall = (confidence: number): CareEvent => ({
      eventId: `FALL-${confidence}`,
      elderId: "E004",
      eventType: "fall_detected",
      timestamp: "2026-06-10T20:29:00+08:00",
      title: "fall signal",
      source: "mock_wearable",
      status: "open",
      confidence,
    });

    expect(calculateRisk(inputFor("E004", [fall(0.8)])).riskLevel).toBe("urgent");
    expect(calculateRisk(inputFor("E004", [fall(0.5)])).riskLevel).toBe("high_risk");
    expect(calculateRisk(inputFor("E004", [fall(0.49)])).riskLevel).toBe("observation");
  });

  it("returns data_insufficient when wear time is below six hours", () => {
    const result = calculateRisk(inputFor("E004", [], { wearTimeHours: 5.9 }));

    expect(result.riskLevel).toBe("data_insufficient");
    expect(result.keyReasons.join("；")).toContain("少于 6 小时");
  });

  it("compares resting heart rate rather than average heart rate", () => {
    const averageOnly = calculateRisk(
      inputFor("E004", [], { heartRate: 120, restingHeartRate: 68 }),
    );
    const elevatedResting = calculateRisk(
      inputFor("E004", [], { heartRate: 69, restingHeartRate: 80 }),
    );

    expect(averageOnly.riskLevel).toBe("stable");
    expect(averageOnly.triggeredRules.join("；")).not.toContain("静息基线偏高");
    expect(elevatedResting.riskLevel).toBe("observation");
    expect(elevatedResting.triggeredRules.join("；")).toContain("静息基线偏高");
  });

  it("keeps medical disclaimer and avoids diagnostic wording", () => {
    const result = calculateRisk(inputFor("E001"));

    expect(result.medicalDisclaimer).toBeTruthy();
    expect(result.recommendedAction).not.toMatch(/患有|确诊|诊断为|可能得了|疾病判断/);
  });
});

describe("displayStatus", () => {
  const voiceEvent: CareEvent = {
    eventId: "TEST-DISPLAY-DIZZINESS",
    elderId: "E001",
    eventType: "voice_symptom",
    timestamp: "2026-06-10T20:15:00+08:00",
    title: "语音反馈：我有点头晕",
    rawText: "我有点头晕",
    source: "demo",
    severity: "high_risk",
    payload: {
      symptomKeywords: ["头晕"],
    },
  };
  const highRisk = calculateRisk(inputFor("E001", [voiceEvent]));

  it("maps high risk + pending task to 高风险待处理", () => {
    const display = deriveDisplayStatus(highRisk, "pending");
    expect(display.label).toBe("高风险待处理");
  });

  it("maps high risk + in_progress task to 高风险处理中", () => {
    const display = deriveDisplayStatus(highRisk, "in_progress");
    expect(display.label).toBe("高风险处理中");
  });

  it("maps high risk + completed task to 已跟进 / 持续观察", () => {
    const display = deriveDisplayStatus(highRisk, "completed");
    expect(display.label).toBe("已跟进 / 持续观察");
  });
});

describe("demoStore reducer", () => {
  it("adds caregiver_checked event for CAREGIVER_MARK_VIEWED", () => {
    const afterViewed = demoReducer(
      demoReducer(
        demoReducer(createInitialDemoState(), { type: "TRIGGER_CHEN_DIZZINESS" }),
        { type: "CAREGIVER_ACCEPT_TASK" },
      ),
      { type: "CAREGIVER_MARK_VIEWED" },
    );

    expect(
      afterViewed.events.some((event) => event.eventType === "caregiver_checked"),
    ).toBe(true);
    expect(
      afterViewed.events.filter((event) => event.eventType === "caregiver_accepted"),
    ).toHaveLength(1);
  });

  it("completes active care task and keeps caregiver note", () => {
    let state = createInitialDemoState();
    state = demoReducer(state, { type: "TRIGGER_CHEN_DIZZINESS" });
    state = demoReducer(state, { type: "CAREGIVER_ACCEPT_TASK" });
    state = demoReducer(state, { type: "CAREGIVER_MARK_VIEWED" });
    state = demoReducer(state, { type: "CONFIRM_EVENING_MEDICATION" });
    state = demoReducer(state, { type: "COMPLETE_CARE_TASK" });

    const completedTask = state.tasks.find((task) => task.elderId === "E001");
    expect(completedTask?.status).toBe("completed");
    expect(completedTask?.note).toContain("护工A已查看陈伯");
    expect(state.events.some((event) => event.eventType === "caregiver_completed")).toBe(true);
  });

  it("resolves every event linked to the completed offline task", () => {
    let state = createInitialDemoState();
    state = demoReducer(state, { type: "TRIGGER_CHEN_DIZZINESS" });
    state = demoReducer(state, { type: "TRIGGER_SOS" });

    const activeTask = state.tasks.find(
      (task) => task.elderId === "E001" && task.status === "pending",
    );
    expect(activeTask).toBeTruthy();
    expect(getRiskForElder(state, "E001").riskLevel).toBe("urgent");

    state = demoReducer(state, { type: "COMPLETE_CARE_TASK" });
    const linkedEvents = state.events.filter(
      (event) => event.linkedTaskId === activeTask?.taskId,
    );

    expect(linkedEvents.length).toBeGreaterThanOrEqual(2);
    expect(linkedEvents.every((event) => event.status === "resolved")).toBe(true);
    expect(linkedEvents.every((event) => event.handledBy === "护工A")).toBe(true);
    expect(getRiskForElder(state, "E001").riskLevel).not.toBe("urgent");
  });

  it("keeps the offline hardware fall task aligned with its 0.9 confidence", () => {
    const state = demoReducer(createInitialDemoState(), {
      type: "TRIGGER_HARDWARE_EVENT",
      elderId: "E001",
      eventType: "fall_detected",
    });
    const fallEvent = state.events.find(
      (event) => event.elderId === "E001" && event.eventType === "fall_detected",
    );
    const task = state.tasks.find((candidate) => candidate.sourceEventId === fallEvent?.eventId);

    expect(fallEvent?.payload?.confidence).toBe(0.9);
    expect(getRiskForElder(state, "E001").riskLevel).toBe("urgent");
    expect(task?.priority).toBe("urgent");
  });
});

describe("familyCopy", () => {
  it("uses profile.name instead of hardcoded Chen", () => {
    const profile = { ...byId(mockProfiles, "E001"), name: "王叔" };
    const risk = calculateRisk(inputFor("E001"));
    const display = deriveDisplayStatus(risk, "none");
    const message = buildFamilyStatusMessage(
      profile,
      risk,
      display,
      byId(mockSnapshots, "E001"),
      mockEvents.filter((event) => event.elderId === "E001"),
    );

    expect(message).toContain("王叔");
    expect(message).not.toContain("陈伯");
  });

  it("mentions viewed and medication confirmed after completion", () => {
    let state = createInitialDemoState();
    state = demoReducer(state, { type: "TRIGGER_CHEN_DIZZINESS" });
    state = demoReducer(state, { type: "CAREGIVER_ACCEPT_TASK" });
    state = demoReducer(state, { type: "CAREGIVER_MARK_VIEWED" });
    state = demoReducer(state, { type: "CONFIRM_EVENING_MEDICATION" });
    state = demoReducer(state, { type: "COMPLETE_CARE_TASK" });

    const events = getEventsForElder(state, "E001");
    const risk = getRiskForElder(state, "E001");
    const careLoopStatus = deriveCareLoopStatus("E001", state.tasks, events);
    const display = deriveDisplayStatus(risk, careLoopStatus);
    const message = buildFamilyStatusMessage(
      state.profiles.E001,
      risk,
      display,
      state.snapshots.E001,
      events,
      undefined,
      careLoopStatus,
    );

    expect(message).toContain("已查看");
    expect(message).toContain("晚药已确认");
  });
});
