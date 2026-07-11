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
  subjectKind?: "elder" | "team_test";
}

export interface PersonalBaseline {
  elderId: string;
  avgSteps7d: number;
  avgSleep7d: number;
  avgActiveMinutes7d: number;
  restingHrBaseline: number;
  medicationOnTimeRate: number;
  baselineConfidence: number;
  baselineLabel?: string;
  usableDays?: number;
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
  id?: string;
  elderId: string;
  date: string;
  snapshotId?: string;
  dataSource?: WearableDataSource;
  dataQuality?: number;
  heartRate: number | null;
  restingHeartRate?: number | null;
  stepsToday: number | null;
  activeMinutes: number | null;
  sleepDuration: number | null;
  medicationMorning: MedicationStatus;
  medicationEvening: MedicationStatus;
  wearTimeHours: number | null;
  locationZone: string;
  safeZoneStatus: "inside" | "outside" | "unknown";
  fallDetected: boolean;
  dataCompleteness: number;
  lastSyncedAt: string;
  importedAt?: string;
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
    | "wandering_help"
    | "medication_query"
    | "sos"
    | "button_confirm"
    | "sos_long_press"
    | "sos_triple_press"
    | "fall_detected"
    | "inactivity_after_fall"
    | "no_response_after_fall"
    | "location_alert"
    | "geofence_exit"
    | "device_not_worn"
    | "device_low_battery"
    | "device_reconnected"
    | "night_wakeup"
    | "low_activity"
    | "caregiver_accepted"
    | "caregiver_checked"
    | "caregiver_completed"
    | "system_risk_update";
  timestamp: string;
  title: string;
  rawText?: string;
  source:
    | "demo"
    | "mock_wearable"
    | "wearable_import"
    | "hardware_simulator"
    | "voice_simulator"
    | "caregiver"
    | "system";
  severity?: RiskLevel;
  payload?: {
    symptomKeywords?: string[];
    medicationName?: string;
    locationZone?: string;
    safeZoneStatus?: "inside" | "outside" | "unknown";
    nightWakeupCount?: number;
    activityDropPercent?: number;
    noResponseSeconds?: number;
    confidence?: number;
    fallConfidence?: number;
    note?: string;
    previousValue?: number | string;
    currentValue?: number | string;
    deviceId?: string;
    batteryLevel?: number;
    sourceType?: CareTaskSource;
  };
  status?: "open" | "acknowledged" | "resolved" | "cancelled" | "dismissed";
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
  status: "pending" | "in_progress" | "completed" | "cancelled";
  sourceType?: CareTaskSource;
  agentSummarySource?: AgentSummarySource;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  note?: string;
  handledBy?: string;
  handledNote?: string;
}

export interface AgentRoleSummaries {
  outputId?: string;
  caregiverSummary: string;
  familySummary: string;
  institutionSummary: string;
  decisionTrace: string[];
  agentSource?: "mock" | "qwenpaw" | "openai";
  requestedProvider?: "mock" | "qwenpaw" | "openai";
  model?: string | null;
  durationMs?: number | null;
  validationStatus?: "valid" | "fallback_valid" | "failed";
  fallbackUsed?: boolean;
  warning?: string | null;
  generatedAt?: string;
}

export type CareTaskSource =
  | "rule_engine"
  | "hardware_event"
  | "voice_event"
  | "data_insufficient"
  | "location_event"
  | "agent";

export type AgentMode = "mock" | "qwenpaw" | "openai";

export type AgentRunStatus = "ready" | "failed" | "fallback_rule";

export type AgentSummarySource = "mock" | "qwenpaw" | "openai" | "fallback_rule";

export type MemorySourceType =
  | "family_oral"
  | "caregiver_input"
  | "medical_record_text"
  | "medication_list_text"
  | "institution_record"
  | "other";

export type MemoryConfirmationStatus =
  | "pending"
  | "confirmed"
  | "rejected"
  | "needs_more_info";

