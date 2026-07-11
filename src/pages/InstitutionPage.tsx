import { useMemo, useState } from "react";
import { InstitutionHeatmap, type HeatmapRow } from "../components/InstitutionHeatmap";
import { AgentSourceBadge } from "../components/AgentSourceBadge";
import { MedicalDisclaimer } from "../components/MedicalDisclaimer";
import { RiskBadge } from "../components/RiskBadge";
import {
  deriveInstitutionMetrics,
  isSameCareDay,
  type InstitutionElderRowInput,
} from "../lib/institutionMetrics";
import {
  getActiveTaskForElder,
  getAgentSummariesForElder,
  getEventsForElder,
  getRiskForElder,
  getTaskForElder,
  useDemo,
} from "../store/demoStore";
import { deriveCareLoopStatus, deriveDisplayStatus } from "../lib/displayStatus";
import { getRecentCareRecord } from "../lib/taskSelectors";
import type { RiskLevel } from "../types";
import { riskLabels, riskOrder } from "../lib/statusLabels";

type FilterValue = "all" | RiskLevel;
type TreatmentFilter = "all" | "pending" | "in_progress" | "checked" | "follow_up" | "none";

const filters: Array<{ value: FilterValue; label: string }> = [
  { value: "all", label: "全部" },
  { value: "urgent", label: "紧急" },
  { value: "high_risk", label: "高风险" },
  { value: "attention", label: "需关注" },
  { value: "observation", label: "观察" },
  { value: "stable", label: "稳定" },
  { value: "data_insufficient", label: "数据不足" },
];

const treatmentFilters: Array<{ value: TreatmentFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待处理" },
  { value: "in_progress", label: "处理中" },
  { value: "checked", label: "已查看" },
  { value: "follow_up", label: "已跟进" },
  { value: "none", label: "无任务" },
];

