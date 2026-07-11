import type { AgentRoleSummaries } from "../types";
import { StatusPill } from "./StatusPill";

export const AgentSourceBadge = ({ summaries }: { summaries: AgentRoleSummaries }) => {
  const sourceLabel =
    summaries.agentSource === "qwenpaw"
      ? "真实 QwenPaw"
      : summaries.agentSource === "openai"
        ? "真实 OpenAI"
        : summaries.fallbackUsed
          ? "Mock fallback"
          : "确定性 Mock";

  return (
    <div
      className="tag-row"
      aria-label="Agent output metadata"
      data-agent-output-id={summaries.outputId ?? "local-fallback"}
      data-agent-source={summaries.agentSource ?? "mock"}
      data-agent-validation={summaries.validationStatus ?? "local_mock"}
    >
      <StatusPill label={sourceLabel} tone={summaries.fallbackUsed ? "attention" : "stable"} />
      <StatusPill
        label={`JSON：${summaries.validationStatus ?? "local_mock"}`}
        tone={summaries.validationStatus === "failed" ? "urgent" : "observation"}
      />
      <span className="muted-copy">
        {summaries.model ?? "deterministic-mock-v0.2"} · {summaries.durationMs ?? 0} ms
      </span>
    </div>
  );
};
