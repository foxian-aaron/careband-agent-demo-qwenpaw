import { AgentTracePanel } from "../components/AgentTracePanel";
import { AgentIOPanel } from "../components/AgentIOPanel";
import { CareMemoryTags } from "../components/CareMemoryTags";
import { DataQualityBadge } from "../components/DataQualityBadge";
import { DecisionTracePanel } from "../components/DecisionTracePanel";
import { DeviceStatusCard } from "../components/DeviceStatusCard";
import { FiveDimensionStatus } from "../components/FiveDimensionStatus";
import { MedicalDisclaimer } from "../components/MedicalDisclaimer";
import { MetricCard } from "../components/MetricCard";
import { RiskBadge } from "../components/RiskBadge";
import { StatusPill } from "../components/StatusPill";
import { Timeline } from "../components/Timeline";
import { TrendMiniChart } from "../components/TrendMiniChart";
import { UnknownElderState } from "../components/UnknownElderState";
import { WearableDataSourceBadge } from "../components/WearableDataSourceBadge";
import { WeeklyTrendSummary } from "../components/WeeklyTrendSummary";
import { formatDateTime } from "../lib/dateUtils";
import { ratioDataQualityToPercent } from "../lib/dataQuality";
import { deriveCareLoopStatus, deriveDisplayStatus, displayToneToPillTone } from "../lib/displayStatus";
import { getElderViewModel } from "../lib/elderView";
import {
  medicationLabels,
  operationalLabels,
  riskLabels,
  riskOrder,
} from "../lib/statusLabels";
import {
  getAgentSummariesForElder,
  getEventsForElder,
  getRiskForElder,
  useDemo,
} from "../store/demoStore";

interface ElderDashboardPageProps {
  elderId: string;
}

const percentDeviation = (today: number | null, baseline: number) => {
  if (today === null) return "数据缺失";
  const value = Math.round(((today - baseline) / baseline) * 100);
  return `${value > 0 ? "+" : ""}${value}%`;
};

const metricTone = (deviation: number | null) => {
  if (deviation === null) return "muted" as const;
  if (deviation <= -50) return "attention" as const;
  if (deviation <= -25) return "observation" as const;
  return "stable" as const;
};

