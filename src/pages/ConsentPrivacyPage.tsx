import { MedicalDisclaimer } from "../components/MedicalDisclaimer";
import { getProfileDetail } from "../lib/profileSelectors";
import { getVoiceMemoryReviewStatus } from "../lib/consentPrivacy";
import {
  grantFamilyConsentByCaregiver,
  reviewVoiceDraftByCaregiver,
  revokeFamilyConsentByCaregiver,
  useDemo,
} from "../store/demoStore";

interface ConsentPrivacyPageProps {
  elderId: string;
  viewerRole: "caregiver" | "family" | "elder";
}

export const canManagePrivacy = (viewerRole: ConsentPrivacyPageProps["viewerRole"]) =>
  viewerRole === "caregiver";

const memoryTypeLabels = {
  past_story: "往事回忆",
  life_preference: "生活偏好",
  daily_rhythm: "日常节律",
} as const;

const visibilityLabels = {
  family_summary: "家属摘要（需授权+人工确认）",
  caregiver_only: "仅护工可见",
} as const;

const reviewStatusLabels = {
  pending: "待护工确认",
  confirmed: "已确认",
  rejected: "已拒绝",
} as const;

export const ConsentPrivacyPage = ({ elderId, viewerRole }: ConsentPrivacyPageProps) => {
  const { state, dispatch } = useDemo();
  const profile = state.profiles[elderId];
  const detail = getProfileDetail(elderId, state);
  const consent = detail?.consentStatus;
  const drafts = state.voiceMemoryDraftsByElderId[elderId] ?? [];
  const reviews = state.voiceReviewByElderId[elderId] ?? {};
  const authorized = state.familyConsentByElderId[elderId] === true;
  const mockMode = state.backend.mode === "mock";
  const canManage = canManagePrivacy(viewerRole);

  if (!profile) {
    return (
      <div className="page">
        <section className="panel empty-state">
          <strong>未找到长者</strong>
          <p>长者 ID “{elderId}” 不存在，系统不会自动回退到其他档案。</p>
          <a className="primary-link" href="#/institution">返回机构总览</a>
        </section>
      </div>
    );
  }

  const review = (draftId: string, decision: "confirmed" | "rejected") => {
    if (!mockMode || !canManage) return;
    dispatch(reviewVoiceDraftByCaregiver(elderId, draftId, decision));
  };

  const grant = () => {
    if (!mockMode || !canManage) return;
    dispatch(grantFamilyConsentByCaregiver(elderId));
  };

  const revoke = () => {
    if (!mockMode || !canManage) return;
    dispatch(revokeFamilyConsentByCaregiver(elderId));
  };

  return (
    <div className="page consent-privacy-page">
      <header className="page-header">
        <div>
          <span>{canManage ? "Stage 13｜护工隐私授权演示" : "Stage 13｜只读隐私说明"}</span>
          <h1>{profile.name}的隐私与家属授权</h1>
          <p>{canManage ? "护工确认语音记忆草稿，并模拟家属授权门槛（仅当前会话有效）。" : "长者与家属只能查看数据使用边界，不能自行授权或审核。"}</p>
        </div>
        <a className="primary-link" href={viewerRole === "family" ? `#/family/${elderId}` : `#/elder/${elderId}/profile`}>
          {viewerRole === "family" ? "返回家属安心卡" : "返回长者档案"}
        </a>
      </header>

      <section className="panel consent-privacy-notice">
        <div className="section-title">
          <span>角色与数据边界</span>
          <h2>本 Demo 的隐私说明</h2>
        </div>
        <ul className="privacy-bullet-list">
          <li><strong>角色可见范围：</strong>今日安心卡按授权字段向家属最小必要展示；护工与机构可见结构化照护信号；家属不会看到护工内部工作细节。</li>
          <li><strong>语音原文不保存：</strong>长者原话仅保留在语音陪伴页面会话，Store、localStorage 与照护记录只存限长结构化摘要（summary_only）。</li>
          <li><strong>Apple Health XML 不送模型：</strong>可穿戴导入只接受团队测试主体 TEST001 的合成日聚合 CSV，原始 XML 不上传、不送入模型。</li>
          <li><strong>位置仅区域：</strong>家属端位置精度为 zone_only，只显示区域（如楼层 / 活动区），不展示精确坐标。</li>
          <li><strong>撤回 / 拒绝流程：</strong>护工可撤回授权或拒绝草稿；撤回后家属端摘要立即隐藏。拒绝不等于删除，正式删除需走后端流程。RESET 或重新连接会清空会话级授权与确认。</li>
          <li><strong>数据不足不强行判断：</strong>当今日数据完整度不足时，系统提示需确认佩戴或同步，不会替长者编造风险结论。</li>
        </ul>
        {!mockMode ? (
          <p className="import-feedback import-feedback--error">
            Connected 模式不开放本地授权 / 审核写入，也不会假装已授权或已确认。
          </p>
        ) : (
          <p className="muted-copy">Mock 授权与人工审核仅当前会话有效，刷新或重新加载后清空，不会写入 localStorage。</p>
        )}
      </section>

      {canManage ? <section className="panel">
        <div className="section-title">
          <span>家属授权门槛</span>
          <h2>模拟家属授权</h2>
        </div>
        <p className="muted-copy">
          家属只有在“已授权 + 已人工确认 + family_summary”三者同时满足时，才能看到固定摘要；拒绝、pending 或 caregiver_only 一律不可见。
        </p>
        <div className="consent-authorize-row">
          <span className={`memory-status memory-status--${authorized ? "confirmed" : "pending"}`}>
            当前会话授权：{authorized ? "已授权" : "未授权"}
          </span>
          <div className="button-row">
            <button
              className="primary"
              type="button"
              disabled={!mockMode || authorized}
              onClick={grant}
            >
              模拟授权家属
            </button>
            <button
              type="button"
              disabled={!mockMode || !authorized}
              onClick={revoke}
            >
              撤回授权
            </button>
          </div>
        </div>
        {consent ? (
          <p className="muted-copy">
            该长者 consent 字段 familyCanViewVoiceSummary：{consent.familyCanViewVoiceSummary ? "允许" : "拒绝（即使授权也不可见）"}。
          </p>
        ) : null}
      </section> : (
        <section className="panel family-failclosed-notice">
          <strong>长者与家属端为只读隐私说明</strong>
          <p>授权、撤回和草稿确认只能从护工入口执行；长者和家属不能在此页面自行放行摘要。</p>
        </section>
      )}

      {canManage ? <section className="panel">
        <div className="section-title">
          <span>语音记忆草稿</span>
          <h2>护工人工确认 / 拒绝</h2>
        </div>
        {drafts.length === 0 ? (
          <p className="muted-copy">
            暂无 pending 草稿。可先在语音陪伴页面生成结构化摘要草稿。草稿不会自动确认，也不能由长者页面自审。
          </p>
        ) : (
          <div className="memory-review-list">
            {drafts.map((draft) => {
              const status = getVoiceMemoryReviewStatus(reviews, draft.id);
              return (
                <article className="memory-review-item" key={draft.id}>
                  <div>
                    <strong>{memoryTypeLabels[draft.memoryType]}</strong>
                    <p>{draft.contentSummary}</p>
                    <small>
                      可见范围：{visibilityLabels[draft.visibility]} · 当前状态：{reviewStatusLabels[status]}
                    </small>
                  </div>
                  <div className="memory-review-actions">
                    <span className={`memory-status memory-status--${status}`}>{reviewStatusLabels[status]}</span>
                    <button type="button" disabled={!mockMode} onClick={() => review(draft.id, "confirmed")}>确认</button>
                    <button type="button" disabled={!mockMode} onClick={() => review(draft.id, "rejected")}>拒绝</button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        <p className="muted-copy">确认 / 拒绝仅当前会话有效，不会写入 localStorage，也不产生 CareEvent 或修改风险等级。</p>
      </section> : null}

      <MedicalDisclaimer />
    </div>
  );
};
