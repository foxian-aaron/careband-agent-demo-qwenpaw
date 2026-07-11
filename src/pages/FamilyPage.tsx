import { FamilyPeaceCard } from "../components/FamilyPeaceCard";
import { AgentSourceBadge } from "../components/AgentSourceBadge";
import { MedicalDisclaimer } from "../components/MedicalDisclaimer";
import { MockNoticeBanner } from "../components/MockNoticeBanner";
import { UnknownElderState } from "../components/UnknownElderState";
import { deriveCareLoopStatus, deriveDisplayStatus } from "../lib/displayStatus";
import { getElderViewModel } from "../lib/elderView";
import { buildFamilyStatusMessage } from "../lib/familyCopy";
import {
  getActiveTaskForElder,
  getAgentSummariesForElder,
  getEventsForElder,
  getRiskForElder,
  useDemo,
} from "../store/demoStore";

interface FamilyPageProps {
  elderId: string;
}

export const FamilyPage = ({ elderId }: FamilyPageProps) => {
  const { state } = useDemo();
  const viewModel = getElderViewModel(state, elderId);
  if (!viewModel.found) return <UnknownElderState elderId={elderId} />;
  const { profile } = viewModel;
  const snapshot = state.snapshots[profile.elderId];
  const risk = getRiskForElder(state, profile.elderId);
  const task = getActiveTaskForElder(state, profile.elderId);
  const events = getEventsForElder(state, profile.elderId);
  const careLoopStatus = deriveCareLoopStatus(profile.elderId, state.tasks, events);
  const displayStatus = deriveDisplayStatus(risk, careLoopStatus);
  const agentSummaries = getAgentSummariesForElder(state, profile.elderId);
  const exceptionText = buildFamilyStatusMessage(
    profile,
    risk,
    displayStatus,
    snapshot,
    events,
    task,
    careLoopStatus,
  );

  return (
    <div className="page family-page">
      <header className="page-header">
        <div>
          <span>家属端</span>
          <h1>{profile.name}今日安心卡</h1>
          <p>给家属看得懂、不过度制造焦虑的照护状态摘要。</p>
        </div>
      </header>
      <MockNoticeBanner>家属端当前展示为模拟数据和温和摘要，不展示过多专业指标或精确位置轨迹。</MockNoticeBanner>
      <FamilyPeaceCard
        profile={profile}
        snapshot={snapshot}
        risk={risk}
        displayStatus={displayStatus}
        careLoopStatus={careLoopStatus}
        task={task}
        exceptionText={exceptionText}
      />
      <section className="panel gentle-summary">
        <div className="section-title">
          <span>温和说明</span>
          <h2>家属可见摘要</h2>
        </div>
        <p>{agentSummaries.familySummary}</p>
        <AgentSourceBadge summaries={agentSummaries} />
        <p className="muted-copy">
          系统只展示照护摘要，不展示精确位置；如有持续不适或紧急情况，由照护人员按机构流程处理。
        </p>
        <div className="button-row page-link-row">
          <a className="text-button" href={`#/medication/${profile.elderId}`}>
            查看今日用药状态
          </a>
        </div>
      </section>
      <MedicalDisclaimer />
    </div>
  );
};
