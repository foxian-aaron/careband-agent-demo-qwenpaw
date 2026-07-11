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
  const io = buildMockQwenPawIO(profile, baseline, snapshot, events, risk, summaries);
  const sourceLabel =
    summaries.agentSource === "qwenpaw"
      ? "真实 QwenPaw"
      : summaries.agentSource === "openai"
        ? "真实 OpenAI"
        : summaries.fallbackUsed
          ? "Mock fallback"
          : "确定性 Mock";

  return (
    <section className="panel agent-io-panel">
      <div className="section-title">
        <span>{sourceLabel} Agent IO</span>
        <h2>结构化输入 / 多角色输出</h2>
      </div>
      <p className="muted-copy">
        当前 Agent 来源：{sourceLabel}。
        请求 Provider：{summaries.requestedProvider ?? summaries.agentSource ?? "mock"}；
        模型：{summaries.model ?? "deterministic-mock-v0.2"}；
        耗时：{summaries.durationMs ?? 0} ms；
        校验：{summaries.validationStatus ?? "local_mock"}。
        API key 只在后端读取，前端不会暴露密钥。
      </p>
      {summaries.warning ? <p className="muted-copy">Agent 警告：{summaries.warning}</p> : null}
      <div className="agent-io-grid">
        <div>
          <h3>Agent 聚合输入（展示版）</h3>
          <pre>{JSON.stringify(io.request, null, 2)}</pre>
        </div>
        <div>
          <h3>同一份三端摘要输出</h3>
          <pre>{JSON.stringify(io.response, null, 2)}</pre>
        </div>
      </div>
    </section>
  );
};
