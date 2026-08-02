export type RiskLevel =
  | "data_insufficient"
  | "stable"
  | "observation"
  | "attention"
  | "high_risk"
  | "urgent";

export type OperationalState =
  | "normal"
  | "pending"
  | "in_progress"
  | "follow_up"
  | "completed";

export type DimensionStatus =
  | "normal"
  | "slightly_high"
  | "slightly_low"
  | "below_baseline"
  | "significantly_low"
  | "not_confirmed"
  | "confirmed"
  | "needs_attention"
  | "high_risk"
  | "data_insufficient";

export interface ElderProfile {
  elderId: string;
  name: string;
  age: number;
  gender?: string;
  room: string;
  floor: string;
  chronicConditions: string[];
  riskTags: string[];
  caregiverId: string;
  familyContactId: string;
}

export interface PersonalBaseline {
  elderId: string;
  avgSteps7d: number;
  avgSleep7d: number;
  avgActiveMinutes7d: number;
  restingHrBaseline: number;
  medicationOnTimeRate: number;
  baselineConfidence: number;
}

export type MedicationDoseStatus =
  | "confirmed"
  | "not_confirmed"
  | "delayed"
  | "not_required";

export type MedicationStatus = MedicationDoseStatus;

export type MedicationConfirmSource =
  | "elder_button"
  | "caregiver"
  | "demo"
  | "system";

export interface DailySnapshot {
  elderId: string;
  date: string;
  heartRate: number | null;
  stepsToday: number | null;
  activeMinutes: number | null;
  sleepDuration: number | null;
  medicationMorning: MedicationStatus;
  medicationEvening: MedicationStatus;
  wearTimeHours: number;
  locationZone: string;
  safeZoneStatus: "inside" | "outside" | "unknown";
  fallDetected: boolean;
  dataCompleteness: number;
  lastSyncedAt: string;
}

export interface MedicationDose {
  doseId: string;
  elderId: string;
  label: string;
  scheduledTime: string;
  medicationName: string;
  dosageText: string;
  instruction: string;
  status: MedicationDoseStatus;
  confirmedAt?: string;
  confirmedBy?: string;
  confirmSource?: MedicationConfirmSource;
  reminderEventId?: string;
  confirmedEventId?: string;
}

export interface MedicationPlan {
  elderId: string;
  planName: string;
  planSource: "mock" | "caregiver_input" | "doctor_note";
  updatedAt: string;
  notes: string;
  doses: MedicationDose[];
  medicalDisclaimer: string;
}

export interface ContactPerson {
  contactId: string;
  name: string;
  role: "caregiver" | "family" | "institution_manager" | "doctor";
  relation?: string;
  phoneMasked: string;
  visibleTo: Array<"caregiver" | "family" | "institution">;
}

export interface ConsentStatus {
  elderId: string;
  familyCanViewDailyStatus: boolean;
  familyCanViewMedicationStatus: boolean;
  familyCanViewLocationZone: boolean;
  familyCanViewVoiceSummary: boolean;
  doctorSummaryRequiresApproval: boolean;
  locationPrecision: "zone_only" | "precise";
  voiceRawTextPolicy: "summary_only" | "caregiver_only" | "visible_to_family";
  updatedAt: string;
}

export interface ElderProfileDetail {
  elderId: string;
  languagePreference: string;
  institutionName: string;
  careGroup: string;
  admissionType: string;
  primaryCaregiverId: string;
  backupCaregiverId?: string;
  primaryFamilyContactId: string;
  emergencyContactId?: string;
  consentStatus: ConsentStatus;
}

export interface CareEvent {
  eventId: string;
  elderId: string;
  eventType:
    | "medication_reminder"
    | "medication_confirmed"
    | "voice_symptom"
    | "sos"
    | "fall_detected"
    | "location_alert"
    | "night_wakeup"
    | "low_activity"
    | "caregiver_accepted"
    | "caregiver_checked"
    | "caregiver_completed"
    | "device_status"
    | "manual_note"
    | "system_risk_update";
  timestamp: string;
  title: string;
  rawText?: string;
  source: "demo" | "mock_wearable" | "caregiver" | "system" | "software_simulator";
  severity?: RiskLevel;
  payload?: {
    symptomKeywords?: string[];
    medicationName?: string;
    locationZone?: string;
    safeZoneStatus?: "inside" | "outside" | "unknown";
    nightWakeupCount?: number;
    activityDropPercent?: number;
    noResponseSeconds?: number;
    note?: string;
    previousValue?: number | string;
    currentValue?: number | string;
  };
  status?: "open" | "acknowledged" | "resolved";
  linkedTaskId?: string;
  handledBy?: string;
  handledAt?: string;
  confidence?: number;
}

export interface RiskDimensions {
  vitals: DimensionStatus;
  activity: DimensionStatus;
  sleep: DimensionStatus;
  medication: DimensionStatus;
  safety: DimensionStatus;
}

