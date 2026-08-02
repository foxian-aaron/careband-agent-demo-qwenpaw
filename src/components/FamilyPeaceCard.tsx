import type {
  CareTask,
  ConsentStatus,
  DailySnapshot,
  ElderProfile,
  RiskResult,
} from "../types";
import type { CareLoopStatus, DisplayStatus } from "../lib/displayStatus";
import {
  careLoopLabels,
  medicationLabels,
  riskLabels,
  taskStatusLabels,
} from "../lib/statusLabels";
import { formatDateTime } from "../lib/dateUtils";
import { RiskBadge } from "./RiskBadge";
import { StatusPill } from "./StatusPill";

interface FamilyPeaceCardProps {
  profile: ElderProfile;
  snapshot: DailySnapshot;
  risk: RiskResult;
  displayStatus: DisplayStatus;
  careLoopStatus: CareLoopStatus;
  task?: CareTask;
  exceptionText: string;
  consent?: ConsentStatus;
}

const HIDDEN = "需授权";

const coarseLocationZone = (value: string): string | null => {
  const zone = value.trim();
  const facilityFloor = /^(?:长者中心)?[一二三四五六七八九十]+楼(?:活动区|公共区|休息区|护理区|生活区)?$/;
  const sharedArea = /^(?:活动区|公共区|休息区|护理区|生活区|餐厅|花园|大厅)$/;
  return facilityFloor.test(zone) || sharedArea.test(zone) ? zone : null;
};

export const FamilyPeaceCard = ({
  profile,
  snapshot,
  risk,
  displayStatus,
  careLoopStatus,
  task,
  exceptionText,
  consent,
}: FamilyPeaceCardProps) => {
  // Stage 13 — every family-facing detail fails closed on its consent field.
  // Location is zone_only at most; precise coordinates are never shown.
  const canViewLocation = consent?.familyCanViewLocationZone === true &&
    consent.locationPrecision === "zone_only";
  const canViewMedication = consent?.familyCanViewMedicationStatus === true;
  const locationZone = canViewLocation ? coarseLocationZone(snapshot.locationZone) : null;
  const careLoopLabel = !canViewMedication && careLoopStatus === "medication_confirmed"
    ? "照护处理中"
    : careLoopLabels[careLoopStatus];

  return (
    <article className="family-peace-card">
      <div className="family-peace-card__head">
        <div>
          <span>今日安心卡</span>
          <h2>{profile.name}今日状态：{displayStatus.label}</h2>
          {displayStatus.shouldShowHistoricalRisk ? (
            <p>今日风险等级：{riskLabels[risk.riskLevel]}，已纳入照护跟进记录。</p>
          ) : null}
        </div>
        <div className="family-status-stack">
          <StatusPill
            label={displayStatus.shortLabel}
            tone={
              displayStatus.tone === "follow_up"
                ? "follow-up"
                : displayStatus.tone === "high_risk"
                  ? "high-risk"
                  : displayStatus.tone === "data_insufficient"
                    ? "muted"
                    : displayStatus.tone
            }
          />
          <RiskBadge level={risk.riskLevel} />
        </div>
      </div>
      <div className="peace-grid">
        <div>
          <span>当前位置</span>
          <strong>{locationZone ?? HIDDEN}</strong>
          <p>{locationZone ? (snapshot.safeZoneStatus === "inside" ? "在长者中心内" : "位置需确认") : "仅显示粗粒度区域，需授权"}</p>
        </div>
        <div>
          <span>跌倒检测</span>
          <strong>{snapshot.fallDetected ? "需确认" : "未检测到跌倒"}</strong>
          <p>持续观察安全事件</p>
        </div>
        <div>
          <span>早药状态</span>
          <strong>{canViewMedication ? medicationLabels[snapshot.medicationMorning] : HIDDEN}</strong>
          <p>{canViewMedication ? "系统记录已同步" : "需授权"}</p>
        </div>
        <div>
          <span>晚药状态</span>
          <strong>{canViewMedication ? medicationLabels[snapshot.medicationEvening] : HIDDEN}</strong>
          <p>{canViewMedication ? (snapshot.medicationEvening === "confirmed" ? "护工已确认" : "等待护工确认") : "需授权"}</p>
        </div>
        <div>
          <span>护工跟进</span>
          <strong>{careLoopLabel}</strong>
          <p>{task ? taskStatusLabels[task.status] : "暂无任务"}</p>
        </div>
        <div>
          <span>最近更新</span>
          <strong>{formatDateTime(snapshot.lastSyncedAt)}</strong>
          <p>来自模拟照护数据</p>
        </div>
      </div>
      <section className="family-exception">
        <h3>异常说明</h3>
        <p>{exceptionText}</p>
      </section>
    </article>
  );
};
