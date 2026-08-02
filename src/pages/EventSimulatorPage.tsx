import { useState } from "react";
import { MedicalDisclaimer } from "../components/MedicalDisclaimer";
import {
  SIMULATOR_SCENARIOS,
  agentExerciseStatus,
  buildSimulatorRequest,
  submitSimulatorEvent,
  type SimulatorApiResult,
  type SimulatorEventRequest,
  type SimulatorScenarioId,
} from "../lib/eventSimulator";

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

export const EventSimulatorPage = () => {
  const [scenarioId, setScenarioId] = useState<SimulatorScenarioId>("sos");
  const [elderId, setElderId] = useState("E001");
  const [request, setRequest] = useState<SimulatorEventRequest | null>(null);
  const [result, setResult] = useState<SimulatorApiResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [executedScenarioId, setExecutedScenarioId] = useState<SimulatorScenarioId | null>(null);
  const agentStatus = result?.status === "ok"
    ? result.data.agent_status
    : agentExerciseStatus(executedScenarioId ?? scenarioId);

  const submitRequest = async (nextRequest: SimulatorEventRequest, executedId: SimulatorScenarioId) => {
    setRequest(nextRequest);
    setExecutedScenarioId(executedId);
    setResult(null);
    setBusy(true);
    try {
      setResult(await submitSimulatorEvent(nextRequest));
    } finally {
      setBusy(false);
    }
  };

  const runScenario = () => submitRequest(
    buildSimulatorRequest(scenarioId, elderId, new Date().toISOString()),
    scenarioId,
  );

  return (
    <div className="page event-simulator-page">
      <header className="page-header">
        <div>
          <span>Stage 14 · 软件事件模拟</span>
          <h1>标准事件接口验证台</h1>
          <p>当前为软件事件模拟，与未来设备共用事件契约，不代表实体硬件已经完成。</p>
        </div>
      </header>

      <section className="panel simulator-boundary" aria-label="模拟边界">
        <strong>边界说明</strong>
        <p>所有请求固定使用 <code>source: software_simulator</code>。客户端不提交风险字段，风险结论只由后端规则引擎生成。</p>
        <p>静态 Pages 只显示说明并拒绝发送，不会伪装成真实后端或真实 Agent。</p>
      </section>

      <section className="panel simulator-controls">
        <label>
          长者 ID
          <input value={elderId} onChange={(event) => setElderId(event.target.value)} />
        </label>
        <div className="simulator-scenarios" role="group" aria-label="软件事件场景">
          {SIMULATOR_SCENARIOS.map((scenario) => (
            <button
              className={scenario.id === scenarioId ? "primary" : ""}
              key={scenario.id}
              onClick={() => setScenarioId(scenario.id)}
              type="button"
            >
              <strong>{scenario.label}</strong>
              <small>{scenario.description}</small>
            </button>
          ))}
        </div>
        <button className="primary" disabled={busy || !elderId.trim()} onClick={runScenario} type="button">
          {busy ? "正在请求本地后端…" : "发送软件模拟事件"}
        </button>
        <button
          disabled={busy || request === null || executedScenarioId === null}
          onClick={() => request && executedScenarioId && submitRequest(request, executedScenarioId)}
          type="button"
        >
          原样重放当前请求
        </button>
      </section>

      <section className="simulator-trace-grid" aria-label="事件链路结果">
        <article className="panel">
          <h2>请求 JSON</h2>
          <pre data-testid="simulator-request">{request ? pretty(request) : "尚未发送"}</pre>
        </article>
        <article className="panel">
          <h2>HTTP 状态</h2>
          <strong data-testid="simulator-http-status">
            {result?.status === "ok" ? result.data.http_status : result?.http_status ?? "尚未请求"}
          </strong>
          {result?.status === "error" ? <p role="alert">{result.error.message}（{result.error.code}）</p> : null}
        </article>
        <article className="panel">
          <h2>规范事件</h2>
          <pre>{result?.status === "ok" ? pretty(result.data.event) : "等待后端规范化结果"}</pre>
        </article>
        <article className="panel">
          <h2>服务器权威风险结果</h2>
          <pre>{result?.status === "ok" ? pretty(result.data.risk_result) : "等待后端规则结果"}</pre>
        </article>
        <article className="panel">
          <h2>护工任务结果</h2>
          <pre>{result?.status === "ok" ? pretty(result.data.task) : "等待后端任务结果"}</pre>
        </article>
        <article className="panel">
          <h2>Agent 状态</h2>
          <pre data-testid="simulator-agent-status">{pretty(agentStatus)}</pre>
        </article>
      </section>
      <MedicalDisclaimer />
    </div>
  );
};
