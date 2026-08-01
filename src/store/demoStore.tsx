import {
  createContext,
  type Dispatch,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import { mockBaselines } from "../data/mockBaselines";
import { mockContacts } from "../data/mockContacts";
import {
  mockEvents,
  mockOperationalStates,
  mockTasks,
} from "../data/mockEvents";
import { mockMedicationPlans } from "../data/mockMedicationPlans";
import { mockProfileDetails } from "../data/mockProfileDetails";
import { mockProfiles } from "../data/mockProfiles";
import { mockSnapshots } from "../data/mockSnapshots";
import { mockTrends } from "../data/mockTrends";
import { generateAgentSummaries } from "../lib/agentFormatter";
import { fetchDashboard } from "../lib/apiClient";
import { mapDashboard } from "../lib/backendMapping";
import { deriveCareLoopStatus, deriveDisplayStatus } from "../lib/displayStatus";
import { calculateRisk } from "../lib/riskEngine";
import {
  getActiveTaskForElder as selectActiveTaskForElder,
  getLatestTaskForElder,
  getTaskHistoryForElder as selectTaskHistoryForElder,
} from "../lib/taskSelectors";
import type {
  AgentRoleSummaries,
  BackendConnectionState,
  BackendSyncError,
  BackendSyncPayload,
  CareEvent,
  CareTask,
  ContactPerson,
  DailySnapshot,
  ElderProfile,
  ElderProfileDetail,
  ElderTrend,
  MedicationPlan,
  OperationalState,
  PersonalBaseline,
  RiskResult,
} from "../types";

const storageKey = "careband-agent-demo-state-v0.1.3";
const chenId = "E001";

const READ_ONLY_NOTICE = "连接写操作将在下一切片实现";

const mockBackend = (): BackendConnectionState => ({
  status: "mock",
  mode: "mock",
  lastSyncedAt: null,
  error: null,
  readOnlyNotice: null,
});

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
  backend: BackendConnectionState;
  serverData: BackendSyncPayload | null;
}

export type DemoAction =
  | { type: "RESET_DEMO" }
  | { type: "TRIGGER_CHEN_DIZZINESS" }
  | { type: "CAREGIVER_ACCEPT_TASK" }
  | { type: "CAREGIVER_MARK_VIEWED" }
  | { type: "CONFIRM_EVENING_MEDICATION" }
  | { type: "COMPLETE_CARE_TASK" }
  | { type: "TRIGGER_SOS" }
  | { type: "SIMULATE_DATA_GAP" }
  | { type: "BACKEND_CONNECTING" }
  | { type: "BACKEND_CONNECTED"; payload: BackendSyncPayload }
  | { type: "BACKEND_FAILED"; error: BackendSyncError };

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

