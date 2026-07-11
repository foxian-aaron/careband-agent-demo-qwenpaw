import {
  createContext,
  type Dispatch,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import { mockBaselines } from "../data/mockBaselines";
import { mockContacts } from "../data/mockContacts";
import { mockConsentPrivacyRecords } from "../data/mockConsentPrivacy";
import { mockDeviceRecords } from "../data/mockDeviceRecords";
import {
  mockEvents,
  mockOperationalStates,
  mockTasks,
} from "../data/mockEvents";
import { mockMedicationPlans } from "../data/mockMedicationPlans";
import { mockPilotPlanStatus } from "../data/mockPilotPlan";
import { mockProfileDetails } from "../data/mockProfileDetails";
import { mockProfiles } from "../data/mockProfiles";
import { mockSnapshots } from "../data/mockSnapshots";
import { mockTrends } from "../data/mockTrends";
import { mockWeeklySummaries } from "../data/mockWeeklySummaries";
import { generateAgentSummaries } from "../lib/agentFormatter";
import { buildAgentTrace } from "../lib/agentTrace";
import {
  apiAnalyzeAgent,
  apiGetDashboard,
  apiPatchTask,
  apiPostSnapshot,
  apiResetDemo,
  submitNormalizedEvent,
  type BackendAgentOutput,
  type BackendAgentRun,
  type BackendDashboardResponse,
  type BackendEvent,
  type BackendEventInput,
  type BackendRiskResult,
  type BackendSnapshot,
  type BackendTask,
} from "../lib/apiClient";
import {
  completeCareTaskOnBackend,
  isBackendAuthoritativeTaskAction,
} from "../lib/careTaskWorkflow";
import { deriveCareLoopStatus, deriveDisplayStatus } from "../lib/displayStatus";
import {
  resolveDashboardAgentState,
  type AgentRunViewState,
} from "../lib/agentOutputState";
import {
  apiDataQualityToRatio,
  migratePersistedDataQuality,
} from "../lib/dataQuality";
import { calculateRisk } from "../lib/riskEngine";
import {
  latestWearableSnapshot,
  mapRecentSnapshotsToTrend,
} from "../lib/wearableImport";
import {
  getActiveTaskForElder as selectActiveTaskForElder,
  getLatestTaskForElder,
  getTaskHistoryForElder as selectTaskHistoryForElder,
} from "../lib/taskSelectors";
import type {
  AgentOutput,
  AgentMode,
  AgentRoleSummaries,
  AgentSummarySource,
  AgentTraceBundle,
  CareEvent,
  CareMemoryItem,
  CareTask,
  ConsentPrivacyRecord,
  ContactPerson,
  DailySnapshot,
  DeviceConnectionStatus,
  DeviceRecord,
  DeviceWearStatus,
  ElderProfile,
  ElderProfileDetail,
  ElderTrend,
  InitialCareMemory,
  MedicationPlan,
  MemoryConfirmationStatus,
  MockBackendLog,
  OperationalState,
  PersonalBaseline,
  PilotPlanStatus,
  RiskLevel,
  RiskResult,
  WearableDailySnapshot,
  WearableDataSource,
  WearableImportRecord,
  WeeklySummary,
} from "../types";

const storageKey = "careband-agent-demo-state-v0.2";
const chenId = "E001";
const testAppleWatchId = "TEST001";
const backendFallbackMessage = "後端未連接，正在使用本地 mock fallback";

type BackendStatus = {
  mode: "local" | "connected" | "unavailable";
  lastSyncedAt?: string;
  error?: string;
};

export interface DemoState {
  profiles: Record<string, ElderProfile>;
  baselines: Record<string, PersonalBaseline>;
  snapshots: Record<string, DailySnapshot>;
  medicationPlans: Record<string, MedicationPlan>;
  contacts: Record<string, ContactPerson>;
  profileDetails: Record<string, ElderProfileDetail>;
  trends: Record<string, ElderTrend>;
  events: CareEvent[];
  tasks: CareTask[];
  operationalStates: Record<string, OperationalState>;
  backendRiskResults: Record<string, RiskResult>;
  agentOutputs: Record<string, AgentOutput>;
  agentRunStates: Record<string, AgentRunViewState>;
  backend: BackendStatus;
  initialCareMemoryByElderId: Record<string, InitialCareMemory>;
  memoryDraftsByElderId: Record<string, InitialCareMemory>;
  wearableImports: Record<string, WearableImportRecord[]>;
  deviceRecords: Record<string, DeviceRecord>;
  agentMode: AgentMode;
  agentTraces: Record<string, AgentTraceBundle>;
  mockBackendLogs: MockBackendLog[];
  consentRecords: Record<string, ConsentPrivacyRecord>;
  pilotPlanStatus: PilotPlanStatus;
  weeklySummaries: Record<string, WeeklySummary>;
}

export type DemoAction =
  | { type: "RESET_DEMO" }
  | { type: "HYDRATE_FROM_BACKEND"; payload: Partial<DemoState>; syncedAt: string }
  | { type: "SET_BACKEND_STATUS"; payload: BackendStatus }
  | {
      type: "SET_AGENT_FAILURE";
      elderId: string;
      requestedProvider: AgentMode;
      warning: string;
    }
  | { type: "TRIGGER_CHEN_DIZZINESS" }
  | { type: "CAREGIVER_ACCEPT_TASK" }
  | { type: "CAREGIVER_MARK_VIEWED" }
  | { type: "CONFIRM_EVENING_MEDICATION" }
  | { type: "COMPLETE_CARE_TASK" }
  | { type: "TRIGGER_SOS" }
  | { type: "SIMULATE_DATA_GAP" }
  | { type: "IMPORT_APPLE_HEALTH_SAMPLE" }
  | { type: "CREATE_MEMORY_DRAFT"; draft: InitialCareMemory }
  | {
      type: "CONFIRM_MEMORY_ITEM";
      elderId: string;
      itemId: string;
      status: MemoryConfirmationStatus;
      content?: string;
    }
  | { type: "SAVE_INITIAL_CARE_MEMORY"; elderId: string }
  | {
      type: "IMPORT_WEARABLE_DATA";
      elderId: string;
      source: WearableDataSource;
      snapshots: WearableDailySnapshot[];
    }
  | {
      type: "UPDATE_DEVICE_STATUS";
      elderId: string;
      patch: Partial<
        Pick<
          DeviceRecord,
          | "connectionStatus"
          | "wearStatus"
          | "batteryLevel"
          | "lastSyncAt"
          | "dataQuality"
          | "dataSource"
          | "todayWearTimeHours"
        >
      >;
    }
  | {
      type: "TRIGGER_HARDWARE_EVENT";
      elderId: string;
      eventType: CareEvent["eventType"];
    }
  | { type: "SIMULATE_VOICE_INPUT"; elderId: string; text: string }
  | { type: "SIMULATE_GEOFENCE_EXIT"; elderId: string }
  | {
      type: "SIMULATE_FALL_EVENT";
      elderId: string;
      stage: "fall_detected" | "no_response_after_fall";
    }
  | { type: "GENERATE_AGENT_SUMMARY"; trace: AgentTraceBundle }
  | { type: "SIMULATE_AGENT_FAILURE"; elderId: string }
  | { type: "FALLBACK_TO_RULE_SUMMARY"; trace: AgentTraceBundle }
  | {
      type: "UPDATE_CONSENT";
      elderId: string;
      field: keyof Omit<ConsentPrivacyRecord, "elderId" | "updatedAt">;
      value: boolean | ConsentPrivacyRecord["rawMedicalRecordRetention"];
    }
  | { type: "UPDATE_PILOT_STATUS"; status: PilotPlanStatus }
  | { type: "GENERATE_WEEKLY_SUMMARY"; summary: WeeklySummary }
  | { type: "ADD_BACKEND_LOG"; log: MockBackendLog };

interface DemoContextValue {
  state: DemoState;
  dispatch: Dispatch<DemoAction>;
}

const DemoContext = createContext<DemoContextValue | null>(null);

const toRecord = <T extends { elderId: string }>(items: T[]) =>
  items.reduce<Record<string, T>>((record, item) => {
    record[item.elderId] = item;
    return record;
  }, {});

const toContactRecord = (items: ContactPerson[]) =>
  items.reduce<Record<string, ContactPerson>>((record, item) => {
    record[item.contactId] = item;
    return record;
  }, {});

const toDeviceRecord = (items: DeviceRecord[]) =>
  items.reduce<Record<string, DeviceRecord>>((record, item) => {
    record[item.elderId] = item;
    return record;
  }, {});

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const riskLevelFromBackend = (level: BackendRiskResult["status_level"]): RiskLevel => {
  return level;
};

const statusFromRisk = (level: RiskLevel): OperationalState => {
  if (level === "urgent" || level === "high_risk" || level === "attention") {
    return "pending";
  }
  return "normal";
};

const backendEventTypeToLocal = (event: BackendEvent): CareEvent["eventType"] => {
  const action = String(event.payload?.action ?? "");
  if (event.event_type === "sos") {
    return action === "triple_press" ? "sos_triple_press" : "sos_long_press";
  }
  if (event.event_type === "voice") {
    if (action === "wandering_help") return "wandering_help";
    if (action === "medication_query") return "medication_query";
    return "voice_symptom";
  }
  if (event.event_type === "medication") {
    return action === "confirmed" ? "medication_confirmed" : "medication_reminder";
  }
  if (event.event_type === "fall") {
    if (action === "no_response") return "no_response_after_fall";
    if (action === "inactivity_after_fall") return "inactivity_after_fall";
    return "fall_detected";
  }
  if (event.event_type === "location") {
    return action === "geofence_exit" ? "geofence_exit" : "location_alert";
  }
  if (event.event_type === "device_status") {
    const deviceActions: Record<string, CareEvent["eventType"]> = {
      not_worn: "device_not_worn",
      low_battery: "device_low_battery",
      reconnected: "device_reconnected",
      night_wakeup: "night_wakeup",
      low_activity: "low_activity",
    };
    return deviceActions[action] ?? "system_risk_update";
  }
  if (event.event_type === "manual_note") {
    const manualActions: Record<string, CareEvent["eventType"]> = {
      caregiver_accepted: "caregiver_accepted",
      caregiver_checked: "caregiver_checked",
      caregiver_completed: "caregiver_completed",
    };
    return manualActions[action] ?? "system_risk_update";
  }
  return "system_risk_update";
};

const backendSourceToLocal = (source: string): CareEvent["source"] => {
  if (source === "esp32" || source === "nrf") return "hardware_simulator";
  if (source === "mobile_app") return "voice_simulator";
  if (source === "mock") return "demo";
  if (source === "wearable_api" || source === "csv") return "wearable_import";
  return "system";
};

const mapBackendPayload = (payload: Record<string, unknown> = {}): CareEvent["payload"] => ({
  symptomKeywords: payload.symptom_keywords as string[] | undefined,
  medicationName: payload.medication_name as string | undefined,
  locationZone: payload.location_zone as string | undefined,
  safeZoneStatus: payload.safe_zone_status as "inside" | "outside" | "unknown" | undefined,
  nightWakeupCount: payload.night_wakeup_count as number | undefined,
  activityDropPercent: payload.activity_drop_percent as number | undefined,
  noResponseSeconds: payload.no_response_seconds as number | undefined,
  note: payload.note as string | undefined,
  previousValue: payload.previous_value as number | string | undefined,
  currentValue: payload.current_value as number | string | undefined,
});

const eventTitle = (event: BackendEvent) => {
  if (event.raw_text) return event.raw_text;
  if (event.event_type === "sos_long_press") return "SOS 长按求助";
  if (event.event_type === "fall_detected") return "跌倒检测事件";
  if (event.event_type === "caregiver_accepted") return "护工已接单";
  if (event.event_type === "caregiver_checked") return "护工已查看";
  if (event.event_type === "caregiver_completed") return "护工已完成处理";
  if (event.event_type === "medication_confirmed") return "用药已确认";
  return "系统照护事件";
};

const mapBackendEvent = (event: BackendEvent): CareEvent => ({
  eventId: event.event_id,
  elderId: event.elder_id,
  eventType: backendEventTypeToLocal(event),
  timestamp: event.timestamp,
  title: eventTitle(event),
  rawText: event.raw_text ?? undefined,
  source: backendSourceToLocal(event.source),
  payload: mapBackendPayload(event.payload),
  status: event.status === "resolved" ? "resolved" : "open",
  linkedTaskId: event.linked_task_id ?? undefined,
  handledBy: event.resolved_by ?? undefined,
  handledAt: event.resolved_at ?? undefined,
});

const deriveMedicationEvening = (events: CareEvent[]) => {
  if (events.some((event) => event.eventType === "medication_confirmed")) return "confirmed";
  if (
    events.some(
      (event) =>
        event.eventType === "medication_reminder" &&
        (event.rawText?.includes("未确认") || event.payload?.currentValue === "not_confirmed"),
    )
  ) {
    return "not_confirmed";
  }
  return "not_required";
};

const mapBackendSnapshot = (
  snapshot: BackendSnapshot,
  events: CareEvent[],
): DailySnapshot => ({
  elderId: snapshot.elder_id,
  date: snapshot.date,
  snapshotId: snapshot.snapshot_id,
  dataSource: snapshot.data_source,
  dataQuality: apiDataQualityToRatio(snapshot.data_quality),
  heartRate: snapshot.heart_rate_avg,
  restingHeartRate: snapshot.resting_heart_rate,
  stepsToday: snapshot.steps,
  activeMinutes: snapshot.active_minutes,
  sleepDuration: snapshot.sleep_duration,
  medicationMorning: "confirmed",
  medicationEvening: deriveMedicationEvening(events),
  wearTimeHours: snapshot.wear_time_hours,
  locationZone: "长者中心二楼",
  safeZoneStatus: "inside",
  fallDetected: events.some((event) => event.eventType === "fall_detected"),
  dataCompleteness: apiDataQualityToRatio(snapshot.data_quality),
  lastSyncedAt: snapshot.created_at,
});

const createMissingSnapshot = (elderId: string): DailySnapshot => ({
  elderId,
  date: new Date().toISOString().slice(0, 10),
  snapshotId: `MISSING-${elderId}`,
  dataSource: "等待 Apple Health 匯入",
  dataQuality: 0,
  heartRate: null,
  restingHeartRate: null,
  stepsToday: null,
  activeMinutes: null,
  sleepDuration: null,
  medicationMorning: "not_required",
  medicationEvening: "not_required",
  wearTimeHours: null,
  locationZone: "測試資料",
  safeZoneStatus: "unknown",
  fallDetected: false,
  dataCompleteness: 0,
  lastSyncedAt: new Date().toISOString(),
});

const backendTaskStatusToLocal = (status: BackendTask["status"]): CareTask["status"] => {
  if (status === "cancelled") return "cancelled";
  if (status === "resolved") return "completed";
  if (status === "acknowledged" || status === "in_progress") return "in_progress";
  return "pending";
};

export const mapBackendTask = (
  task: BackendTask,
  agentSummarySource?: AgentSummarySource,
): CareTask => ({
  taskId: task.task_id,
  elderId: task.elder_id,
  sourceEventId: task.source_event_id ?? undefined,
  priority: task.priority,
  title: task.task_title,
  reason: task.task_reason,
  recommendedAction: task.recommended_action,
  assignedTo: task.handled_by ?? "护工A",
  status: backendTaskStatusToLocal(task.status),
  agentSummarySource,
  createdAt: task.created_at,
  updatedAt: task.completed_at ?? task.created_at,
  completedAt: task.completed_at ?? undefined,
  note: task.handled_note ?? undefined,
  handledBy: task.handled_by ?? undefined,
  handledNote: task.handled_note ?? undefined,
});

const mapBackendAgentOutput = (
  output: BackendAgentOutput,
  run?: BackendAgentRun | null,
): AgentOutput => ({
  outputId: output.output_id,
  elderId: output.elder_id,
  sourceEventId: output.source_event_id ?? undefined,
  statusLevel: output.status_level,
  riskScore: output.risk_score,
  caregiverSummary: output.caregiver_summary,
  familySummary: output.family_summary,
  institutionSummary: output.institution_summary,
  recommendedAction: output.recommended_action,
  safetyDisclaimer: output.safety_disclaimer,
  keyReasons: output.key_reasons,
  agentSource: output.agent_source,
  requestedProvider: run?.provider,
  model: run?.model,
  durationMs: run?.duration_ms,
  validationStatus: run?.validation_status,
  fallbackUsed: run?.fallback_used,
  warning: output.warning,
  createdAt: output.created_at,
});

const mapBackendRisk = (
  risk: BackendRiskResult,
  localFallback: RiskResult,
): RiskResult => ({
  ...localFallback,
  riskLevel: riskLevelFromBackend(risk.status_level),
  riskScore: Math.round(risk.risk_score),
  keyReasons: risk.key_reasons,
  triggeredRules: risk.triggered_rules,
  recommendedAction: risk.recommended_action,
  dataCompleteness: apiDataQualityToRatio(risk.data_quality),
  confidence: apiDataQualityToRatio(risk.data_quality),
  medicalDisclaimer: risk.safety_disclaimer,
});

const mapDashboardToDemoState = (
  dashboard: BackendDashboardResponse,
  fallback: DemoState,
): Partial<DemoState> => {
  const profiles: Record<string, ElderProfile> = {};
  const baselines: Record<string, PersonalBaseline> = {};
  const snapshots: Record<string, DailySnapshot> = {};
  const tasks: CareTask[] = [];
  const events: CareEvent[] = [];
  const operationalStates: Record<string, OperationalState> = {};
  const backendRiskResults: Record<string, RiskResult> = {};
  const agentOutputs: Record<string, AgentOutput> = {};
  const agentRunStates: Record<string, AgentRunViewState> = {};
  const trends: Record<string, ElderTrend> = {};

  for (const row of dashboard.elders) {
    const elderId = row.elder.elder_id;
    profiles[elderId] = {
      elderId,
      name: row.elder.name,
      age: row.elder.age,
      room: row.elder.room,
      floor: fallback.profiles[elderId]?.floor ?? "二楼",
      chronicConditions: fallback.profiles[elderId]?.chronicConditions ?? [],
      riskTags: row.elder.risk_tags,
      caregiverId: fallback.profiles[elderId]?.caregiverId ?? "CG-A",
      familyContactId: fallback.profiles[elderId]?.familyContactId ?? `FAM-${elderId}`,
      subjectKind:
        row.elder.subject_kind ??
        fallback.profiles[elderId]?.subjectKind ??
        (elderId === testAppleWatchId ? "team_test" : "elder"),
    };
    baselines[elderId] = {
      elderId,
      avgSteps7d: row.baseline.avg_steps_7d,
      avgSleep7d: row.baseline.avg_sleep_7d,
      avgActiveMinutes7d: row.baseline.avg_active_minutes_7d,
      restingHrBaseline: row.baseline.resting_hr_baseline,
      medicationOnTimeRate: fallback.baselines[elderId]?.medicationOnTimeRate ?? 0.9,
      baselineConfidence: apiDataQualityToRatio(row.baseline.baseline_confidence),
      baselineLabel: row.baseline.baseline_label,
      usableDays: row.baseline.usable_days,
    };

    const mappedEvents = row.events.map(mapBackendEvent);
    events.push(...mappedEvents);

    if (row.latest_snapshot) {
      snapshots[elderId] = mapBackendSnapshot(row.latest_snapshot, mappedEvents);
    } else {
      snapshots[elderId] = fallback.snapshots[elderId] ?? createMissingSnapshot(elderId);
    }

    const recentSnapshots = row.recent_snapshots?.length
      ? row.recent_snapshots
      : row.latest_snapshot
        ? [row.latest_snapshot]
        : [];
    trends[elderId] = recentSnapshots.length
      ? mapRecentSnapshotsToTrend(
          elderId,
          recentSnapshots,
          baselines[elderId].medicationOnTimeRate,
          row.risk_result
            ? riskLevelFromBackend(row.risk_result.status_level)
            : "data_insufficient",
        )
      : fallback.trends[elderId] ?? { elderId, points: [] };
    const currentAgent = resolveDashboardAgentState(
      row.latest_agent_output,
      row.latest_agent_run,
    );
    const taskAgentSource: AgentSummarySource | undefined = currentAgent.run?.fallbackUsed
      ? "fallback_rule"
      : currentAgent.output?.agent_source;
    tasks.push(...row.tasks.map((task) => mapBackendTask(task, taskAgentSource)));

    const activeTask = row.tasks.find(
      (task) => !["resolved", "cancelled"].includes(task.status),
    );
    operationalStates[elderId] = activeTask
      ? activeTask.status === "open"
        ? "pending"
        : "in_progress"
      : "normal";

    if (row.risk_result && snapshots[elderId]) {
      const fallbackRisk = calculateRisk({
        profile: profiles[elderId],
        baseline: baselines[elderId],
        snapshot: snapshots[elderId],
        events: mappedEvents,
      });
      backendRiskResults[elderId] = mapBackendRisk(row.risk_result, fallbackRisk);
      operationalStates[elderId] =
        activeTask
          ? activeTask.status === "open"
            ? "pending"
            : "in_progress"
          : statusFromRisk(backendRiskResults[elderId].riskLevel);
    }

    if (currentAgent.run) {
      agentRunStates[elderId] = currentAgent.run;
    }
    if (currentAgent.output) {
      agentOutputs[elderId] = mapBackendAgentOutput(currentAgent.output, row.latest_agent_run);
    }
  }

  return {
    profiles,
    baselines,
    snapshots: { ...fallback.snapshots, ...snapshots },
    events,
    tasks,
    trends: { ...fallback.trends, ...trends },
    operationalStates,
    backendRiskResults,
    agentOutputs,
    agentRunStates,
  };
};

export const createInitialDemoState = (): DemoState => ({
  profiles: toRecord(clone(mockProfiles)),
  baselines: toRecord(clone(mockBaselines)),
  snapshots: toRecord(
    clone(mockSnapshots).map((snapshot: DailySnapshot) => ({
      ...snapshot,
      dataSource: snapshot.dataSource ?? "Mock Data",
      dataQuality: snapshot.dataQuality ?? snapshot.dataCompleteness,
    })),
  ),
  medicationPlans: toRecord(clone(mockMedicationPlans)),
  contacts: toContactRecord(clone(mockContacts)),
  profileDetails: toRecord(clone(mockProfileDetails)),
  trends: toRecord(clone(mockTrends)),
  events: clone(mockEvents),
  tasks: clone(mockTasks),
  operationalStates: clone(mockOperationalStates),
  backendRiskResults: {},
  agentOutputs: {},
  agentRunStates: {},
  backend: {
    mode: "local",
  },
  initialCareMemoryByElderId: {},
  memoryDraftsByElderId: {},
  wearableImports: {},
  deviceRecords: toDeviceRecord(clone(mockDeviceRecords)),
  agentMode: "mock",
  agentTraces: {},
  mockBackendLogs: [],
  consentRecords: toRecord(clone(mockConsentPrivacyRecords)),
  pilotPlanStatus: clone(mockPilotPlanStatus),
  weeklySummaries: clone(mockWeeklySummaries),
});

const addEventOnce = (events: CareEvent[], event: CareEvent) =>
  events.some((existing) => existing.eventId === event.eventId)
    ? events
    : [...events, event];

const confirmEveningMedicationPlan = (
  plans: Record<string, MedicationPlan>,
  confirmedEventId = "EVT-E001-MED-PM-CONFIRMED",
) => {
  const plan = plans[chenId];
  if (!plan) return plans;

  return {
    ...plans,
    [chenId]: {
      ...plan,
      updatedAt: "2026-06-10T20:22:00+08:00",
      doses: plan.doses.map((dose) =>
        dose.label === "晚药"
          ? {
              ...dose,
              status: "confirmed" as const,
              confirmedAt: "20:22",
              confirmedBy: "护工A",
              confirmSource: "caregiver" as const,
              confirmedEventId,
            }
          : dose,
      ),
    },
  };
};

const nextTaskId = (tasks: CareTask[], baseId: string) => {
  if (!tasks.some((task) => task.taskId === baseId)) return baseId;
  return `${baseId}-${tasks.filter((task) => task.taskId.startsWith(baseId)).length + 1}`;
};

const upsertActiveTask = (tasks: CareTask[], elderId: string, task: CareTask) => {
  const activeTask = selectActiveTaskForElder(elderId, tasks);
  if (!activeTask) return [...tasks, task];
  return tasks.map((existing) =>
    existing.taskId === activeTask.taskId
      ? {
          ...existing,
          priority: task.priority,
          title: task.title,
          reason: task.reason,
          recommendedAction: task.recommendedAction,
          sourceEventId: task.sourceEventId,
          updatedAt: task.updatedAt,
        }
      : existing,
  );
};

const updateActiveTask = (
  tasks: CareTask[],
  elderId: string,
  updater: (task: CareTask) => CareTask,
) => {
  const activeTask = selectActiveTaskForElder(elderId, tasks);
  if (!activeTask) return tasks;
  return tasks.map((task) => (task.taskId === activeTask.taskId ? updater(task) : task));
};

const isoNow = () => new Date().toISOString();

const createBackendLog = (
  endpoint: string,
  method: MockBackendLog["method"],
  message: string,
  payloadPreview?: Record<string, unknown>,
): MockBackendLog => ({
  id: `LOG-${Date.now()}-${Math.round(Math.random() * 1000)}`,
  endpoint,
  method,
  status: "mocked",
  message,
  createdAt: isoNow(),
  payloadPreview,
});

const appendBackendLog = (logs: MockBackendLog[], log: MockBackendLog) =>
  [log, ...logs].slice(0, 24);

const createEventId = (prefix: string, eventType: string) =>
  `EVT-${prefix}-${eventType}-${Date.now()}`;

const hardwareEventCopy: Partial<
  Record<
    CareEvent["eventType"],
    {
      title: string;
      severity: CareEvent["severity"];
      priority: CareTask["priority"];
      reason: string;
      recommendedAction: string;
      sourceType: CareTask["sourceType"];
    }
  >
> = {
  button_confirm: {
    title: "短按确认：老人已回应提醒",
    severity: "stable",
    priority: "low",
    reason: "设备按钮确认事件",
    recommendedAction: "记录已确认，无需额外处理。",
    sourceType: "hardware_event",
  },
  sos_long_press: {
    title: "长按求助：触发 SOS",
    severity: "urgent",
    priority: "urgent",
    reason: "长按 SOS 求助事件",
    recommendedAction: "立即通知护工和机构负责人，并按机构应急流程处理。",
    sourceType: "hardware_event",
  },
  sos_triple_press: {
    title: "连按 SOS：触发紧急求助",
    severity: "urgent",
    priority: "urgent",
    reason: "连按 SOS 求助事件",
    recommendedAction: "立即通知护工和机构负责人，并按机构应急流程处理。",
    sourceType: "hardware_event",
  },
  fall_detected: {
    title: "疑似跌倒，等待确认",
    severity: "high_risk",
    priority: "high",
    reason: "手环 IMU 模拟检测到疑似跌倒",
    recommendedAction: "请护工立即查看现场，并等待老人按钮确认。",
    sourceType: "hardware_event",
  },
  inactivity_after_fall: {
    title: "跌倒后长时间静止",
    severity: "high_risk",
    priority: "high",
    reason: "疑似跌倒后长时间静止",
    recommendedAction: "请护工立即确认老人位置和现场情况。",
    sourceType: "hardware_event",
  },
  no_response_after_fall: {
    title: "跌倒后 30 秒无回应",
    severity: "urgent",
    priority: "urgent",
    reason: "疑似跌倒后 30 秒无按钮回应",
    recommendedAction: "立即通知护工和机构负责人，并按机构应急流程处理。",
    sourceType: "hardware_event",
  },
  device_not_worn: {
    title: "设备未佩戴，数据不足",
    severity: "data_insufficient",
    priority: "low",
    reason: "设备未佩戴或佩戴状态异常",
    recommendedAction: "请先确认设备佩戴和同步，再判断是否需要进一步跟进。",
    sourceType: "data_insufficient",
  },
  device_low_battery: {
    title: "设备低电量",
    severity: "observation",
    priority: "low",
    reason: "设备电量偏低，可能影响连续监测",
    recommendedAction: "提醒护工在巡查时为设备充电。",
    sourceType: "hardware_event",
  },
  device_reconnected: {
    title: "设备已重新连接",
    severity: "stable",
    priority: "low",
    reason: "设备重新上线并完成同步",
    recommendedAction: "记录设备恢复，无需额外处理。",
    sourceType: "hardware_event",
  },
};

const buildTaskFromEvent = (
  tasks: CareTask[],
  elderId: string,
  event: CareEvent,
  copy: NonNullable<(typeof hardwareEventCopy)[CareEvent["eventType"]]>,
): CareTask => ({
  taskId: nextTaskId(tasks, `TASK-${elderId}-${event.eventType.toUpperCase()}`),
  elderId,
  sourceEventId: event.eventId,
  priority: copy.priority,
  title:
    copy.priority === "urgent"
      ? "陈伯触发紧急事件，需要立即响应"
      : copy.title,
  reason: copy.reason,
  recommendedAction: copy.recommendedAction,
  assignedTo: "护工A",
  status: copy.priority === "low" && event.eventType === "button_confirm" ? "completed" : "pending",
  sourceType: copy.sourceType,
  agentSummarySource: "mock",
  createdAt: event.timestamp,
  updatedAt: event.timestamp,
});

export const demoReducer = (state: DemoState, action: DemoAction): DemoState => {
  switch (action.type) {
    case "HYDRATE_FROM_BACKEND":
      return {
        ...state,
        ...action.payload,
        backend: {
          mode: "connected",
          lastSyncedAt: action.syncedAt,
        },
      };
    case "SET_BACKEND_STATUS":
      return {
        ...state,
        backend: action.payload,
      };
    case "SET_AGENT_FAILURE": {
      const { [action.elderId]: _staleOutput, ...currentOutputs } = state.agentOutputs;
      return {
        ...state,
        agentOutputs: currentOutputs,
        agentRunStates: {
          ...state.agentRunStates,
          [action.elderId]: {
            requestedProvider: action.requestedProvider,
            model: null,
            durationMs: null,
            validationStatus: "failed",
            fallbackUsed: true,
            warning: action.warning,
            createdAt: isoNow(),
            hasCurrentOutput: false,
          },
        },
      };
    }
    case "RESET_DEMO":
      return createInitialDemoState();
    case "TRIGGER_CHEN_DIZZINESS": {
      const existingActiveTask = selectActiveTaskForElder(chenId, state.tasks);
      const taskId = existingActiveTask?.taskId ?? nextTaskId(state.tasks, "TASK-E001-DIZZINESS");
      const voiceEvent: CareEvent = {
        eventId: "EVT-E001-DIZZINESS",
        elderId: chenId,
        eventType: "voice_symptom",
        timestamp: "2026-06-10T20:15:00+08:00",
        title: "语音反馈：我有点头晕",
        rawText: "我有点头晕",
        source: "demo",
        severity: "high_risk",
        payload: {
          symptomKeywords: ["头晕"],
        },
        status: "open",
        linkedTaskId: taskId,
        confidence: 0.94,
      };
      const notifyEvent: CareEvent = {
        eventId: "EVT-E001-NOTIFY-CAREGIVER",
        elderId: chenId,
        eventType: "system_risk_update",
        timestamp: "2026-06-10T20:16:00+08:00",
        title: "系统通知护工：陈伯需要立即查看",
        source: "system",
        severity: "high_risk",
        status: "open",
        linkedTaskId: taskId,
      };
      const highTask: CareTask = {
        taskId,
        elderId: chenId,
        sourceEventId: voiceEvent.eventId,
        priority: "high",
        title: "陈伯需要立即查看",
        reason: "头晕反馈 + 晚药未确认 + 活动明显下降",
        recommendedAction:
          "请护工立即查看，确认是否已进食和服药，并观察不适是否持续。",
        assignedTo: "护工A",
        status: "pending",
        createdAt: "2026-06-10T20:16:00+08:00",
        updatedAt: "2026-06-10T20:16:00+08:00",
      };

      return {
        ...state,
        snapshots: {
          ...state.snapshots,
          [chenId]: {
            ...state.snapshots[chenId],
            lastSyncedAt: "2026-06-10T20:16:00+08:00",
          },
        },
        events: addEventOnce(addEventOnce(state.events, voiceEvent), notifyEvent),
        tasks: upsertActiveTask(state.tasks, chenId, highTask),
        operationalStates: {
          ...state.operationalStates,
          [chenId]: "pending",
        },
      };
    }
    case "CAREGIVER_ACCEPT_TASK": {
      const activeTask = selectActiveTaskForElder(chenId, state.tasks);
      if (!activeTask) return state;
      const acceptedEvent: CareEvent = {
        eventId: "EVT-E001-CAREGIVER-ACCEPTED",
        elderId: chenId,
        eventType: "caregiver_accepted",
        timestamp: "2026-06-10T20:20:00+08:00",
        title: "护工A已接单，正在查看陈伯情况",
        source: "caregiver",
        severity: "attention",
        status: "acknowledged",
        linkedTaskId: activeTask.taskId,
        handledBy: "护工A",
        handledAt: "2026-06-10T20:20:00+08:00",
      };

      return {
        ...state,
        events: addEventOnce(state.events, acceptedEvent),
        tasks: updateActiveTask(state.tasks, chenId, (task) => ({
          ...task,
          status: "in_progress",
          updatedAt: "2026-06-10T20:20:00+08:00",
        })),
        operationalStates: {
          ...state.operationalStates,
          [chenId]: "in_progress",
        },
      };
    }
    case "CAREGIVER_MARK_VIEWED": {
      const activeTask = selectActiveTaskForElder(chenId, state.tasks);
      if (!activeTask) return state;
      const checkedEvent: CareEvent = {
        eventId: "EVT-E001-CAREGIVER-CHECKED",
        elderId: chenId,
        eventType: "caregiver_checked",
        timestamp: "2026-06-10T20:21:00+08:00",
        title: "护工A已到场查看陈伯",
        source: "caregiver",
        severity: "attention",
        payload: {
          note: "护工A已到场查看陈伯",
        },
        status: "acknowledged",
        linkedTaskId: activeTask.taskId,
        handledBy: "护工A",
        handledAt: "2026-06-10T20:21:00+08:00",
      };

      return {
        ...state,
        events: addEventOnce(state.events, checkedEvent),
        tasks: updateActiveTask(state.tasks, chenId, (task) => ({
          ...task,
          updatedAt: "2026-06-10T20:21:00+08:00",
        })),
        operationalStates: {
          ...state.operationalStates,
          [chenId]: "in_progress",
        },
      };
    }
    case "CONFIRM_EVENING_MEDICATION": {
      const activeTask = selectActiveTaskForElder(chenId, state.tasks);
      const medicationEvent: CareEvent = {
        eventId: "EVT-E001-MED-PM-CONFIRMED",
        elderId: chenId,
        eventType: "medication_confirmed",
        timestamp: "2026-06-10T20:22:00+08:00",
        title: "晚药已确认",
        source: "caregiver",
        severity: "stable",
        payload: {
          medicationName: "晚药",
        },
        status: "resolved",
        linkedTaskId: activeTask?.taskId,
        handledBy: "护工A",
        handledAt: "2026-06-10T20:22:00+08:00",
      };

      return {
        ...state,
        snapshots: {
          ...state.snapshots,
          [chenId]: {
            ...state.snapshots[chenId],
            medicationEvening: "confirmed",
            lastSyncedAt: "2026-06-10T20:22:00+08:00",
          },
        },
        medicationPlans: confirmEveningMedicationPlan(state.medicationPlans),
        events: addEventOnce(state.events, medicationEvent),
        tasks: updateActiveTask(state.tasks, chenId, (task) => ({
          ...task,
          updatedAt: "2026-06-10T20:22:00+08:00",
        })),
      };
    }
    case "COMPLETE_CARE_TASK": {
      const activeTask = selectActiveTaskForElder(chenId, state.tasks);
      const medicationEvent: CareEvent = {
        eventId: "EVT-E001-MED-PM-CONFIRMED",
        elderId: chenId,
        eventType: "medication_confirmed",
        timestamp: "2026-06-10T20:22:00+08:00",
        title: "晚药已确认",
        source: "caregiver",
        severity: "stable",
        payload: {
          medicationName: "晚药",
        },
        status: "resolved",
        linkedTaskId: activeTask?.taskId,
        handledBy: "护工A",
        handledAt: "2026-06-10T20:22:00+08:00",
      };
      const note =
        "20:25 护工A已查看陈伯，已确认晚药，陈伯目前在房间休息，建议明早继续关注活动和睡眠。";
      const completedEvent: CareEvent = {
        eventId: "EVT-E001-CAREGIVER-COMPLETED",
        elderId: chenId,
        eventType: "caregiver_completed",
        timestamp: "2026-06-10T20:25:00+08:00",
        title: "护工A已查看陈伯，已确认晚药，陈伯目前在房间休息",
        source: "caregiver",
        severity: "observation",
        payload: {
          note,
        },
        status: "resolved",
        linkedTaskId: activeTask?.taskId,
        handledBy: "护工A",
        handledAt: "2026-06-10T20:25:00+08:00",
      };

      return {
        ...state,
        snapshots: {
          ...state.snapshots,
          [chenId]: {
            ...state.snapshots[chenId],
            medicationEvening: "confirmed",
            locationZone: "房间 203",
            lastSyncedAt: "2026-06-10T20:25:00+08:00",
          },
        },
        medicationPlans: confirmEveningMedicationPlan(state.medicationPlans),
        events: addEventOnce(addEventOnce(state.events, medicationEvent), completedEvent),
        tasks: state.tasks.map((task) =>
          activeTask && task.taskId === activeTask.taskId
            ? {
                ...task,
                status: "completed",
                updatedAt: "2026-06-10T20:25:00+08:00",
                completedAt: "2026-06-10T20:25:00+08:00",
                note,
              }
            : task,
        ),
        operationalStates: {
          ...state.operationalStates,
          [chenId]: "follow_up",
        },
      };
    }
    case "TRIGGER_SOS": {
      const existingActiveTask = selectActiveTaskForElder(chenId, state.tasks);
      const taskId = existingActiveTask?.taskId ?? nextTaskId(state.tasks, "TASK-E001-SOS");
      const sosEvent: CareEvent = {
        eventId: "EVT-E001-SOS",
        elderId: chenId,
        eventType: "sos",
        timestamp: "2026-06-10T20:18:00+08:00",
        title: "SOS 测试事件",
        rawText: "SOS 求助",
        source: "demo",
        severity: "urgent",
        status: "open",
        linkedTaskId: taskId,
      };
      const urgentTask: CareTask = {
        taskId,
        elderId: chenId,
        sourceEventId: sosEvent.eventId,
        priority: "urgent",
        title: "陈伯触发 SOS，需要立即响应",
        reason: "SOS 求助事件",
        recommendedAction:
          "立即通知护工和机构负责人，并按机构应急流程处理。",
        assignedTo: "护工A",
        status: "pending",
        createdAt: "2026-06-10T20:18:00+08:00",
        updatedAt: "2026-06-10T20:18:00+08:00",
      };

      return {
        ...state,
        events: addEventOnce(state.events, sosEvent),
        tasks: upsertActiveTask(state.tasks, chenId, urgentTask),
        operationalStates: {
          ...state.operationalStates,
          [chenId]: "pending",
        },
      };
    }
    case "SIMULATE_DATA_GAP": {
      const dataGapEvent: CareEvent = {
        eventId: "EVT-E001-DATA-GAP",
        elderId: chenId,
        eventType: "system_risk_update",
        timestamp: "2026-06-10T20:30:00+08:00",
        title: "模拟数据不足：设备佩戴或同步需确认",
        source: "demo",
        severity: "data_insufficient",
        payload: {
          previousValue: state.snapshots[chenId].dataCompleteness,
          currentValue: 0.32,
        },
      };

      return {
        ...state,
        snapshots: {
          ...state.snapshots,
          [chenId]: {
            ...state.snapshots[chenId],
            dataCompleteness: 0.32,
            wearTimeHours: 4.2,
            lastSyncedAt: "2026-06-10T20:30:00+08:00",
          },
        },
        events: addEventOnce(state.events, dataGapEvent),
        operationalStates: {
          ...state.operationalStates,
          [chenId]: "pending",
        },
      };
    }
    case "IMPORT_APPLE_HEALTH_SAMPLE": {
      const targetId = state.profiles[testAppleWatchId] ? testAppleWatchId : chenId;
      const baseSnapshot = state.snapshots[targetId] ?? createMissingSnapshot(targetId);
      return {
        ...state,
        snapshots: {
          ...state.snapshots,
          [targetId]: {
            ...baseSnapshot,
            snapshotId: "LOCAL-APPLE-HEALTH-SAMPLE",
            dataSource: "Apple Health Export",
            dataQuality: 0.88,
            heartRate: 84,
            restingHeartRate: 72,
            stepsToday: 980,
            activeMinutes: 24,
            sleepDuration: 5.1,
            wearTimeHours: 18.2,
            dataCompleteness: 0.88,
            lastSyncedAt: new Date().toISOString(),
          },
        },
        events: addEventOnce(state.events, {
          eventId: `EVT-${targetId}-APPLE-HEALTH-IMPORT`,
          elderId: targetId,
          eventType: "system_risk_update",
          timestamp: new Date().toISOString(),
          title: "已导入 Apple Health Export 示例快照",
          source: "system",
          severity: "attention",
          payload: {
            note: "Apple Health Export",
          },
        }),
      };
    }
    case "CREATE_MEMORY_DRAFT":
      return {
        ...state,
        memoryDraftsByElderId: {
          ...state.memoryDraftsByElderId,
          [action.draft.elderId]: action.draft,
        },
        mockBackendLogs: appendBackendLog(
          state.mockBackendLogs,
          createBackendLog("/api/memory/intake", "POST", "当前为前端 Mock：生成初始照护记忆草稿", {
            elder_id: action.draft.elderId,
            item_count: action.draft.items.length,
          }),
        ),
      };
    case "CONFIRM_MEMORY_ITEM": {
      const draft = state.memoryDraftsByElderId[action.elderId];
      if (!draft) return state;
      return {
        ...state,
        memoryDraftsByElderId: {
          ...state.memoryDraftsByElderId,
          [action.elderId]: {
            ...draft,
            updatedAt: isoNow(),
            items: draft.items.map((item): CareMemoryItem =>
              item.id === action.itemId
                ? {
                    ...item,
                    content: action.content ?? item.content,
                    confirmationStatus: action.status,
                    confirmedBy:
                      action.status === "confirmed" ? "Demo 操作员" : item.confirmedBy,
                    confirmedAt: action.status === "confirmed" ? isoNow() : item.confirmedAt,
                    updatedAt: isoNow(),
                  }
                : item,
            ),
          },
        },
        mockBackendLogs: appendBackendLog(
          state.mockBackendLogs,
          createBackendLog(
            `/api/memory/${action.itemId}/confirm`,
            "PATCH",
            "当前为前端 Mock：更新记忆条目确认状态",
            {
              memory_id: action.itemId,
              confirmation_status: action.status,
            },
          ),
        ),
      };
    }
    case "SAVE_INITIAL_CARE_MEMORY": {
      const draft = state.memoryDraftsByElderId[action.elderId];
      if (!draft) return state;
      const saved: InitialCareMemory = {
        ...draft,
        updatedAt: isoNow(),
        items: draft.items.filter((item) => item.confirmationStatus !== "rejected"),
      };
      const profile = state.profiles[action.elderId];
      const riskTags = Array.from(
        new Set([...(profile?.riskTags ?? []), ...saved.riskTags]),
      );
      return {
        ...state,
        profiles: profile
          ? {
              ...state.profiles,
              [action.elderId]: {
                ...profile,
                riskTags,
              },
            }
          : state.profiles,
        initialCareMemoryByElderId: {
          ...state.initialCareMemoryByElderId,
          [action.elderId]: saved,
        },
        memoryDraftsByElderId: {
          ...state.memoryDraftsByElderId,
          [action.elderId]: saved,
        },
      };
    }
    case "IMPORT_WEARABLE_DATA": {
      const latest = latestWearableSnapshot(action.snapshots);
      const previousImports = state.wearableImports[action.elderId] ?? [];
      const importRecord: WearableImportRecord = {
        importId: `IMP-${action.elderId}-${Date.now()}`,
        elderId: action.elderId,
        source: action.source,
        importedAt: isoNow(),
        rowCount: action.snapshots.length,
        snapshots: action.snapshots,
      };
      const currentSnapshot = state.snapshots[action.elderId];
      const currentDevice = state.deviceRecords[action.elderId];
      const trend = state.trends[action.elderId];
      const updatedTrend =
        trend && action.snapshots.length
          ? {
              ...trend,
              points: action.snapshots.slice(-7).map((point) => ({
                date: point.date.slice(5).replace("-", "/"),
                steps: point.steps,
                sleepHours: point.sleepDuration,
                medicationOnTimeRate:
                  currentSnapshot?.medicationEvening === "confirmed" ? 1 : 0.5,
                riskLevel:
                  point.dataQuality < 0.4
                    ? ("data_insufficient" as const)
                    : ("observation" as const),
              })),
            }
          : trend;

      return {
        ...state,
        wearableImports: {
          ...state.wearableImports,
          [action.elderId]: [importRecord, ...previousImports].slice(0, 5),
        },
        snapshots:
          latest && currentSnapshot
            ? {
                ...state.snapshots,
                [action.elderId]: {
                  ...currentSnapshot,
                  id: latest.id,
                  date: latest.date,
                  dataSource: action.source,
                  heartRate: latest.heartRateAvg,
                  restingHeartRate: latest.restingHeartRate,
                  stepsToday: latest.steps,
                  activeMinutes: latest.activeMinutes,
                  sleepDuration: latest.sleepDuration,
                  wearTimeHours: latest.wearTimeHours,
                  dataCompleteness: latest.dataQuality,
                  dataQuality: latest.dataQuality,
                  lastSyncedAt: latest.importedAt ?? currentSnapshot.lastSyncedAt,
                  importedAt: latest.importedAt ?? currentSnapshot.importedAt,
                },
              }
            : state.snapshots,
        trends:
          updatedTrend && trend
            ? {
                ...state.trends,
                [action.elderId]: updatedTrend,
              }
            : state.trends,
        deviceRecords:
          latest && currentDevice
            ? {
                ...state.deviceRecords,
                [action.elderId]: {
                  ...currentDevice,
                  connectionStatus: "online",
                  wearStatus: (latest.wearTimeHours ?? 0) >= 6 ? "worn" : "not_worn",
                  lastSyncAt: latest.importedAt ?? currentDevice.lastSyncAt,
                  dataQuality: latest.dataQuality,
                  dataSource: action.source,
                  todayWearTimeHours: latest.wearTimeHours ?? 0,
                },
              }
            : state.deviceRecords,
        mockBackendLogs: appendBackendLog(
          state.mockBackendLogs,
          createBackendLog("/api/wearable/import", "POST", "当前为前端 Mock：穿戴数据导入完成", {
            elder_id: action.elderId,
            row_count: action.snapshots.length,
            data_source: action.source,
          }),
        ),
      };
    }
    case "UPDATE_DEVICE_STATUS": {
      const device = state.deviceRecords[action.elderId];
      if (!device) return state;
      return {
        ...state,
        deviceRecords: {
          ...state.deviceRecords,
          [action.elderId]: {
            ...device,
            ...action.patch,
          },
        },
      };
    }
    case "TRIGGER_HARDWARE_EVENT": {
      const copy = hardwareEventCopy[action.eventType];
      if (!copy) return state;
      const timestamp = isoNow();
      const device = state.deviceRecords[action.elderId];
      const event: CareEvent = {
        eventId: createEventId(action.elderId, action.eventType),
        elderId: action.elderId,
        eventType: action.eventType,
        timestamp,
        title: copy.title,
        rawText:
          action.eventType === "sos_long_press" || action.eventType === "sos_triple_press"
            ? "SOS 求助"
            : undefined,
        source: "hardware_simulator",
        severity: copy.severity,
        payload: {
          noResponseSeconds: action.eventType === "no_response_after_fall" ? 30 : undefined,
          deviceId: device?.deviceId,
          batteryLevel:
            action.eventType === "device_low_battery" ? 12 : device?.batteryLevel,
          sourceType: copy.sourceType,
        },
        status: copy.priority === "low" ? "acknowledged" : "open",
      };
      const shouldCreateTask = action.eventType !== "device_reconnected";
      const task = shouldCreateTask ? buildTaskFromEvent(state.tasks, action.elderId, event, copy) : undefined;
      const updatedDevice =
        device && action.eventType === "device_not_worn"
          ? {
              ...device,
              wearStatus: "not_worn" as DeviceWearStatus,
              dataQuality: 0.28,
              todayWearTimeHours: 2.5,
              lastSyncAt: timestamp,
            }
          : device && action.eventType === "device_low_battery"
            ? {
                ...device,
                batteryLevel: 12,
                lastSyncAt: timestamp,
              }
            : device && action.eventType === "device_reconnected"
              ? {
                  ...device,
                  connectionStatus: "online" as DeviceConnectionStatus,
                  wearStatus: "worn" as DeviceWearStatus,
                  dataQuality: 0.8,
                  todayWearTimeHours: Math.max(device.todayWearTimeHours, 12),
                  lastSyncAt: timestamp,
                }
              : device;
      const currentSnapshot = state.snapshots[action.elderId];
      const nextSnapshot =
        currentSnapshot && action.eventType === "device_not_worn"
          ? {
              ...currentSnapshot,
              dataCompleteness: 0.28,
              dataQuality: 0.28,
              wearTimeHours: 2.5,
              lastSyncedAt: timestamp,
            }
          : currentSnapshot && action.eventType === "device_reconnected"
            ? {
                ...currentSnapshot,
                dataCompleteness: 0.8,
                dataQuality: 0.8,
                wearTimeHours: Math.max(currentSnapshot.wearTimeHours ?? 0, 12),
                lastSyncedAt: timestamp,
              }
            : currentSnapshot && action.eventType === "fall_detected"
              ? {
                  ...currentSnapshot,
                  fallDetected: true,
                  lastSyncedAt: timestamp,
                }
              : currentSnapshot;

      return {
        ...state,
        deviceRecords:
          updatedDevice && device
            ? {
                ...state.deviceRecords,
                [action.elderId]: updatedDevice,
              }
            : state.deviceRecords,
        snapshots:
          nextSnapshot && currentSnapshot
            ? {
                ...state.snapshots,
                [action.elderId]: nextSnapshot,
              }
            : state.snapshots,
        events: addEventOnce(state.events, task ? { ...event, linkedTaskId: task.taskId } : event),
        tasks: task ? upsertActiveTask(state.tasks, action.elderId, task) : state.tasks,
        operationalStates: {
          ...state.operationalStates,
          [action.elderId]: copy.priority === "low" ? "in_progress" : "pending",
        },
        mockBackendLogs: appendBackendLog(
          appendBackendLog(
            state.mockBackendLogs,
            createBackendLog("/api/events", "POST", "当前为前端 Mock：硬件事件已生成", {
              elder_id: action.elderId,
              event_type: action.eventType,
            }),
          ),
          createBackendLog("/api/agent/analyze", "POST", "当前为前端 Mock：事件将触发 Agent 分析", {
            elder_id: action.elderId,
            target_outputs: ["caregiver_summary", "family_summary", "institution_summary"],
          }),
        ),
      };
    }
    case "SIMULATE_VOICE_INPUT": {
      const text = action.text.trim();
      if (!text) return state;
      const isWandering = text.includes("找不到路") || text.includes("不知道在哪里");
      const isMedicationQuery = text.includes("吃什么药") || text.includes("药");
      const eventType: CareEvent["eventType"] = isWandering
        ? "wandering_help"
        : isMedicationQuery
          ? "medication_query"
          : "voice_symptom";
      const severity = isWandering ? "high_risk" : text.includes("胸口") ? "urgent" : "high_risk";
      const timestamp = isoNow();
      const taskId = nextTaskId(state.tasks, `TASK-${action.elderId}-VOICE`);
      const event: CareEvent = {
        eventId: createEventId(action.elderId, eventType),
        elderId: action.elderId,
        eventType,
        timestamp,
        title: `文字模拟语音：${text}`,
        rawText: text,
        source: "voice_simulator",
        severity,
        payload: {
          symptomKeywords: [text],
          safeZoneStatus: isWandering ? "outside" : undefined,
          sourceType: isWandering ? "location_event" : "voice_event",
        },
        status: "open",
        linkedTaskId: taskId,
        confidence: 0.92,
      };
      const task: CareTask = {
        taskId,
        elderId: action.elderId,
        sourceEventId: event.eventId,
        priority: severity === "urgent" ? "urgent" : "high",
        title: isWandering ? "陈伯位置需要立即确认" : "陈伯语音反馈需查看",
        reason: isWandering
          ? "老人表示找不到路，触发走失 / 地理围栏模拟"
          : `老人语音反馈：${text}`,
        recommendedAction: isWandering
          ? "请护工先确认老人所在区域，不展示精确轨迹。"
          : "请护工查看是否已进食和服药，并观察不适是否持续。",
        assignedTo: "护工A",
        status: "pending",
        sourceType: isWandering ? "location_event" : "voice_event",
        agentSummarySource: "mock",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const currentSnapshot = state.snapshots[action.elderId];
      return {
        ...state,
        snapshots:
          currentSnapshot && isWandering
            ? {
                ...state.snapshots,
                [action.elderId]: {
                  ...currentSnapshot,
                  locationZone: "长者中心二楼走廊外侧",
                  safeZoneStatus: "outside",
                  lastSyncedAt: timestamp,
                },
              }
            : state.snapshots,
        events: addEventOnce(state.events, event),
        tasks: upsertActiveTask(state.tasks, action.elderId, task),
        operationalStates: {
          ...state.operationalStates,
          [action.elderId]: "pending",
        },
        mockBackendLogs: appendBackendLog(
          state.mockBackendLogs,
          createBackendLog("/api/events", "POST", "当前为文字模拟语音输入，后续可接 ASR", {
            elder_id: action.elderId,
            event_type: eventType,
            raw_text: text,
          }),
        ),
      };
    }
    case "SIMULATE_GEOFENCE_EXIT": {
      const currentSnapshot = state.snapshots[action.elderId];
      const timestamp = isoNow();
      const taskId = nextTaskId(state.tasks, `TASK-${action.elderId}-GEOFENCE`);
      const event: CareEvent = {
        eventId: createEventId(action.elderId, "geofence_exit"),
        elderId: action.elderId,
        eventType: "geofence_exit",
        timestamp,
        title: "模拟离开安全区：长者中心二楼外侧",
        source: "hardware_simulator",
        severity: "high_risk",
        payload: {
          locationZone: "长者中心二楼外侧",
          safeZoneStatus: "outside",
          sourceType: "location_event",
        },
        status: "open",
        linkedTaskId: taskId,
      };
      const task: CareTask = {
        taskId,
        elderId: action.elderId,
        sourceEventId: event.eventId,
        priority: "high",
        title: "陈伯离开安全区，需确认位置",
        reason: "地理围栏模拟事件：离开安全区",
        recommendedAction: "请护工确认老人所在区域；家属端仅显示机构已收到提醒。",
        assignedTo: "护工A",
        status: "pending",
        sourceType: "location_event",
        agentSummarySource: "mock",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      return {
        ...state,
        snapshots: currentSnapshot
          ? {
              ...state.snapshots,
              [action.elderId]: {
                ...currentSnapshot,
                locationZone: "长者中心二楼外侧",
                safeZoneStatus: "outside",
                lastSyncedAt: timestamp,
              },
            }
          : state.snapshots,
        events: addEventOnce(state.events, event),
        tasks: upsertActiveTask(state.tasks, action.elderId, task),
        operationalStates: {
          ...state.operationalStates,
          [action.elderId]: "pending",
        },
        mockBackendLogs: appendBackendLog(
          state.mockBackendLogs,
          createBackendLog("/api/events", "POST", "当前为前端 Mock：地理围栏事件已生成", {
            elder_id: action.elderId,
            event_type: "geofence_exit",
          }),
        ),
      };
    }
    case "SIMULATE_FALL_EVENT":
      return demoReducer(state, {
        type: "TRIGGER_HARDWARE_EVENT",
        elderId: action.elderId,
        eventType: action.stage,
      });
    case "GENERATE_AGENT_SUMMARY":
      return {
        ...state,
        agentTraces: {
          ...state.agentTraces,
          [action.trace.elderId]: action.trace,
        },
        mockBackendLogs: appendBackendLog(
          state.mockBackendLogs,
          createBackendLog("/api/agent/analyze", "POST", "当前为 Mock Agent：摘要已重新生成", {
            elder_id: action.trace.elderId,
            status: action.trace.status,
          }),
        ),
      };
    case "SIMULATE_AGENT_FAILURE": {
      const profile = state.profiles[action.elderId];
      if (!profile) return state;
      const events = getEventsForElder(state, action.elderId);
      const risk = getRiskForElder(state, action.elderId);
      const summaries = getAgentSummariesForElder(state, action.elderId);
      const trace = buildAgentTrace({
        profile,
        baseline: state.baselines[action.elderId],
        snapshot: state.snapshots[action.elderId],
        events,
        risk,
        summaries,
        initialCareMemory: state.initialCareMemoryByElderId[action.elderId],
        deviceRecord: state.deviceRecords[action.elderId],
        status: "failed",
      });
      return {
        ...state,
        agentTraces: {
          ...state.agentTraces,
          [action.elderId]: trace,
        },
        mockBackendLogs: appendBackendLog(
          state.mockBackendLogs,
          createBackendLog("/api/agent/analyze", "POST", "当前为前端 Mock：模拟 Agent 失败", {
            elder_id: action.elderId,
          }),
        ),
      };
    }
    case "FALLBACK_TO_RULE_SUMMARY":
      return {
        ...state,
        agentTraces: {
          ...state.agentTraces,
          [action.trace.elderId]: action.trace,
        },
        mockBackendLogs: appendBackendLog(
          state.mockBackendLogs,
          createBackendLog("/api/agent/analyze", "POST", "Agent 暂不可用，已 fallback 到规则摘要", {
            elder_id: action.trace.elderId,
          }),
        ),
      };
    case "UPDATE_CONSENT": {
      const record = state.consentRecords[action.elderId];
      if (!record) return state;
      return {
        ...state,
        consentRecords: {
          ...state.consentRecords,
          [action.elderId]: {
            ...record,
            [action.field]: action.value,
            updatedAt: isoNow(),
          },
        },
      };
    }
    case "UPDATE_PILOT_STATUS":
      return {
        ...state,
        pilotPlanStatus: action.status,
      };
    case "GENERATE_WEEKLY_SUMMARY":
      return {
        ...state,
        weeklySummaries: {
          ...state.weeklySummaries,
          [action.summary.elderId]: action.summary,
        },
      };
    case "ADD_BACKEND_LOG":
      return {
        ...state,
        mockBackendLogs: appendBackendLog(state.mockBackendLogs, action.log),
      };
    default:
      return state;
  }
};

const loadInitialState = () => {
  if (typeof window === "undefined") return createInitialDemoState();
  const saved = window.localStorage.getItem(storageKey);
  if (!saved) return createInitialDemoState();
  try {
    const parsed = JSON.parse(saved) as Partial<DemoState>;
    const initial = createInitialDemoState();
    const migratedSnapshots = parsed.snapshots
      ? Object.fromEntries(
          Object.entries(parsed.snapshots).map(([elderId, snapshot]) => [
            elderId,
            {
              ...snapshot,
              dataQuality: migratePersistedDataQuality(snapshot.dataQuality),
            },
          ]),
        )
      : {};
    return {
      ...initial,
      ...parsed,
      profiles: { ...initial.profiles, ...parsed.profiles },
      baselines: { ...initial.baselines, ...parsed.baselines },
      snapshots: { ...initial.snapshots, ...migratedSnapshots },
      medicationPlans: { ...initial.medicationPlans, ...parsed.medicationPlans },
      contacts: { ...initial.contacts, ...parsed.contacts },
      profileDetails: { ...initial.profileDetails, ...parsed.profileDetails },
      trends: { ...initial.trends, ...parsed.trends },
      events: parsed.events ?? initial.events,
      tasks: parsed.tasks ?? initial.tasks,
      operationalStates: { ...initial.operationalStates, ...parsed.operationalStates },
      backendRiskResults: { ...initial.backendRiskResults, ...parsed.backendRiskResults },
      agentOutputs: { ...initial.agentOutputs, ...parsed.agentOutputs },
      agentRunStates: { ...initial.agentRunStates, ...parsed.agentRunStates },
      backend: parsed.backend ?? initial.backend,
      initialCareMemoryByElderId:
        parsed.initialCareMemoryByElderId ?? initial.initialCareMemoryByElderId,
      memoryDraftsByElderId:
        parsed.memoryDraftsByElderId ?? initial.memoryDraftsByElderId,
      wearableImports: parsed.wearableImports ?? initial.wearableImports,
      deviceRecords: parsed.deviceRecords ?? initial.deviceRecords,
      agentMode: parsed.agentMode ?? initial.agentMode,
      agentTraces: parsed.agentTraces ?? initial.agentTraces,
      mockBackendLogs: parsed.mockBackendLogs ?? initial.mockBackendLogs,
      consentRecords: parsed.consentRecords ?? initial.consentRecords,
      pilotPlanStatus: parsed.pilotPlanStatus ?? initial.pilotPlanStatus,
      weeklySummaries: parsed.weeklySummaries ?? initial.weeklySummaries,
    };
  } catch {
    return createInitialDemoState();
  }
};

const normalizedHardwareEvent = (
  elderId: string,
  eventType: CareEvent["eventType"],
): BackendEventInput => {
  const common = {
    elder_id: elderId,
    source: "esp32",
    timestamp: new Date().toISOString(),
  };
  if (eventType === "button_confirm") {
    return {
      ...common,
      event_type: "medication",
      raw_text: "Short press confirmation",
      payload: { action: "confirmed", button_pattern: "short_press" },
    };
  }
  if (eventType === "sos_long_press" || eventType === "sos_triple_press" || eventType === "sos") {
    return {
      ...common,
      event_type: "sos",
      raw_text: "CareBand SOS request",
      payload: {
        action: eventType === "sos_triple_press" ? "triple_press" : "long_press",
        button_pattern: eventType === "sos_triple_press" ? "triple_press" : "long_press",
      },
    };
  }
  if (["fall_detected", "inactivity_after_fall", "no_response_after_fall"].includes(eventType)) {
    const action =
      eventType === "no_response_after_fall"
        ? "no_response"
        : eventType === "inactivity_after_fall"
          ? "inactivity_after_fall"
          : "detected";
    return {
      ...common,
      event_type: "fall",
      raw_text: "CareBand fall signal requiring human verification",
      payload: { action, confidence: eventType === "fall_detected" ? 0.9 : 0.85 },
    };
  }
  const deviceActions: Record<string, string> = {
    device_not_worn: "not_worn",
    device_low_battery: "low_battery",
    device_reconnected: "reconnected",
    night_wakeup: "night_wakeup",
    low_activity: "low_activity",
  };
  return {
    ...common,
    event_type: "device_status",
    raw_text: "CareBand device status update",
    payload: { action: deviceActions[eventType] ?? "status_update" },
  };
};

const normalizedVoiceEvent = (elderId: string, text: string): BackendEventInput => {
  const isWandering = text.includes("路") || text.toLowerCase().includes("lost");
  const isMedicationQuery = text.includes("药") || text.toLowerCase().includes("medication");
  return {
    elder_id: elderId,
    event_type: "voice",
    source: "mobile_app",
    timestamp: new Date().toISOString(),
    raw_text: text,
    payload: {
      action: isWandering
        ? "wandering_help"
        : isMedicationQuery
          ? "medication_query"
          : "symptom_report",
      transcript_summary: text.slice(0, 160),
      symptom_keywords: isWandering || isMedicationQuery ? [] : [text],
    },
  };
};

export const DemoProvider = ({ children }: { children: ReactNode }) => {
  const [state, rawDispatch] = useReducer(demoReducer, undefined, loadInitialState);

  const refreshDashboard = useCallback(async () => {
    const dashboard = await apiGetDashboard();
    rawDispatch({
      type: "HYDRATE_FROM_BACKEND",
      payload: mapDashboardToDemoState(dashboard, state),
      syncedAt: dashboard.generated_at,
    });
  }, [state]);

  const submitEventAndRefresh = useCallback(
    async (event: BackendEventInput) => {
      const result = await submitNormalizedEvent(event);
      try {
        await refreshDashboard();
      } catch (error) {
        if (result.agentError) {
          rawDispatch({
            type: "SET_AGENT_FAILURE",
            elderId: event.elder_id,
            requestedProvider:
              state.agentRunStates[event.elder_id]?.requestedProvider ??
              (state.agentMode === "mock" ? "qwenpaw" : state.agentMode),
            warning: result.agentError,
          });
        }
        throw error;
      }
      if (result.agentError) {
        rawDispatch({
          type: "SET_AGENT_FAILURE",
          elderId: event.elder_id,
          requestedProvider:
            state.agentRunStates[event.elder_id]?.requestedProvider ??
            (state.agentMode === "mock" ? "qwenpaw" : state.agentMode),
          warning: result.agentError,
        });
      }
    },
    [refreshDashboard, state.agentMode, state.agentRunStates],
  );

  useEffect(() => {
    refreshDashboard().catch((error) => {
      console.warn("CareBand backend dashboard fallback:", error);
      rawDispatch({
        type: "SET_BACKEND_STATUS",
        payload: {
          mode: "unavailable",
          error: backendFallbackMessage,
        },
      });
    });
  }, []);

  const dispatch: Dispatch<DemoAction> = useCallback(
    (action) => {
      const run = async () => {
        if (action.type === "HYDRATE_FROM_BACKEND" || action.type === "SET_BACKEND_STATUS") {
          rawDispatch(action);
          return;
        }

        if (action.type === "RESET_DEMO") {
          try {
            await apiResetDemo();
            const dashboard = await apiGetDashboard();
            const fresh = createInitialDemoState();
            rawDispatch(action);
            rawDispatch({
              type: "HYDRATE_FROM_BACKEND",
              payload: mapDashboardToDemoState(dashboard, fresh),
              syncedAt: dashboard.generated_at,
            });
          } catch (error) {
            console.warn("CareBand backend reset fallback:", error);
            rawDispatch(action);
          }
          return;
        }

        try {
          if (action.type === "TRIGGER_CHEN_DIZZINESS") {
            await submitEventAndRefresh(
              normalizedVoiceEvent(chenId, "我有点头晕，不太舒服"),
            );
            return;
          }

          if (action.type === "TRIGGER_SOS") {
            await submitEventAndRefresh(
              normalizedHardwareEvent(chenId, "sos_long_press"),
            );
            return;
          }

          if (action.type === "SIMULATE_DATA_GAP") {
            await apiPostSnapshot({
              elder_id: chenId,
              date: new Date().toISOString().slice(0, 10),
              data_source: "Demo Control",
              heart_rate_avg: null,
              resting_heart_rate: null,
              steps: 220,
              active_minutes: 4,
              sleep_duration: null,
              wear_time_hours: 3.2,
              data_quality: 32,
            });
            await refreshDashboard();
            return;
          }

          if (action.type === "IMPORT_APPLE_HEALTH_SAMPLE") {
            await apiPostSnapshot({
              elder_id: testAppleWatchId,
              date: new Date().toISOString().slice(0, 10),
              data_source: "Apple Health Export",
              heart_rate_avg: 84,
              resting_heart_rate: 72,
              steps: 980,
              active_minutes: 24,
              sleep_duration: 5.1,
              wear_time_hours: 18.2,
              data_quality: 88,
            });
            await refreshDashboard();
            return;
          }

          if (action.type === "TRIGGER_HARDWARE_EVENT") {
            await submitEventAndRefresh(
              normalizedHardwareEvent(action.elderId, action.eventType),
            );
            return;
          }

          if (action.type === "SIMULATE_FALL_EVENT") {
            await submitEventAndRefresh(
              normalizedHardwareEvent(action.elderId, action.stage),
            );
            return;
          }

          if (action.type === "SIMULATE_VOICE_INPUT") {
            await submitEventAndRefresh(normalizedVoiceEvent(action.elderId, action.text));
            return;
          }

          if (action.type === "SIMULATE_GEOFENCE_EXIT") {
            await submitEventAndRefresh({
              elder_id: action.elderId,
              event_type: "location",
              source: "dashboard",
              timestamp: new Date().toISOString(),
              raw_text: "Elder moved outside the configured safe zone.",
              payload: { action: "geofence_exit", safe_zone_status: "outside" },
            });
            return;
          }

          if (action.type === "GENERATE_AGENT_SUMMARY") {
            try {
              await apiAnalyzeAgent({ elder_id: action.trace.elderId });
              await refreshDashboard();
            } catch (agentError) {
              let dashboardUnavailable = false;
              try {
                await refreshDashboard();
              } catch {
                dashboardUnavailable = true;
              }
              rawDispatch({
                type: "SET_AGENT_FAILURE",
                elderId: action.trace.elderId,
                requestedProvider:
                  state.agentRunStates[action.trace.elderId]?.requestedProvider ??
                  (state.agentMode === "mock" ? "qwenpaw" : state.agentMode),
                warning:
                  agentError instanceof Error
                    ? agentError.message
                    : "Agent request failed.",
              });
              if (dashboardUnavailable) throw agentError;
            }
            return;
          }

          if (action.type === "CAREGIVER_ACCEPT_TASK") {
            const activeTask = selectActiveTaskForElder(chenId, state.tasks);
            if (!activeTask) throw new Error("No active task to accept.");
            await apiPatchTask(activeTask.taskId, {
              status: "acknowledged",
              handled_by: "护工A",
            });
            await submitEventAndRefresh({
              elder_id: chenId,
              event_type: "manual_note",
              source: "dashboard",
              raw_text: "护工A已接单，正在查看陈伯情况",
              payload: { action: "caregiver_accepted", note: "护工A已接单" },
            });
            return;
          }

          if (action.type === "CAREGIVER_MARK_VIEWED") {
            const activeTask = selectActiveTaskForElder(chenId, state.tasks);
            if (!activeTask) throw new Error("No active task to mark viewed.");
            await apiPatchTask(activeTask.taskId, {
              status: "in_progress",
              handled_by: "护工A",
            });
            await submitEventAndRefresh({
              elder_id: chenId,
              event_type: "manual_note",
              source: "dashboard",
              raw_text: "护工A已到场查看陈伯",
              payload: { action: "caregiver_checked", note: "护工A已到场查看" },
            });
            return;
          }

          if (action.type === "CONFIRM_EVENING_MEDICATION") {
            await submitEventAndRefresh({
              elder_id: chenId,
              event_type: "medication",
              source: "dashboard",
              raw_text: "晚药已确认",
              payload: { action: "confirmed", medication_name: "晚药" },
            });
            return;
          }

          if (action.type === "COMPLETE_CARE_TASK") {
            const activeTask = selectActiveTaskForElder(chenId, state.tasks);
            if (!activeTask) throw new Error("No active task to complete.");
            const handledNote =
              "护工A已查看陈伯，已确认晚药，目前在房间休息，建议明早继续关注活动和睡眠。";
            await completeCareTaskOnBackend(
              {
                taskId: activeTask.taskId,
                elderId: chenId,
                handledBy: "护工A",
                handledNote,
              },
              { patchTask: apiPatchTask, submitEvent: submitEventAndRefresh },
            );
            return;
          }

          rawDispatch(action);
        } catch (error) {
          console.warn("CareBand backend action fallback:", error);
          const isTaskMutation = isBackendAuthoritativeTaskAction(action.type);
          if (isTaskMutation) {
            try {
              await refreshDashboard();
              rawDispatch({
                type: "SET_BACKEND_STATUS",
                payload: {
                  mode: "connected",
                  lastSyncedAt: state.backend.lastSyncedAt,
                  error: `任务流程未完整执行：${
                    error instanceof Error ? error.message : "未知后端错误"
                  }`,
                },
              });
            } catch (refreshError) {
              rawDispatch({
                type: "SET_BACKEND_STATUS",
                payload: {
                  mode: "unavailable",
                  error:
                    refreshError instanceof Error
                      ? refreshError.message
                      : backendFallbackMessage,
                },
              });
            }
            return;
          }
          const fallbackElderId =
            action.type === "TRIGGER_HARDWARE_EVENT" ||
            action.type === "SIMULATE_FALL_EVENT" ||
            action.type === "SIMULATE_VOICE_INPUT" ||
            action.type === "SIMULATE_GEOFENCE_EXIT"
              ? action.elderId
              : action.type === "TRIGGER_CHEN_DIZZINESS" ||
                  action.type === "TRIGGER_SOS" ||
                  action.type === "CAREGIVER_ACCEPT_TASK" ||
                  action.type === "CAREGIVER_MARK_VIEWED" ||
                  action.type === "CONFIRM_EVENING_MEDICATION" ||
                  action.type === "COMPLETE_CARE_TASK"
                ? chenId
                : action.type === "GENERATE_AGENT_SUMMARY"
                  ? action.trace.elderId
                  : null;
          if (fallbackElderId) {
            rawDispatch({
              type: "SET_AGENT_FAILURE",
              elderId: fallbackElderId,
              requestedProvider:
                state.agentRunStates[fallbackElderId]?.requestedProvider ??
                (state.agentMode === "mock" ? "qwenpaw" : state.agentMode),
              warning:
                error instanceof Error
                  ? error.message
                  : "Backend unavailable; using deterministic local fallback.",
            });
          }
          rawDispatch({
            type: "SET_BACKEND_STATUS",
            payload: {
              mode: "unavailable",
              error: backendFallbackMessage,
            },
          });
          rawDispatch(action);
        }
      };

      void run();
    },
    [refreshDashboard, state, submitEventAndRefresh],
  );

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  }, [state]);

  const value = useMemo(() => ({ state, dispatch }), [state]);

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
};

export const useDemo = () => {
  const context = useContext(DemoContext);
  if (!context) {
    throw new Error("useDemo must be used inside DemoProvider");
  }
  return context;
};

export const getEventsForElder = (state: DemoState, elderId: string) =>
  state.events.filter((event) => event.elderId === elderId);

export const getTaskForElder = (state: DemoState, elderId: string) =>
  selectActiveTaskForElder(elderId, state.tasks) ??
  getLatestTaskForElder(elderId, state.tasks);

export const getActiveTaskForElder = (state: DemoState, elderId: string) =>
  selectActiveTaskForElder(elderId, state.tasks);

export const getTaskHistoryForElder = (state: DemoState, elderId: string) =>
  selectTaskHistoryForElder(elderId, state.tasks);

export const getRiskForElder = (
  state: DemoState,
  elderId: string,
): RiskResult => {
  if (state.backendRiskResults[elderId]) return state.backendRiskResults[elderId];
  return calculateRisk({
    profile: state.profiles[elderId],
    baseline: state.baselines[elderId],
    snapshot: state.snapshots[elderId],
    events: getEventsForElder(state, elderId),
  });
};

export const getAgentSummariesForElder = (
  state: DemoState,
  elderId: string,
): AgentRoleSummaries => {
  const agentOutput = state.agentOutputs[elderId];
  if (agentOutput) {
    const sourceLabel = {
      qwenpaw: "真实 QwenPaw",
      openai: "真实 OpenAI",
      mock: agentOutput.fallbackUsed ? "Mock fallback" : "确定性 Mock",
    }[agentOutput.agentSource];
    return {
      caregiverSummary: agentOutput.caregiverSummary,
      familySummary: agentOutput.familySummary,
      institutionSummary: agentOutput.institutionSummary,
      decisionTrace: [
        `Agent 来源：${sourceLabel}`,
        ...agentOutput.keyReasons,
        `建议动作：${agentOutput.recommendedAction}`,
        agentOutput.safetyDisclaimer,
      ],
      agentSource: agentOutput.agentSource,
      requestedProvider: agentOutput.requestedProvider,
      model: agentOutput.model,
      durationMs: agentOutput.durationMs,
      validationStatus: agentOutput.validationStatus,
      fallbackUsed: agentOutput.fallbackUsed,
      warning: agentOutput.warning,
      generatedAt: agentOutput.createdAt,
    };
  }

  const events = getEventsForElder(state, elderId);
  const risk = getRiskForElder(state, elderId);
  const careLoopStatus = deriveCareLoopStatus(elderId, state.tasks, events);
  const displayStatus = deriveDisplayStatus(risk, careLoopStatus);

  const localSummaries = generateAgentSummaries(
    state.profiles[elderId],
    state.baselines[elderId],
    state.snapshots[elderId],
    events,
    risk,
    careLoopStatus,
    displayStatus,
  );
  const latestRun = state.agentRunStates[elderId];
  if (!latestRun || latestRun.hasCurrentOutput) return localSummaries;

  return {
    ...localSummaries,
    agentSource: "mock",
    requestedProvider: latestRun.requestedProvider,
    model: latestRun.model,
    durationMs: latestRun.durationMs,
    validationStatus: latestRun.validationStatus,
    fallbackUsed: true,
    warning: latestRun.warning ?? "Latest Agent run failed; using deterministic local fallback.",
    generatedAt: latestRun.createdAt,
  };
};

export const getAgentTraceForElder = (
  state: DemoState,
  elderId: string,
): AgentTraceBundle => {
  const existing = state.agentTraces[elderId];
  if (existing) return existing;
  const events = getEventsForElder(state, elderId);
  const risk = getRiskForElder(state, elderId);
  const summaries = getAgentSummariesForElder(state, elderId);
  return buildAgentTrace({
    profile: state.profiles[elderId],
    baseline: state.baselines[elderId],
    snapshot: state.snapshots[elderId],
    events,
    risk,
    summaries,
    initialCareMemory: state.initialCareMemoryByElderId[elderId],
    deviceRecord: state.deviceRecords[elderId],
  });
};
