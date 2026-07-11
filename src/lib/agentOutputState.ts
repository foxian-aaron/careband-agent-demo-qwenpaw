import type {
  BackendAgentOutput,
  BackendAgentRun,
} from "./apiClient";

export interface AgentRunViewState {
  sourceEventId?: string | null;
  requestedProvider: BackendAgentRun["provider"];
  model?: string | null;
  durationMs?: number | null;
  validationStatus: BackendAgentRun["validation_status"];
  fallbackUsed: boolean;
  warning?: string | null;
  createdAt: string;
  hasCurrentOutput: boolean;
}

const sameSourceEvent = (
  output: BackendAgentOutput,
  run: BackendAgentRun,
) => (output.source_event_id ?? null) === (run.source_event_id ?? null);

export const resolveDashboardAgentState = (
  output: BackendAgentOutput | null,
  run: BackendAgentRun | null | undefined,
): { output: BackendAgentOutput | null; run: AgentRunViewState | null } => {
  if (!run) return { output, run: null };

  const failed = run.validation_status === "failed";
  const hasCurrentOutput = Boolean(output && !failed && sameSourceEvent(output, run));
  const staleWarning =
    output && !sameSourceEvent(output, run)
      ? "Latest Agent output does not belong to the latest run."
      : null;

  return {
    output: hasCurrentOutput ? output : null,
    run: {
      sourceEventId: run.source_event_id,
      requestedProvider: run.provider,
      model: run.model,
      durationMs: run.duration_ms,
      validationStatus: run.validation_status,
      fallbackUsed: run.fallback_used || !hasCurrentOutput,
      warning: run.error_reason ?? staleWarning,
      createdAt: run.created_at,
      hasCurrentOutput,
    },
  };
};
