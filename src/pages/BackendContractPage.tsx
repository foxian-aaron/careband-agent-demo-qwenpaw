import { MedicalDisclaimer } from "../components/MedicalDisclaimer";
import { API_CONTRACTS, DOMAIN_CONTRACTS } from "../data/backendContract";
import { useDemo } from "../store/demoStore";

const statusLabel = (status: "connecting" | "connected" | "mock") => ({
  connecting: "正在检查本地后端",
  connected: "本地后端已连接",
  mock: "Mock / 静态预览",
}[status]);

export const BackendContractPage = () => {
  const { state } = useDemo();
  const backend = state.backend;
  const connected = backend.status === "connected" && backend.mode === "backend";

  return (
    <div className="page backend-contract-page">
      <header className="page-header">
        <div>
          <span>Stage 15 · 只读接口说明</span>
          <h1>后端与 Agent 契约</h1>
          <p>本页只解释已经约定的数据边界，不发请求、不修改状态。</p>
        </div>
      </header>

      <section className={`panel contract-runtime ${connected ? "contract-runtime--connected" : "contract-runtime--mock"}`}>
        <div className="section-title">
          <span>当前运行模式</span>
          <h2>{statusLabel(backend.status)}</h2>
        </div>
        <dl className="contract-runtime-grid">
          <div><dt>status</dt><dd>{backend.status}</dd></div>
          <div><dt>mode</dt><dd>{backend.mode}</dd></div>
          <div><dt>lastSyncedAt</dt><dd>{backend.lastSyncedAt ?? "尚未连接"}</dd></div>
        </dl>
        {!connected ? (
          <p><strong>诚实边界：</strong>Mock 或静态 Pages 不代表 Express、SQLite、QwenPaw 或 GLM-5.2 已连接。</p>
        ) : (
          <p>当前页面读取的是 Store 已记录的本地后端连接状态；本页自身仍不执行 API 调用。</p>
        )}
      </section>

      <section className="contract-grid" aria-label="领域契约">
        {DOMAIN_CONTRACTS.map((contract) => (
          <article className="panel contract-card" key={contract.name}>
            <span>权威归属</span>
            <h2>{contract.name}</h2>
            <p>{contract.authority}</p>
            <dl>
              {contract.fields.map((field) => (
                <div key={field.name}><dt>{field.name}</dt><dd>{field.description}</dd></div>
              ))}
            </dl>
          </article>
        ))}
      </section>

      <section className="panel">
        <div className="section-title"><span>已实现接口</span><h2>API 清单</h2></div>
        <ul className="api-contract-list">
          {API_CONTRACTS.map((api) => <li key={api}><code>{api}</code></li>)}
        </ul>
        <p><strong>风险权威：</strong><code>status_level</code>、<code>risk_score</code>、<code>key_reasons</code>、<code>recommended_action</code> 只能由后端规则引擎决定；Agent 只能摘要和解释。</p>
      </section>
      <MedicalDisclaimer />
    </div>
  );
};
