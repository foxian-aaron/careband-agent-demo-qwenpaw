import { buildAgentTrace } from "../lib/agentTrace";
import {
  getAgentSummariesForElder,
  getAgentTraceForElder,
  getEventsForElder,
  getRiskForElder,
  useDemo,
} from "../store/demoStore";
import { FutureIntegrationBadge } from "./FutureIntegrationBadge";
import { MockNoticeBanner } from "./MockNoticeBanner";
import { AgentSourceBadge } from "./AgentSourceBadge";

interface AgentTracePanelProps {
  elderId: string;
}

export const AgentTracePanel = ({ elderId }: AgentTracePanelProps) => {
  const { state, dispatch } = useDemo();
  const profile = state.profiles[elderId];
  const events = getEventsForElder(state, elderId);
  const risk = getRiskForElder(state, elderId);
  const summaries = getAgentSummariesForElder(state, elderId);
  const trace = getAgentTraceForElder(state, elderId);
  const buildTrace = (status: "ready" | "fallback_rule") =>
    buildAgentTrace({
      profile,
      baseline: state.baselines[elderId],
      snapshot: state.snapshots[elderId],
      events,
      risk,
      summaries,
      initialCareMemory: state.initialCareMemoryByElderId[elderId],
      deviceRecord: state.deviceRecords[elderId],
      status,
    });

  return (
    <section className="panel agent-trace-panel">
      <div className="section-title with-actions">
        <div>
          <span>AI Agent 调用面板</span>
          <h2>Agent Request / Response Trace</h2>
        </div>
        <div className="button-row">
          <button onClick={() => dispatch({ type: "GENERATE_AGENT_SUMMARY", trace: buildTrace("ready") })}>
            重新生成 Agent 摘要
          </button>
          <button onClick={() => dispatch({ type: "SIMULATE_AGENT_FAILURE", elderId })}>
            模拟 Agent 失败
          </button>
          <button
            className="primary"
            onClick={() =>
              dispatch({ type: "FALLBACK_TO_RULE_SUMMARY", trace: buildTrace("fallback_rule") })
            }
          >
            模拟 Agent fallback
          </button>
        </div>
      </div>
      <MockNoticeBanner>规则引擎固定风险等级，Agent 只生成三端摘要；真实 Provider 失败时会明确显示 Mock fallback。</MockNoticeBanner>
      <AgentSourceBadge summaries={summaries} />
      <div className="tag-row">
        <FutureIntegrationBadge label={trace.status === "failed" ? "Agent Failed" : "Agent Ready"} />
        <FutureIntegrationBadge label={`Provider: ${summaries.requestedProvider ?? summaries.agentSource ?? "mock"}`} />
        <FutureIntegrationBadge label={`JSON: ${summaries.validationStatus ?? "local_mock"}`} />
        <FutureIntegrationBadge label="Fallback Ready" />
      </div>
      {trace.status === "failed" ? (
        <p className="trace-disclaimer">Agent 暂不可用，已 fallback 到规则摘要。</p>
      ) : null}
      <div className="agent-output-cards">
        <article>
          <span>护工摘要</span>
          <p>{trace.response.caregiver_summary}</p>
        </article>
        <article>
          <span>家属摘要</span>
          <p>{trace.response.family_summary}</p>
        </article>
        <article>
          <span>机构摘要</span>
          <p>{trace.response.institution_summary}</p>
        </article>
      </div>
      <p className="trace-disclaimer">{trace.response.safety_disclaimer}</p>
      <div className="agent-io-grid">
        <details open>
          <summary>Agent Request</summary>
          <pre>{JSON.stringify(trace.request, null, 2)}</pre>
        </details>
        <details open>
          <summary>Agent Response</summary>
          <pre>{JSON.stringify(trace.response, null, 2)}</pre>
        </details>
      </div>
    </section>
  );
};