export interface CareMemoryItem {
  id: string;
  elderId: string;
  category:
    | "basic_profile"
    | "health_background"
    | "medication_notes"
    | "safety_risk"
    | "communication_preference"
    | "family_notification"
    | "observation_focus"
    | "missing_question";
  content: string;
  sourceType: MemorySourceType;
  sourceDetail: string;
  sourceDate: string;
  confidence: number;
  confirmationStatus: MemoryConfirmationStatus;
  confirmedBy?: string;
  confirmedAt?: string;
  visibilityScope: Array<"caregiver" | "family" | "institution" | "doctor">;
  updatedAt: string;
}

export interface InitialCareMemory {
  elderId: string;
  summary: string;
  riskTags: string[];
  communicationPreferences: string[];
  medicationNotes: string[];
  familyNotificationPreferences: string[];
  observationFocus: string[];
  missingQuestions: string[];
  items: CareMemoryItem[];
  createdAt: string;
  updatedAt: string;
}

export type WearableDataSource = string;

export interface WearableDailySnapshot {
  id: string;
  elderId: string;
  date: string;
  dataSource: WearableDataSource;
  heartRateAvg: number | null;
  restingHeartRate: number | null;
  steps: number | null;
  activeMinutes: number | null;
  sleepDuration: number | null;
  wearTimeHours: number | null;
  dataQuality: number;
  importedAt: string | null;
}

export interface WearableImportRecord {
  importId: string;
  elderId: string;
  source: WearableDataSource;
  importedAt: string;
  rowCount: number;
  snapshots: WearableDailySnapshot[];
}

export type DeviceConnectionStatus = "online" | "offline";

export type DeviceWearStatus = "worn" | "not_worn";

export interface DeviceRecord {
  deviceId: string;
  elderId: string;
  deviceType: "careband_mock" | "wearable_mock" | "future_hardware";
  connectionStatus: DeviceConnectionStatus;
  wearStatus: DeviceWearStatus;
  batteryLevel: number;
  lastSyncAt: string;
  firmwareVersion: string;
  dataQuality: number;
  dataSource: WearableDataSource;
  todayWearTimeHours: number;
}

export interface MockBackendLog {
  id: string;
  endpoint: string;
  method: "GET" | "POST" | "PATCH";
  status: "mocked" | "success" | "failed";
  message: string;
  createdAt: string;
  payloadPreview?: Record<string, unknown>;
}

export interface AgentTraceBundle {
  elderId: string;
  request: Record<string, unknown>;
  response: {
    caregiver_summary: string;
    family_summary: string;
    institution_summary: string;
    recommended_action: string;
    safety_disclaimer: string;
  };
  status: AgentRunStatus;
  generatedAt: string;
}

export interface ConsentPrivacyRecord {
  elderId: string;
  familyCanViewTrend: boolean;
  caregiverCanViewTasks: boolean;
  institutionCanViewRiskHeatmap: boolean;
  doctorCanViewVisitSummary: boolean;
  rawMedicalRecordRetention: "do_not_save" | "short_term_mock" | "future_consent_required";
  updatedAt: string;
}

export interface PilotPlanStatus {
  webDemo: "completed" | "in_progress" | "planned";
  contactPerson: "available" | "pending";
  interview: "to_schedule" | "scheduled" | "completed";
  prototype: "planned" | "in_progress" | "ready";
  realWearableData: "planned" | "internal_only" | "ready";
  elderTrial: "not_started" | "requires_consent" | "started";
}

export interface WeeklySummary {
  elderId: string;
  generatedAt: string;
  findings: string[];
  summary: string;
  wearStability: number;
}

export interface AgentOutput {
  outputId: string;
  elderId: string;
  sourceEventId?: string | null;
  statusLevel: RiskLevel;
  riskScore: number;
  caregiverSummary: string;
  familySummary: string;
  institutionSummary: string;
  recommendedAction: string;
  safetyDisclaimer: string;
  keyReasons: string[];
  agentSource: "mock" | "qwenpaw" | "openai";
  requestedProvider?: "mock" | "qwenpaw" | "openai";
  model?: string | null;
  durationMs?: number | null;
  validationStatus?: "valid" | "fallback_valid" | "failed";
  fallbackUsed?: boolean;
  warning?: string | null;
  createdAt: string;
}

export interface TrendPoint {
  date: string;
  steps: number | null;
  sleepHours: number | null;
  medicationOnTimeRate: number;
  riskLevel: RiskLevel;
}

export interface ElderTrend {
  elderId: string;
  points: TrendPoint[];
}
