import { FamilyPeaceCard } from "../components/FamilyPeaceCard";
import { FamilyVoiceMemoryCard } from "../components/FamilyVoiceMemoryCard";
import { MedicalDisclaimer } from "../components/MedicalDisclaimer";
import { deriveCareLoopStatus, deriveDisplayStatus } from "../lib/displayStatus";
import { buildFamilyStatusMessage } from "../lib/familyCopy";
import { getConsentStatusForElder } from "../lib/profileSelectors";
import {
  getActiveTaskForElder,
  getAgentSummariesForElder,
  getEventsForElder,
  getFamilyVoiceMemorySummaries,
  getRiskForElder,
  useDemo,
} from "../store/demoStore";

interface FamilyPageProps {
  elderId: string;
}

export const FamilyPage = ({ elderId }: FamilyPageProps) => {
  const { state } = useDemo();
  const profile = state.profiles[elderId];

  // Requirement 5: an unknown elder must never silently fall back to E001.
  if (!profile) {
    return (
      <div className="page family-page">
        <section className="panel empty-state">
          <strong>未找到该长者</strong>
          <p>家属端只展示已存在的虚构长者，系统不会自动回退到其他档案。</p>
          <a className="primary-link" href="#/institution">返回机构总览</a>
        </section>
      </div>
    );
  }

  const consent = getConsentStatusForElder(elderId, state);
  const snapshot = state.snapshots[elderId];
  const risk = getRiskForElder(state, elderId);
  const task = getActiveTaskForElder(state, elderId);
  const events = getEventsForElder(state, elderId);
  const careLoopStatus = deriveCareLoopStatus(elderId, state.tasks, events);
  const displayStatus = deriveDisplayStatus(risk, careLoopStatus);
  const exceptionText = buildFamilyStatusMessage(
    profile,
    risk,
    displayStatus,
    snapshot,
    task,
    careLoopStatus,
    consent?.familyCanViewMedicationStatus ?? false,
  );
  // Stage 13 — only fixed, pre-gated summary strings reach the family surface.
  const familyVoiceSummaries = getFamilyVoiceMemorySummaries(state, elderId);
  const canViewDaily = consent?.familyCanViewDailyStatus ?? false;
  const agentSummaries = getAgentSummariesForElder(state, elderId);

  return (
    <div className="page family-page">
      <header className="page-header">
        <div>
          <span>家属端</span>
          <h1>{profile.name}今日安心卡</h1>
          <p>给家属看得懂、不过度制造焦虑的照护状态摘要。</p>
        </div>
      </header>
      {canViewDaily ? (
        <FamilyPeaceCard
          profile={profile}
          snapshot={snapshot}
          risk={risk}
          displayStatus={displayStatus}
          careLoopStatus={careLoopStatus}
          task={task}
          exceptionText={exceptionText}
          consent={consent}
        />
      ) : (
        <section className="panel family-failclosed-notice">
          <strong>家属今日安心卡暂未授权可见</strong>
          <p>该长者尚未授权家属查看今日安心卡，系统不会未经授权展示照护状态。</p>
        </section>
      )}
      {canViewDaily ? (
        <section className="panel gentle-summary" aria-label="家属 Agent 摘要">
          <div className="section-title">
            <span>{agentSummaries.agentSource === "qwenpaw" ? "QwenPaw / GLM-5.2 摘要" : "Mock AI 摘要"}</span>
            <h2>今日照护说明</h2>
          </div>
          <p>{agentSummaries.familySummary}</p>
          {agentSummaries.warning ? <p role="status">{agentSummaries.warning}</p> : null}
        </section>
      ) : null}
      <FamilyVoiceMemoryCard summaries={familyVoiceSummaries} />
      <section className="panel gentle-summary">
        <div className="section-title">
          <span>温和说明</span>
          <h2>家属可见摘要</h2>
        </div>
        <p>
          系统会把复杂的步数、睡眠、用药和事件判断转成照护状态，不展示复杂医学指标。
          如有持续不适或紧急情况，将由照护人员或专业医疗人员判断处理。
        </p>
        {consent?.familyCanViewMedicationStatus ? (
          <div className="button-row page-link-row">
            <a className="text-button" href={`#/medication/${elderId}`}>
              查看今日用药状态
            </a>
          </div>
        ) : null}
        <div className="button-row page-link-row">
          <a className="text-button" href={`#/family/${elderId}/privacy`}>
            查看隐私与授权说明
          </a>
        </div>
      </section>
      <MedicalDisclaimer />
    </div>
  );
};
