import { describe, expect, it } from "vitest";
import { resolveDashboardAgentState } from "../lib/agentOutputState";
import type { BackendAgentOutput, BackendAgentRun } from "../lib/apiClient";
import {
  createInitialDemoState,
  demoReducer,
  getAgentSummariesForElder,
} from "../store/demoStore";

const previousOutput: BackendAgentOutput = {
  output_id: "OUT-OLD",
  elder_id: "E001",
  source_event_id: "EVT-OLD",
  status_level: "high_risk",
  risk_score: 86,
  caregiver_summary: "old caregiver summary",
  family_summary: "old family summary",
  institution_summary: "old institution summary",
  recommended_action: "old action",
  safety_disclaimer: "not medical advice",
  key_reasons: ["old reason"],
  agent_source: "qwenpaw",
  created_at: "2026-07-11T10:00:00.000Z",
};

describe("dashboard Agent output selection", () => {
  it("rejects a previous output when the latest Agent run failed", () => {
    const failedRun: BackendAgentRun = {
      run_id: "RUN-FAILED",
      elder_id: "E001",
      source_event_id: "EVT-NEW",
      provider: "qwenpaw",
      model: "qwen3.6-plus",
      duration_ms: 321,
      validation_status: "failed",
      fallback_used: false,
      error_reason: "Agent route failed",
      created_at: "2026-07-11T10:05:00.000Z",
    };

    const current = resolveDashboardAgentState(previousOutput, failedRun);

    expect(current.output).toBeNull();
    expect(current.run?.fallbackUsed).toBe(true);
    expect(current.run?.warning).toContain("Agent route failed");
  });

  it("rejects an output from a different source event even when the latest run is valid", () => {
    const current = resolveDashboardAgentState(previousOutput, {
      run_id: "RUN-NEW",
      elder_id: "E001",
      source_event_id: "EVT-NEW",
      provider: "qwenpaw",
      model: "qwen3.6-plus",
      duration_ms: 210,
      validation_status: "valid",
      fallback_used: false,
      created_at: "2026-07-11T10:05:00.000Z",
    });

    expect(current.output).toBeNull();
    expect(current.run?.hasCurrentOutput).toBe(false);
    expect(current.run?.warning).toContain("does not belong");
  });

  it("keeps a valid output that belongs to the latest run", () => {
    const current = resolveDashboardAgentState(previousOutput, {
      run_id: "RUN-CURRENT",
      elder_id: "E001",
      source_event_id: "EVT-OLD",
      provider: "qwenpaw",
      model: "qwen3.6-plus",
      duration_ms: 210,
      validation_status: "valid",
      fallback_used: false,
      created_at: "2026-07-11T10:00:01.000Z",
    });

    expect(current.output?.output_id).toBe("OUT-OLD");
    expect(current.run?.hasCurrentOutput).toBe(true);
    expect(current.run?.fallbackUsed).toBe(false);
  });

  it("replaces a stale current summary with an explicit local fallback after a request failure", () => {
    const initial = createInitialDemoState();
    initial.agentOutputs.E001 = {
      outputId: "OUT-OLD",
      elderId: "E001",
      sourceEventId: "EVT-OLD",
      statusLevel: "high_risk",
      riskScore: 86,
      caregiverSummary: "old caregiver summary",
      familySummary: "old family summary",
      institutionSummary: "old institution summary",
      recommendedAction: "old action",
      safetyDisclaimer: "not medical advice",
      keyReasons: ["old reason"],
      agentSource: "qwenpaw",
      createdAt: "2026-07-11T10:00:00.000Z",
    };

    const failed = demoReducer(initial, {
      type: "SET_AGENT_FAILURE",
      elderId: "E001",
      requestedProvider: "qwenpaw",
      warning: "Agent request failed",
    });
    const summaries = getAgentSummariesForElder(failed, "E001");

    expect(failed.agentOutputs.E001).toBeUndefined();
    expect(summaries.caregiverSummary).not.toContain("old caregiver summary");
    expect(summaries.agentSource).toBe("mock");
    expect(summaries.fallbackUsed).toBe(true);
    expect(summaries.warning).toContain("Agent request failed");
  });
});
