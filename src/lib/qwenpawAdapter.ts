import type {
  AgentRoleSummaries,
  CareEvent,
  DailySnapshot,
  ElderProfile,
  PersonalBaseline,
  RiskResult,
} from "../types";

export interface AgentRequest {
  elderId: string;
  scenario: "caregiver" | "family" | "institution";
  riskResult: RiskResult;
  context: Record<string, unknown>;
}

export interface AgentResponse {
  summary: string;
  decisionTrace: string[];
  modelName: string;
  generatedAt: string;
}

export interface QwenPawAgentAdapter {
  generateSummary(request: AgentRequest): Promise<AgentResponse>;
}

export const buildQwenPawRequest = (
  elderId: string,
  scenario: AgentRequest["scenario"],
  riskResult: RiskResult,
  context: Record<string, unknown>,
): AgentRequest => ({ elderId, scenario, riskResult, context });

export const mapMockSummariesToAgentResponse = (
  summary: keyof AgentRoleSummaries,
  summaries: AgentRoleSummaries,
): AgentResponse => ({
  summary: String(summaries[summary]),
  decisionTrace: summaries.decisionTrace,
  modelName: "deterministic-mock-v0.2",
  generatedAt: new Date().toISOString(),
});

export interface MockQwenPawIO {
  request: Record<string, unknown>;
  response: Record<string, unknown>;
}

// This is the frontend-only trace used when the backend is unavailable. Real QwenPaw
// execution lives behind POST /api/agent/analyze, which rebuilds and validates context.
export const buildMockQwenPawIO = (
  profile: ElderProfile,
  baseline: PersonalBaseline,
  snapshot: DailySnapshot,
  events: CareEvent[],
  riskResult: RiskResult,
  summaries: AgentRoleSummaries,
): MockQwenPawIO => ({
  request: {
    elder: {
      elder_id: profile.elderId,
      display_name: profile.name,
      age: profile.age,
    },
    baseline: {
      avg_steps_7d: baseline.avgSteps7d,
      avg_sleep_7d: baseline.avgSleep7d,
      resting_hr_baseline: baseline.restingHrBaseline,
    },
    snapshot: {
      steps: snapshot.stepsToday,
      sleep_duration: snapshot.sleepDuration,
      data_quality: snapshot.dataQuality,
      wear_time_hours: snapshot.wearTimeHours,
    },
    events: events
      .filter((event) =>
        ["voice_symptom", "sos", "sos_long_press", "fall_detected", "location_alert"].includes(
          event.eventType,
        ),
      )
      .map((event) => ({
        event_type: event.eventType,
        raw_text: event.rawText,
        payload: event.payload,
      })),
    risk_result: {
      status_level: riskResult.riskLevel,
      risk_score: riskResult.riskScore,
      key_reasons: riskResult.keyReasons,
    },
  },
  response: {
    caregiver_summary: summaries.caregiverSummary,
    family_summary: summaries.familySummary,
    institution_summary: summaries.institutionSummary,
    recommended_action: riskResult.recommendedAction,
    safety_disclaimer: riskResult.medicalDisclaimer,
  },
});