const formatSigned = (value: number, digits = 0) => {
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? "+" : ""}${rounded}`;
};

const getIdentityNotice = (elderId: string) => {
  if (elderId === "TEST001") {
    return {
      badges: [
        "團隊 Apple Watch 測試資料",
        "非真實長者",
        "驗證真實穿戴資料導入",
        "不作為真實老人健康結論",
      ],
      note: "此頁為團隊 Apple Watch 測試資料。完整照護閉環請查看陳伯 E001 Demo。",
    };
  }
  if (elderId === "E001") {
    return {
      badges: ["陳伯 Demo 情境", "模擬長者照護流程", "活動下降 + 頭暈 + SOS + 護工跟進"],
      note: "此頁是主照護閉環腳本，用於展示風險提示、任務建立、Agent 摘要與護工處理。",
    };
  }
  return {
    badges: ["Seeded demo elder"],
    note: "此頁為 seeded demo elder，用於展示不同照護狀態。",
  };
};

export const ElderDashboardPage = ({ elderId }: ElderDashboardPageProps) => {
  const { state } = useDemo();
  const viewModel = getElderViewModel(state, elderId);
  if (!viewModel.found) return <UnknownElderState elderId={elderId} />;
  const { profile, baseline, snapshot, trend } = viewModel;
  const risk = getRiskForElder(state, profile.elderId);
  const events = getEventsForElder(state, profile.elderId);
  const summaries = getAgentSummariesForElder(state, profile.elderId);
  const memory = state.initialCareMemoryByElderId[profile.elderId];
  const device = state.deviceRecords[profile.elderId];
  const operationalState = state.operationalStates[profile.elderId] ?? "normal";
  const careLoopStatus = deriveCareLoopStatus(profile.elderId, state.tasks, events);
  const displayStatus = deriveDisplayStatus(risk, careLoopStatus);
  const identityNotice = getIdentityNotice(profile.elderId);
  const snapshotQuality = snapshot.dataQuality ?? snapshot.dataCompleteness;
  const stepDeviation =
    snapshot.stepsToday === null
      ? null
      : Math.round(((snapshot.stepsToday - baseline.avgSteps7d) / baseline.avgSteps7d) * 100);
  const activeDeviation =
    snapshot.activeMinutes === null
      ? null
      : Math.round(
          ((snapshot.activeMinutes - baseline.avgActiveMinutes7d) /
            baseline.avgActiveMinutes7d) *
            100,
        );

  return (
    <div className="page">
      <header className="page-header elder-hero">
        <div>
          <span>长者状态驾驶舱</span>
          <h1>{profile.name}</h1>
          <p>
            {profile.age} 岁 · 房间 {profile.room} · {profile.floor} · 最后同步{" "}
            {formatDateTime(snapshot.lastSyncedAt)}
          </p>
          <div className="tag-row">
            {identityNotice.badges.map((badge) => (
              <StatusPill label={badge} tone={profile.elderId === "TEST001" ? "observation" : "stable"} key={badge} />
            ))}
            {profile.chronicConditions.map((tag) => (
              <StatusPill label={`慢病标签：${tag}`} tone="observation" key={tag} />
            ))}
            {profile.riskTags.map((tag) => (
              <StatusPill label={tag} tone="attention" key={tag} />
            ))}
            <StatusPill
              label={`数据完整度 ${Math.round(snapshot.dataCompleteness * 100)}%`}
              tone={snapshot.dataCompleteness < 0.4 ? "muted" : "stable"}
            />
            <StatusPill
              label={`数据来源：${snapshot.dataSource ?? "本地 Mock"}`}
              tone={snapshot.dataSource === "Apple Health Export" ? "observation" : "stable"}
            />
            <StatusPill
              label={`数据质量 ${ratioDataQualityToPercent(snapshotQuality)}%`}
              tone={snapshotQuality < 0.4 ? "muted" : "stable"}
            />
            <StatusPill label={`快照日期：${snapshot.date}`} tone="stable" />
            <StatusPill
              label={`基線狀態：${baseline.baselineLabel ?? "7日基線"}${
                baseline.usableDays !== undefined ? `（${baseline.usableDays} 天）` : ""
              }`}
              tone={(baseline.usableDays ?? 7) < 3 ? "observation" : "stable"}
            />
            <StatusPill
              label={`靜息心率：${
                snapshot.restingHeartRate === null || snapshot.restingHeartRate === undefined
                  ? "缺失"
                  : `${snapshot.restingHeartRate} bpm`
              }`}
              tone="stable"
            />
          </div>
          <CareMemoryTags memory={memory} />
          <p className="identity-note">{identityNotice.note}</p>
          <div className="button-row page-link-row">
            <a className="text-button" href={`#/elder/${profile.elderId}/profile`}>
              查看老人档案
            </a>
            <a className="text-button" href={`#/medication/${profile.elderId}`}>
              查看用药计划
            </a>
            <a className="text-button" href={`#/elder/${profile.elderId}/memory-intake`}>
              导入历史资料
            </a>
            <a className="text-button" href={`#/elder/${profile.elderId}/wearable-import`}>
              穿戴数据导入
            </a>
            <a className="text-button" href="#/hardware-simulator">
              打开硬件模拟器
            </a>
            <a className="text-button" href={`#/elder/${profile.elderId}/privacy`}>
              授权与隐私
            </a>
            {profile.elderId === "TEST001" ? (
              <a className="text-button" href="#/elder/E001">
                查看陳伯照護閉環 Demo
              </a>
            ) : null}
          </div>
        </div>
        <div className="hero-status-stack">
          <StatusPill
            label={`前台状态：${displayStatus.label}`}
            tone={displayToneToPillTone(displayStatus.tone)}
          />
          <RiskBadge level={risk.riskLevel} score={risk.riskScore} />
        </div>
      </header>

      <section className="two-column">
        <DeviceStatusCard device={device} />
        <article className="panel">
          <div className="section-title">
            <span>数据接入状态</span>
            <h2>Backend / Mock / Wearable Import</h2>
          </div>
          <div className="tag-row">
            <WearableDataSourceBadge source={snapshot.dataSource ?? device?.dataSource} />
            <DataQualityBadge quality={snapshot.dataCompleteness} />
            <StatusPill label={memory ? "初始照护记忆：已建立" : "初始照护记忆：未建立"} tone={memory ? "stable" : "muted"} />
            <StatusPill label="动态状态基线：建立中" tone="observation" />
          </div>
          <p className="muted-copy">
            当前支持 v0.2 后端 fallback、Apple Health Export 示例和前端 Mock 穿戴导入。真实接入时可替换为 Apple Health / Health Connect / Fitbit / Zepp。
          </p>
        </article>
      </section>

      <section className="current-state-card">
        <div>
          <span>当前总状态</span>
          <h2>{displayStatus.label}</h2>
          <p>当前运营状态：{operationalLabels[operationalState]}</p>
          <p>今日风险等级：{riskLabels[risk.riskLevel]}</p>
        </div>
        <div>
          <span>风险分数</span>
          <strong>{risk.riskScore}</strong>
          <p>置信度 {Math.round(risk.confidence * 100)}%</p>
        </div>
        <div>
          <span>关键原因</span>
          <ul>
            {risk.keyReasons.slice(0, 4).map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
        <div>
          <span>建议动作</span>
          <p>{risk.recommendedAction}</p>
        </div>
      </section>

      <FiveDimensionStatus dimensions={risk.dimensions} />

      <section className="panel">
        <div className="section-title">
          <span>今日关键指标</span>
          <h2>与个人基线对比</h2>
        </div>
        <div className="metric-grid">
          <MetricCard
            title="心率"
            todayValue={snapshot.heartRate === null ? "缺失" : `${snapshot.heartRate} bpm`}
            baselineValue={`${baseline.restingHrBaseline} bpm`}
            deviation={
              snapshot.heartRate === null
                ? "数据缺失"
                : `${formatSigned(snapshot.heartRate - baseline.restingHrBaseline, 1)} bpm`
            }
            explanation="只与本人静息基线对比，用于照护关注，不做医疗诊断。"
            tone={snapshot.heartRate && snapshot.heartRate - baseline.restingHrBaseline >= 12 ? "observation" : "stable"}
          />
          <MetricCard
            title="靜息心率"
            todayValue={
              snapshot.restingHeartRate === null || snapshot.restingHeartRate === undefined
                ? "缺失"
                : `${snapshot.restingHeartRate} bpm`
            }
            baselineValue={`${baseline.restingHrBaseline} bpm`}
            deviation={
              snapshot.restingHeartRate === null || snapshot.restingHeartRate === undefined
                ? "數據缺失"
                : `${formatSigned(snapshot.restingHeartRate - baseline.restingHrBaseline, 1)} bpm`
            }
            explanation="Apple Health Export 的靜息心率只用於和個人基線對照。"
            tone={
              snapshot.restingHeartRate !== null &&
              snapshot.restingHeartRate !== undefined &&
              Math.abs(snapshot.restingHeartRate - baseline.restingHrBaseline) >= 12
                ? "observation"
                : "stable"
            }
          />
          <MetricCard
            title="步数"
            todayValue={snapshot.stepsToday === null ? "缺失" : `${snapshot.stepsToday} 步`}
            baselineValue={`${baseline.avgSteps7d} 步`}
            deviation={percentDeviation(snapshot.stepsToday, baseline.avgSteps7d)}
            explanation="今日步数明显低于本人 7 日平均，是需关注的重要原因。"
            tone={metricTone(stepDeviation)}
          />
          <MetricCard
            title="活跃时长"
            todayValue={snapshot.activeMinutes === null ? "缺失" : `${snapshot.activeMinutes} 分钟`}
            baselineValue={`${baseline.avgActiveMinutes7d} 分钟`}
            deviation={percentDeviation(snapshot.activeMinutes, baseline.avgActiveMinutes7d)}
            explanation="活跃时长与步数一起帮助判断今日活动量是否偏离。"
            tone={metricTone(activeDeviation)}
          />
          <MetricCard
            title="睡眠"
            todayValue={snapshot.sleepDuration === null ? "缺失" : `${snapshot.sleepDuration} 小时`}
            baselineValue={`${baseline.avgSleep7d} 小时`}
            deviation={
              snapshot.sleepDuration === null
                ? "数据缺失"
                : `${(snapshot.sleepDuration - baseline.avgSleep7d).toFixed(1)} 小时`
            }
            explanation="昨晚睡眠低于本人基线，建议结合白天精神状态观察。"
            tone={risk.dimensions.sleep === "below_baseline" ? "observation" : "stable"}
          />
          <MetricCard
            title="用药"
            todayValue={`早 ${medicationLabels[snapshot.medicationMorning]} / 晚 ${medicationLabels[snapshot.medicationEvening]}`}
            baselineValue={`准时率 ${Math.round(baseline.medicationOnTimeRate * 100)}%`}
            deviation={snapshot.medicationEvening === "not_confirmed" ? "晚药未确认" : "已确认"}
            explanation="晚药未确认会提升照护任务优先级，确认后同步到三端。"
            tone={snapshot.medicationEvening === "not_confirmed" ? "attention" : "stable"}
          />
          <MetricCard
            title="位置"
            todayValue={snapshot.locationZone}
            baselineValue="长者中心安全区域"
            deviation={snapshot.safeZoneStatus === "inside" ? "在安全区域内" : "需确认"}
            explanation="当前未离开安全区域，未检测到跌倒。"
            tone={snapshot.safeZoneStatus === "inside" ? "stable" : "attention"}
          />
          <MetricCard
            title="佩戴时间"
            todayValue={snapshot.wearTimeHours === null ? "数据缺失" : `${snapshot.wearTimeHours} 小时`}
            baselineValue="建议全天候佩戴"
            deviation={
              snapshot.wearTimeHours === null
                ? "数据缺失"
                : snapshot.wearTimeHours >= 12
                  ? "数据可参考"
                  : "佩戴不足"
            }
            explanation="佩戴时间影响状态判断置信度。"
            tone={snapshot.wearTimeHours !== null && snapshot.wearTimeHours >= 12 ? "stable" : "muted"}
          />
          <MetricCard
            title="数据质量"
            todayValue={`${ratioDataQualityToPercent(snapshotQuality)}%`}
            baselineValue={`基线置信度 ${Math.round(baseline.baselineConfidence * 100)}%`}
            deviation={snapshot.dataSource ?? "本地 Mock"}
            explanation="数据质量低时系统会优先提示确认设备佩戴，不做过度判断。"
            tone={snapshotQuality < 0.4 ? "muted" : "stable"}
          />
        </div>
      </section>

      <section className="two-column">
        <article className="panel">
          <div className="section-title">
            <span>AI 初步观察</span>
            <h2>结构化摘要</h2>
          </div>
          <ul className="insight-list">
            {risk.keyReasons.slice(0, 5).map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
            <li>{risk.recommendedAction}</li>
          </ul>
        </article>
        <article className="panel">
          <div className="section-title">
            <span>24 小时时间线</span>
            <h2>事件记录</h2>
          </div>
          <Timeline events={events} compact />
        </article>
      </section>

      <section className="panel">
        <div className="section-title">
          <span>7 日趋势</span>
          <h2>步数、睡眠、用药准时率、风险等级</h2>
        </div>
        <div className="trend-grid">
          <TrendMiniChart
            title="步数趋势"
            points={trend.points.flatMap((point) =>
              point.steps === null ? [] : [{ label: point.date, value: point.steps }],
            )}
            unit="步"
          />
          <TrendMiniChart
            title="睡眠趋势"
            points={trend.points.flatMap((point) =>
              point.sleepHours === null ? [] : [{ label: point.date, value: point.sleepHours }],
            )}
            unit="小时"
          />
          <TrendMiniChart
            title="用药准时率"
            points={trend.points.map((point) => ({
              label: point.date,
              value: Math.round(point.medicationOnTimeRate * 100),
            }))}
            unit="%"
            variant="bar"
          />
          <TrendMiniChart
            title="风险等级趋势"
            points={trend.points.map((point) => ({
              label: point.date,
              value: riskOrder[point.riskLevel],
            }))}
            variant="bar"
          />
        </div>
      </section>

      <DecisionTracePanel
        baseline={baseline}
        displayStatus={displayStatus}
        events={events}
        profile={profile}
        risk={risk}
        snapshot={snapshot}
        summaries={summaries}
        trace={summaries.decisionTrace}
      />
      <AgentTracePanel elderId={profile.elderId} />
      <WeeklyTrendSummary elderId={profile.elderId} />
      <AgentIOPanel
        baseline={baseline}
        events={events}
        profile={profile}
        risk={risk}
        snapshot={snapshot}
        summaries={summaries}
      />
      <MedicalDisclaimer />
    </div>
  );
};