export interface RiskResult {
  elderId: string;
  riskLevel: RiskLevel;
  riskScore: number;
  dimensions: RiskDimensions;
  keyReasons: string[];
  triggeredRules: string[];
  recommendedAction: string;
  dataCompleteness: number;
  confidence: number;
  medicalDisclaimer: string;
}

export interface CareTask {
  taskId: string;
  elderId: string;
  sourceEventId?: string;
  priority: "low" | "medium" | "high" | "urgent";
  title: string;
  reason: string;
  recommendedAction: string;
  assignedTo: string;
  status: "pending" | "in_progress" | "completed";
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  note?: string;
}

export interface AgentRoleSummaries {
  caregiverSummary: string;
  familySummary: string;
  institutionSummary: string;
  decisionTrace: string[];
}

export interface TrendPoint {
  date: string;
  steps: number;
  sleepHours: number;
  medicationOnTimeRate: number;
  riskLevel: RiskLevel;
}

export interface ElderTrend {
  elderId: string;
  points: TrendPoint[];
}

export type MemorySourceType =
  | "family_oral"
  | "caregiver_input"
  | "institution_record";

export type CareMemoryCategory =
  | "general_context"
  | "communication_preference"
  | "medication_routine"
  | "safety_observation"
  | "family_preference";

export type MemoryReviewStatus = "pending" | "confirmed" | "rejected";
export type MemoryVisibility = "caregiver" | "institution" | "family";

export interface CareMemoryItem {
  id: string;
  elderId: string;
  category: CareMemoryCategory;
  content: string;
  sourceType: MemorySourceType;
  confidence: number;
  reviewStatus: MemoryReviewStatus;
  visibilityScope: MemoryVisibility[];
  updatedAt: string;
}

export interface CareMemoryDraft {
  elderId: string;
  items: CareMemoryItem[];
  createdAt: string;
  updatedAt: string;
}

export interface ConfirmedCareMemory {
  elderId: string;
  items: CareMemoryItem[];
  confirmedAt: string;
}

/**
 * Stage 13 — session-only caregiver decision for a pending voice memory draft.
 * Never persisted to localStorage and never restored on load: a fresh session
 * always starts with every draft in the implicit "pending" state, so a reload
 * cannot fabricate a confirmation or authorization.
 */
export type VoiceMemoryReviewDecision = "confirmed" | "rejected";

export type VoiceCompanionIntent =
  | "companionship"
  | "symptom_report"
  | "medication_question"
  | "past_memory"
  | "loneliness_expression"
  | "location_confusion"
  | "caregiver_request"
  | "general";

export type VoiceAttentionLevel = "routine" | "review" | "immediate_review";

export interface VoiceInteractionSignal {
  signalId: string;
  elderId: string;
  timestamp: string;
  transcriptSummary: string;
  detectedIntent: VoiceCompanionIntent;
  attentionLevel: VoiceAttentionLevel;
  shouldNotifyCaregiver: boolean;
  retentionPolicy: "summary_only";
}

export interface VoiceMemoryDraft {
  id: string;
  elderId: string;
  memoryType: "past_story" | "life_preference" | "daily_rhythm";
  contentSummary: string;
  confidence: number;
  reviewStatus: "pending";
  visibility: "caregiver_only" | "family_summary";
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Stage 6B — backend read-only sync types
// ---------------------------------------------------------------------------

/** Live connection status for the read-only dashboard sync. */
export type BackendStatus = "connecting" | "connected" | "mock";

/** Source of truth for the current view: live backend or local Mock. */
export type BackendMode = "backend" | "mock";

/** Short, safe error descriptor. Never carries body/path/stack/credentials. */
export interface BackendSyncError {
  code: string;
  message: string;
  status?: number;
}

/** Connection slice stored alongside the Mock business data. */
export interface BackendConnectionState {
  status: BackendStatus;
  mode: BackendMode;
  lastSyncedAt: string | null;
  error: BackendSyncError | null;
  readOnlyNotice: string | null;
}

export interface BackendOperationalSummary {
  elderCount: number;
  urgentCount: number;
  highRiskCount: number;
  activeTaskCount: number;
  statusDistribution: Record<string, number>;
}

/**
 * A pure, reducer-ready snapshot of a Stage 6A dashboard response. Only
 * `subject_kind === "elder"` subjects are mapped; server risk is authoritative.
 * Business data here is in-memory only (never persisted to localStorage).
 */
export interface BackendSyncPayload {
  generatedAt: string;
  profiles: Record<string, ElderProfile>;
  snapshots: Record<string, DailySnapshot>;
  events: CareEvent[];
  tasks: CareTask[];
  operationalStates: Record<string, OperationalState>;
  riskMap: Record<string, RiskResult>;
  operationalSummary: BackendOperationalSummary;
}