export const InstitutionPage = () => {
  const { state } = useDemo();
  const [filter, setFilter] = useState<FilterValue>("all");
  const [treatmentFilter, setTreatmentFilter] = useState<TreatmentFilter>("all");

  const rows = useMemo<HeatmapRow[]>(() => {
    return Object.values(state.profiles)
      .map((profile) => {
        const events = getEventsForElder(state, profile.elderId);
        const risk = getRiskForElder(state, profile.elderId);
        const careLoopStatus = deriveCareLoopStatus(profile.elderId, state.tasks, events);
        const displayStatus = deriveDisplayStatus(risk, careLoopStatus);
        return {
          profile,
          risk,
          displayStatus,
          careLoopStatus,
          snapshot: state.snapshots[profile.elderId],
          deviceRecord: state.deviceRecords[profile.elderId],
          memoryEstablished: Boolean(state.initialCareMemoryByElderId[profile.elderId]),
          task:
            getActiveTaskForElder(state, profile.elderId) ??
            getTaskForElder(state, profile.elderId),
          operationalState: state.operationalStates[profile.elderId] ?? "normal",
          recentCareRecord: getRecentCareRecord(profile.elderId, state.tasks, state.events),
        };
      })
      .sort((a, b) => riskOrder[b.risk.riskLevel] - riskOrder[a.risk.riskLevel]);
  }, [state]);

  const matchesTreatment = (row: HeatmapRow) => {
    if (treatmentFilter === "all") return true;
    if (treatmentFilter === "pending") return row.careLoopStatus === "pending";
    if (treatmentFilter === "in_progress") return row.careLoopStatus === "in_progress";
    if (treatmentFilter === "checked") {
      return ["checked", "medication_confirmed"].includes(row.careLoopStatus);
    }
    if (treatmentFilter === "follow_up") {
      return ["completed", "follow_up"].includes(row.careLoopStatus);
    }
    return row.careLoopStatus === "none";
  };

  const filteredRows = rows.filter(
    (row) =>
      (filter === "all" || row.risk.riskLevel === filter) && matchesTreatment(row),
  );
  const operationalRows = rows.filter((row) => row.profile.subjectKind !== "team_test");
  const metricsInput: InstitutionElderRowInput[] = operationalRows.map((row) => ({
    elderId: row.profile.elderId,
    riskLevel: row.risk.riskLevel,
    riskScore: row.risk.riskScore,
    displayStatusLabel: row.displayStatus.label,
    displayStatusTone: row.displayStatus.tone,
    careLoopStatus: row.careLoopStatus,
    taskStatus: row.task?.status,
    dataCompleteness: row.risk.dataCompleteness,
    isTeamTest: row.profile.subjectKind === "team_test",
    hadHighRiskToday:
      ["high_risk", "urgent"].includes(row.risk.riskLevel) ||
      state.tasks.some(
        (task) =>
          task.elderId === row.profile.elderId &&
          ["high", "urgent"].includes(task.priority) &&
          isSameCareDay(task.createdAt),
      ),
  }));
  const metrics = deriveInstitutionMetrics(metricsInput);
  const attentionCount = operationalRows.filter(
    (row) => row.risk.riskLevel === "attention",
  ).length;
  const stableCount = operationalRows.filter((row) => row.risk.riskLevel === "stable").length;
  const medicationUnconfirmed = Object.values(state.snapshots).filter(
    (snapshot) =>
      state.profiles[snapshot.elderId]?.subjectKind !== "team_test" &&
      snapshot.medicationEvening === "not_confirmed",
  ).length;
  const activityDrop = operationalRows.filter(
    (row) => row.risk.dimensions.activity === "significantly_low",
  ).length;
  const sleepLow = operationalRows.filter(
    (row) => row.risk.dimensions.sleep === "below_baseline",
  ).length;
  const dataInsufficient = operationalRows.filter(
    (row) => row.risk.riskLevel === "data_insufficient",
  ).length;
  const memoryEstablishedCount = operationalRows.filter((row) => row.memoryEstablished).length;
  const deviceOfflineCount = operationalRows.filter(
    (row) => row.deviceRecord?.connectionStatus === "offline",
  ).length;
  const chenAgentSummaries = getAgentSummariesForElder(state, "E001");

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span>机构端</span>
          <h1>长者风险热力图</h1>
          <p>面向管理者的群体态势、任务状态和巡查优先级总览。</p>
        </div>
        <a className="primary-link" href="#/demo-control">
          进入 Demo 控制台
        </a>
      </header>

      <section className="stats-grid">
        <article>
          <span>当前未闭环高风险</span>
          <strong>{metrics.currentOpenHighRiskCount}</strong>
          <p>仍需机构关注的高风险个案</p>
        </article>
        <article>
          <span>今日曾高风险</span>
          <strong>{metrics.todayEverHighRiskCount}</strong>
          <p>今日曾触发高风险或紧急状态</p>
        </article>
        <article>
          <span>已跟进高风险</span>
          <strong>{metrics.followedUpHighRiskCount}</strong>
          <p>今日高风险中已完成护工跟进</p>
        </article>
        <article>
          <span>待处理任务</span>
          <strong>{metrics.pendingTaskCount}</strong>
          <p>尚未接单的任务</p>
        </article>
        <article>
          <span>平均数据完整度</span>
          <strong>{metrics.averageDataCompleteness}%</strong>
          <p>今日状态数据可信度</p>
        </article>
      </section>

      <section className="panel">
        <div className="section-title with-actions">
          <div>
            <span>机构风险热力图</span>
            <h2>按风险等级排序</h2>
          </div>
          <div className="filter-row">
            {filters.map((item) => (
              <button
                className={filter === item.value ? "active" : ""}
                key={item.value}
                onClick={() => setFilter(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="filter-row">
            {treatmentFilters.map((item) => (
              <button
                className={treatmentFilter === item.value ? "active" : ""}
                key={item.value}
                onClick={() => setTreatmentFilter(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <InstitutionHeatmap rows={filteredRows} />
      </section>

      <section className="two-column">
        <article className="panel">
          <div className="section-title">
            <span>群体趋势摘要</span>
            <h2>今日关注点</h2>
          </div>
          <div className="summary-grid">
            <div><span>今日曾高风险</span><strong>{metrics.todayEverHighRiskCount}</strong></div>
            <div><span>当前未闭环高风险</span><strong>{metrics.currentOpenHighRiskCount}</strong></div>
            <div><span>需关注人数</span><strong>{attentionCount}</strong></div>
            <div><span>稳定人数</span><strong>{stableCount}</strong></div>
            <div><span>用药未确认人数</span><strong>{medicationUnconfirmed}</strong></div>
            <div><span>活动明显下降人数</span><strong>{activityDrop}</strong></div>
            <div><span>睡眠偏低人数</span><strong>{sleepLow}</strong></div>
            <div><span>数据不足人数</span><strong>{dataInsufficient}</strong></div>
            <div><span>记忆已建立</span><strong>{memoryEstablishedCount}</strong></div>
            <div><span>设备离线</span><strong>{deviceOfflineCount}</strong></div>
          </div>
        </article>
        <article className="panel ai-summary-card">
          <div className="section-title">
            <span>陈伯 E001 · 机构摘要</span>
            <h2>同一次 Agent 运行的管理视角</h2>
          </div>
          <p>{chenAgentSummaries.institutionSummary}</p>
          <AgentSourceBadge summaries={chenAgentSummaries} />
          <div className="risk-strip">
            {operationalRows.slice(0, 3).map((row) => (
              <div key={row.profile.elderId}>
                <strong>{row.profile.name}</strong>
                <RiskBadge level={row.risk.riskLevel} />
                <span>{riskLabels[row.risk.riskLevel]}</span>
              </div>
            ))}
          </div>
        </article>
      </section>
      <MedicalDisclaimer />
    </div>
  );
};
