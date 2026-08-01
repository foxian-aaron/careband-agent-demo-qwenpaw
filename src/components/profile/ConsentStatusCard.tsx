import type { ConsentStatus } from "../../types";
import { StatusPill } from "../StatusPill";

interface ConsentStatusCardProps {
  consent?: ConsentStatus;
  elderId?: string;
}

const yesNo = (value?: boolean) => (value ? "是" : "否");
export const doctorSummaryLabel = (consent?: ConsentStatus) =>
  !consent ? "未授权" : consent.doctorSummaryRequiresApproval ? "需要授权" : "无需额外授权";

export const ConsentStatusCard = ({ consent, elderId }: ConsentStatusCardProps) => (
  <article className="panel">
    <div className="section-title">
      <span>授权与隐私</span>
      <h2>Demo 模拟授权状态</h2>
    </div>
    <div className="tag-row consent-tags">
      <StatusPill label={`家属可查看今日安心卡：${yesNo(consent?.familyCanViewDailyStatus)}`} tone="stable" />
      <StatusPill label={`家属可查看用药状态：${yesNo(consent?.familyCanViewMedicationStatus)}`} tone="stable" />
      <StatusPill label={`家属可查看位置区域：${yesNo(consent?.familyCanViewLocationZone)}`} tone="stable" />
      <StatusPill label={`家属可查看语音摘要：${yesNo(consent?.familyCanViewVoiceSummary)}`} tone="stable" />
      <StatusPill label={consent?.locationPrecision === "zone_only" ? "位置精度：仅显示区域" : "位置精度：未授权"} tone="observation" />
      <StatusPill label={consent?.voiceRawTextPolicy === "summary_only" ? "语音内容：默认摘要化" : "语音内容：未授权"} tone="observation" />
      <StatusPill label={`医生摘要：${doctorSummaryLabel(consent)}`} tone="attention" />
    </div>
    <p className="muted-copy">
      本 Demo 使用模拟数据。真实试点时，健康、位置和语音信息需要经过授权并按角色最小必要展示。
    </p>
    {elderId ? (
      <div className="button-row">
        <a className="text-button" href={`#/caregiver/elder/${elderId}/privacy`}>前往护工隐私授权演示页</a>
      </div>
    ) : null}
  </article>
);
