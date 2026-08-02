import { MedicalDisclaimer } from "../components/MedicalDisclaimer";
import { PILOT_STEPS } from "../data/backendContract";

export const PilotPlanPage = () => (
  <div className="page pilot-plan-page">
    <header className="page-header">
      <div>
        <span>Stage 15 · 未来验证路线</span>
        <h1>封闭试点计划</h1>
        <p>以下全部是计划，不是已经完成的访谈、试点、部署或真实长者试戴。</p>
      </div>
    </header>

    <section className="panel pilot-plan-notice">
      <strong>当前状态：计划中 / 全部未开始</strong>
      <p>本 Demo 仅使用虚构长者资料与团队测试主体。未经授权和安全审查，不接触真实长者健康资料。</p>
    </section>

    <ol className="pilot-steps">
      {PILOT_STEPS.map((step) => (
        <li className="panel" key={step.order}>
          <span className="pilot-step-number">{step.order}</span>
          <div>
            <small>计划中 · {step.status}</small>
            <h2>{step.title}</h2>
            <p>{step.evidenceNeeded}</p>
          </div>
        </li>
      ))}
    </ol>
    <MedicalDisclaimer />
  </div>
);