/** Static mock profiles used to supplement server profile display fields. */
const mockProfilesRecord = toRecord(mockProfiles);

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const createInitialDemoState = (): DemoState => ({
  profiles: toRecord(clone(mockProfiles)),
  baselines: toRecord(clone(mockBaselines)),
  snapshots: toRecord(clone(mockSnapshots)),
  medicationPlans: toRecord(clone(mockMedicationPlans)),
  contacts: toContactRecord(clone(mockContacts)),
  profileDetails: toRecord(clone(mockProfileDetails)),
  trends: toRecord(clone(mockTrends)),
  events: clone(mockEvents),
  tasks: clone(mockTasks),
  operationalStates: clone(mockOperationalStates),
  backend: mockBackend(),
  serverData: null,
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

/** Hydrate business data from an authoritative server payload (in-memory only). */
const hydrateFromBackend = (
  state: DemoState,
  payload: BackendSyncPayload,
): DemoState => ({
  ...state,
  profiles: payload.profiles,
  snapshots: payload.snapshots,
  events: payload.events,
  tasks: payload.tasks,
  operationalStates: payload.operationalStates,
  serverData: payload,
  backend: {
    status: "connected",
    mode: "backend",
    lastSyncedAt: payload.generatedAt,
    error: null,
    readOnlyNotice: null,
  },
});

export const demoReducer = (state: DemoState, action: DemoAction): DemoState => {
  // Read-only connected mode: local demo actions cannot mutate business data;
  // only a visible, safe notice is written.
  if (
    action.type !== "BACKEND_CONNECTING" &&
    action.type !== "BACKEND_CONNECTED" &&
    action.type !== "BACKEND_FAILED" &&
    state.backend.mode === "backend"
  ) {
    return {
      ...state,
      backend: { ...state.backend, readOnlyNotice: READ_ONLY_NOTICE },
    };
  }

  switch (action.type) {
    case "BACKEND_CONNECTING":
      return {
        ...state,
        backend: { ...state.backend, status: "connecting", readOnlyNotice: null },
      };
    case "BACKEND_CONNECTED":
      return hydrateFromBackend(state, action.payload);
    case "BACKEND_FAILED": {
      const failedBackend: BackendConnectionState = {
        status: "mock",
        mode: "mock",
        lastSyncedAt: null,
        error: action.error,
        readOnlyNotice: null,
      };
      // Returning from a connected backend view: reset to a clean Mock baseline
      // so no transient server values are mistaken for Mock data.
      if (state.backend.mode === "backend") {
        return { ...createInitialDemoState(), serverData: null, backend: failedBackend };
      }
      // Coming from Mock/connecting: preserve the existing Mock business state,
      // only updating the backend error state and dropping any serverData.
      return { ...state, serverData: null, backend: failedBackend };
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
    return {
      ...initial,
      ...parsed,
      profiles: parsed.profiles ?? initial.profiles,
      baselines: parsed.baselines ?? initial.baselines,
      snapshots: parsed.snapshots ?? initial.snapshots,
      medicationPlans: parsed.medicationPlans ?? initial.medicationPlans,
      contacts: parsed.contacts ?? initial.contacts,
      profileDetails: parsed.profileDetails ?? initial.profileDetails,
      trends: parsed.trends ?? initial.trends,
      events: parsed.events ?? initial.events,
      tasks: parsed.tasks ?? initial.tasks,
      operationalStates: parsed.operationalStates ?? initial.operationalStates,
      // Always boot in Mock; connected data is never restored from storage —
      // the Provider re-syncs on mount. Server data stays in-memory only.
      backend: initial.backend,
      serverData: null,
    };
  } catch {
    return createInitialDemoState();
  }
};

/**
 * Pure persistence helper. Connected (server-derived) business data is never
 * written to localStorage: in backend mode the clean Mock baseline is returned
 * instead, so no server values ever reach storage. The returned object never
 * carries a serverData property at all (not even null).
 */
export const serializeForStorage = (
  state: DemoState,
): Omit<DemoState, "serverData"> => {
  const source = state.backend.mode === "backend" ? createInitialDemoState() : state;
  const { serverData, ...persistable } = source;
  return { ...persistable, events: persistable.events.map(({ rawText, ...event }) => event) };
};

export const DemoProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(demoReducer, undefined, loadInitialState);

  // Mock mode persists local changes; connected data stays in-memory only.
  useEffect(() => {
    if (state.backend.mode === "backend") return;
    window.localStorage.setItem(
      storageKey,
      JSON.stringify(serializeForStorage(state)),
    );
  }, [state]);

  // On mount, attempt a single read-only dashboard sync. Success hydrates the
  // server view; any failure or static preview keeps the Mock data and surfaces
  // a safe error. No write operations are performed.
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      dispatch({ type: "BACKEND_CONNECTING" });
      const result = await fetchDashboard();
      if (cancelled) return;
      if (result.status === "connected") {
        try {
          const payload = mapDashboard(result.data, mockProfilesRecord);
          if (!cancelled) dispatch({ type: "BACKEND_CONNECTED", payload });
        } catch {
          if (!cancelled) {
            dispatch({
              type: "BACKEND_FAILED",
              error: {
                code: "invalid_payload",
                message: "响应映射失败，使用本地 Mock 数据",
              },
            });
          }
        }
      } else if (!cancelled) {
        dispatch({ type: "BACKEND_FAILED", error: result.error });
      }
    };
    void sync();
    return () => {
      cancelled = true;
    };
  }, []);

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
  // Connected mode: the server risk_result is the single authority. When it is
  // missing for an elder, fail closed instead of synthesizing a frontend risk.
  if (state.backend.mode === "backend") {
    const serverRisk = state.serverData?.riskMap[elderId];
    if (serverRisk) return serverRisk;
    throw new Error("authoritative server risk unavailable");
  }
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
  const events = getEventsForElder(state, elderId);
  const risk = getRiskForElder(state, elderId);
  const careLoopStatus = deriveCareLoopStatus(elderId, state.tasks, events);
  const displayStatus = deriveDisplayStatus(risk, careLoopStatus);

  return generateAgentSummaries(
    state.profiles[elderId],
    state.baselines[elderId],
    state.snapshots[elderId],
    events,
    risk,
    careLoopStatus,
    displayStatus,
  );
};
