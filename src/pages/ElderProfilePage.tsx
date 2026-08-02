import { BaselineSummaryCard } from "../components/profile/BaselineSummaryCard";
import { CareTeamCard } from "../components/profile/CareTeamCard";
import { ConsentStatusCard } from "../components/profile/ConsentStatusCard";
import { ProfileIdentityCard } from "../components/profile/ProfileIdentityCard";
import { RiskSummaryCard } from "../components/profile/RiskSummaryCard";
import { MedicalDisclaimer } from "../components/MedicalDisclaimer";
import { deriveCareLoopStatus, deriveDisplayStatus } from "../lib/displayStatus";
import { getCareTeamForElder, getProfileDetail } from "../lib/profileSelectors";
import {
  getEventsForElder,
  getRiskForElder,
  useDemo,
} from "../store/demoStore";

interface ElderProfilePageProps {
  elderId: string;
}

export const ElderProfilePage = ({ elderId }: ElderProfilePageProps) => {
  const { state } = useDemo();
  const profile = state.profiles[elderId];

  if (!profile) {
    return (
      <div className="page">
        <section className="panel empty-state">
          <strong>未找到该长者</strong>
          <p>长者 ID“{elderId}”不存在，系统不会自动回退到其他档案。</p>
          <a className="primary-link" href="#/institution">返回机构总览</a>
        </section>
      </div>
    );
  }
  const detail = getProfileDetail(profile.elderId, state);
  const baseline = state.baselines[profile.elderId];
  const snapshot = state.snapshots[profile.elderId];
  const events = getEventsForElder(state, profile.elderId);
  const risk = getRiskForElder(state, profile.elderId);
  const careLoopStatus = deriveCareLoopStatus(profile.elderId, state.tasks, events);
  const displayStatus = deriveDisplayStatus(risk, careLoopStatus);
  const careTeam = getCareTeamForElder(profile.elderId, state);

  return (
    <div className="page">
      <ProfileIdentityCard
        profile={profile}
        detail={detail}
        snapshot={snapshot}
        risk={risk}
        displayStatus={displayStatus}
      />

      <section className="two-column">
        <article className="panel">
          <div className="section-title">
            <span>基础资料</span>
            <h2>照护档案</h2>
          </div>
          <div className="info-grid compact">
            <div><span>姓名</span><strong>{profile.name}</strong></div>
            <div><span>年龄</span><strong>{profile.age} 岁</strong></div>
            <div><span>房间</span><strong>{profile.room}</strong></div>
            <div><span>楼层</span><strong>{profile.floor}</strong></div>
            <div><span>机构</span><strong>{detail?.institutionName ?? "澳门长者中心 Demo"}</strong></div>
            <div><span>照护组</span><strong>{detail?.careGroup ?? "未分组"}</strong></div>
            <div><span>照护类型</span><strong>{detail?.admissionType ?? "模拟照护"}</strong></div>
            <div><span>语言偏好</span><strong>{detail?.languagePreference ?? "普通话"}</strong></div>
          </div>
        </article>

        <article className="panel">
          <div className="section-title">
            <span>健康与照护标签</span>
            <h2>模拟档案标签</h2>
          </div>
          <div className="tag-row">
            {profile.chronicConditions.map((tag) => (
              <span className="tag-chip" key={tag}>慢病标签：{tag}</span>
            ))}
            {profile.riskTags.map((tag) => (
              <span className="tag-chip tag-chip--warm" key={tag}>{tag}</span>
            ))}
          </div>
          <p className="muted-copy">
            这些是照护标签，用于辅助风险提示和任务优先级，不是医疗诊断结论。
          </p>
        </article>
      </section>

      <section className="two-column">
        <BaselineSummaryCard baseline={baseline} />
        <CareTeamCard {...careTeam} />
      </section>

      <ConsentStatusCard consent={detail?.consentStatus} elderId={elderId} />

      <RiskSummaryCard
        risk={risk}
        displayStatus={displayStatus}
        careLoopStatus={careLoopStatus}
      />

      <section className="panel">
        <div className="section-title">
          <span>页面操作</span>
          <h2>继续查看</h2>
        </div>
        <div className="button-row">
          <a className="primary-link" href={`#/elder/${profile.elderId}`}>返回状态驾驶舱</a>
          <a className="text-button" href={`#/elder/${profile.elderId}/memory-intake`}>初始化照护记忆</a>
          <a className="text-button" href={`#/elder/${profile.elderId}/voice`}>语音陪伴文字模拟</a>
          <a className="text-button" href={`#/caregiver/elder/${profile.elderId}/privacy`}>护工隐私授权演示</a>
          <a className="text-button" href={`#/medication/${profile.elderId}`}>查看用药计划</a>
          <a className="text-button" href={`#/family/${profile.elderId}`}>查看家属安心卡</a>
          <a className="text-button" href="#/institution">查看机构端</a>
        </div>
      </section>

      <MedicalDisclaimer />
      <section className="medical-disclaimer">
        本系统仅用于照护风险提示，不构成医疗诊断。用药信息以机构记录和专业人员确认结果为准。
      </section>
    </div>
  );
};
