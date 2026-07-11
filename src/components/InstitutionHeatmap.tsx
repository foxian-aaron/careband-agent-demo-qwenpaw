import type {
  CareTask,
  DailySnapshot,
  DeviceRecord,
  DimensionStatus,
  ElderProfile,
  OperationalState,
  RiskResult,
} from "../types";
import type { CareLoopStatus, DisplayStatus } from "../lib/displayStatus";
import { displayToneToPillTone } from "../lib/displayStatus";
import { ratioDataQualityToPercent } from "../lib/dataQuality";
import {
  careLoopLabels,
  dimensionLabels,
  dimensionTone,
  operationalLabels,
  riskLabels,
  taskStatusLabels,
} from "../lib/statusLabels";
import { RiskBadge } from "./RiskBadge";
import { StatusPill } from "./StatusPill";

export interface HeatmapRow {
  profile: ElderProfile;
  risk: RiskResult;
  displayStatus: DisplayStatus;
  careLoopStatus: CareLoopStatus;
  task?: CareTask;
  snapshot?: DailySnapshot;
  deviceRecord?: DeviceRecord;
  memoryEstablished: boolean;
  operationalState: OperationalState;
  recentCareRecord?: string;
}

interface InstitutionHeatmapProps {
  rows: HeatmapRow[];
}

const DimensionCell = ({
  label,
  status,
}: {
  label: string;
  status: DimensionStatus;
}) => (
  <td>
    <StatusPill label={label} tone={dimensionTone(status)} />
  </td>
);

export const InstitutionHeatmap = ({ rows }: InstitutionHeatmapProps) => (
  <div className="table-wrap">
    <table className="heatmap-table">
      <thead>
        <tr>
          <th>老人</th>
          <th>房间</th>
          <th>前台展示状态</th>
          <th>今日风险等级</th>
          <th>数据来源</th>
          <th>生命体征</th>
          <th>活动</th>
          <th>睡眠</th>
          <th>用药</th>
          <th>安全</th>
          <th>设备状态</th>
          <th>照护记忆</th>
          <th>任务状态</th>
          <th>最近处理记录</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ profile, risk, displayStatus, careLoopStatus, task, snapshot, deviceRecord, memoryEstablished, operationalState, recentCareRecord }) => (
          <tr key={profile.elderId}>
            <td>
              <strong>{profile.name}</strong>
              <span>{profile.age} 岁</span>
            </td>
            <td>{profile.room}</td>
            <td>
              <StatusPill
                label={displayStatus.label}
                tone={displayToneToPillTone(displayStatus.tone)}
              />
              {displayStatus.shouldShowHistoricalRisk ? (
                <span>今日曾出现高风险事件</span>
              ) : null}
            </td>
            <td>
              <RiskBadge level={risk.riskLevel} score={risk.riskScore} />
              <span>{riskLabels[risk.riskLevel]}</span>
            </td>
            <td>
              <strong>{snapshot?.dataSource ?? "本地 Mock"}</strong>
              <span>
                质量 {ratioDataQualityToPercent(snapshot?.dataQuality ?? risk.dataCompleteness)}%
              </span>
            </td>
            <DimensionCell
              label={dimensionLabels[risk.dimensions.vitals]}
              status={risk.dimensions.vitals}
            />
            <DimensionCell
              label={dimensionLabels[risk.dimensions.activity]}
              status={risk.dimensions.activity}
            />
            <DimensionCell
              label={dimensionLabels[risk.dimensions.sleep]}
              status={risk.dimensions.sleep}
            />
            <DimensionCell
              label={dimensionLabels[risk.dimensions.medication]}
              status={risk.dimensions.medication}
            />
            <DimensionCell
              label={dimensionLabels[risk.dimensions.safety]}
              status={risk.dimensions.safety}
            />
            <td>
              <strong>{deviceRecord?.connectionStatus === "online" ? "在线" : "离线"}</strong>
              <span>{deviceRecord?.wearStatus === "worn" ? "已佩戴" : "未佩戴"}</span>
              <span>完整度 {Math.round((deviceRecord?.dataQuality ?? risk.dataCompleteness) * 100)}%</span>
              <span>同步：{deviceRecord?.lastSyncAt.slice(11, 16) ?? "-"}</span>
            </td>
            <td>
              <StatusPill
                label={memoryEstablished ? "已建立" : "未建立"}
                tone={memoryEstablished ? "stable" : "muted"}
              />
            </td>
            <td>
              <strong>{careLoopLabels[careLoopStatus]}</strong>
              {task ? <span>{taskStatusLabels[task.status]}</span> : null}
              <span>运营：{operationalLabels[operationalState]}</span>
            </td>
            <td>
              <span>{recentCareRecord || "暂无处理记录"}</span>
            </td>
            <td>
              <div className="table-actions">
                <a className="text-button" href={`#/elder/${profile.elderId}`}>
                  查看详情
                </a>
                <a className="text-button" href={`#/elder/${profile.elderId}/profile`}>
                  档案
                </a>
                <a className="text-button" href={`#/medication/${profile.elderId}`}>
                  用药
                </a>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
