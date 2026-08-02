import type {
  AgentRoleSummaries,
  CareEvent,
  DailySnapshot,
  ElderProfile,
  PersonalBaseline,
  RiskResult,
} from "../types";
import { buildMockQwenPawIO } from "../lib/qwenpawAdapter";

interface AgentIOPanelProps {
  profile: ElderProfile;
  baseline: PersonalBaseline;
  snapshot: DailySnapshot;
  events: CareEvent[];
  risk: RiskResult;
  summaries: AgentRoleSummaries;
}

export const AgentIOPanel = ({
  profile,
  baseline,
  snapshot,
  events,
  risk,
  summaries,
}: AgentIOPanelProps) => {
  const isRealQwenPaw = summaries.agentSource === "qwenpaw";
  const io = isRealQwenPaw
    ? null
    : buildMockQwenPawIO(profile, baseline, snapshot, events, risk, summaries);
  const safeRuntimeContract = {
    note: "安全重建预览，非原始 Prompt；原始 Prompt/Response 不持久化、不回传前端。",
    input_fields: ["daily_snapshot", "personal_baseline", "active_events", "risk_result"],
    locked_risk_fields: ["status_level", "risk_score", "key_reasons", "recommended_action"],
    output_fields: ["caregiver_summary", "family_summary", "institution_summary", "safety_disclaimer"],
    provider: summaries.agentSource,
    model: summaries.model,
    validation_status: summaries.validationStatus,
    fallback_used: summaries.fallbackUsed,
  };

  return (
    <section className="panel agent-io-panel">
      <div className="section-title">
        <span>{isRealQwenPaw ? "QwenPaw / GLM-5.2 Agent IO" : "Mock Agent IO"}</span>
        <h2>结构化输入 / 多角色输出</h2>
      </div>
      <p className="muted-copy">
        {isRealQwenPaw
          ? "当前展示已由服务端校验并持久化的 QwenPaw / GLM-5.2 多角色摘要。"
          : "当前展示明确标记的确定性 Mock 输出，不代表真实模型调用。"}
      </p>
      <div className="agent-io-grid">
        {isRealQwenPaw ? (
          <div>
            <h3>安全合同摘要（非原始 Prompt）</h3>
            <pre>{JSON.stringify(safeRuntimeContract, null, 2)}</pre>
          </div>
        ) : (
          <>
            <div>
              <h3>Mock Agent Request</h3>
              <pre>{JSON.stringify(io?.request, null, 2)}</pre>
            </div>
            <div>
              <h3>Mock Agent Response</h3>
              <pre>{JSON.stringify(io?.response, null, 2)}</pre>
            </div>
          </>
        )}
      </div>
    </section>
  );
};
