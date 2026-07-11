import type { Dispatch } from "react";
import type { DemoAction } from "../store/demoStore";
import type { CareEvent, CareTask, ElderProfile, MedicationStatus, RiskResult } from "../types";
import type { CareLoopStatus } from "../lib/displayStatus";
import { careLoopLabels, priorityLabels, taskStatusLabels } from "../lib/statusLabels";
import { RiskBadge } from "./RiskBadge";
import { StatusPill } from "./StatusPill";

interface CareTaskCardProps {
  task: CareTask;
  profile: ElderProfile;
  risk: RiskResult;
  careLoopStatus: CareLoopStatus;
  events: CareEvent[];
  medicationEvening: MedicationStatus;
  dispatch: Dispatch<DemoAction>;
}

export const CareTaskCard = ({
  task,
  profile,
  risk,
  careLoopStatus,
  events,
  medicationEvening,
  dispatch,
}: CareTaskCardProps) => {
  const isChen = profile.elderId === "E001";
  const isCompleted = task.status === "completed";
  const isCancelled = task.status === "cancelled";
  const hasChecked = events.some(
    (event) =>
      event.eventType === "caregiver_checked" &&
      (!event.linkedTaskId || event.linkedTaskId === task.taskId),
  );
  const canAccept = isChen && task.status === "pending";
  const canMarkViewed = isChen && task.status === "in_progress" && !hasChecked;
  const canConfirmMedication =
    isChen && task.status === "in_progress" && hasChecked && medicationEvening !== "confirmed";
  const canComplete =
    isChen &&
    task.status === "in_progress" &&
    hasChecked &&
    medicationEvening === "confirmed";
  const sourceLabels = {
    rule_engine: "规则引擎",
    hardware_event: "硬件事件",
    voice_event: "语音事件",
    data_insufficient: "数据不足",
    location_event: "位置事件",
    agent: "Agent",
  };
  const agentSourceLabels = {
    mock: "Mock",
    qwenpaw: "QwenPaw",
    openai: "OpenAI",
    fallback_rule: "规则 fallback",
  };
  const agentSourceLabel = task.agentSummarySource
    ? agentSourceLabels[task.agentSummarySource]
    : "未生成 / 未关联";

  return (
    <article className={`task-card priority-${task.priority}`}>
      <div className="task-card__head">
        <div>
          <span>{priorityLabels[task.priority]}</span>
          <h3>{task.title}</h3>
          <p>
            {profile.name} · 房间 {profile.room} · {taskStatusLabels[task.status]} ·{" "}
            {careLoopLabels[careLoopStatus]}
          </p>
        </div>
        <RiskBadge level={risk.riskLevel} score={risk.riskScore} />
      </div>
      <dl className="task-details">
        <div>
          <dt>任务来源</dt>
          <dd>
            <div className="tag-row">
              <StatusPill label={sourceLabels[task.sourceType ?? "rule_engine"]} tone="observation" />
              <StatusPill label={`Agent 摘要来源：${agentSourceLabel}`} tone="stable" />
            </div>
          </dd>
        </div>
        <div>
          <dt>原因</dt>
          <dd>{task.reason}</dd>
        </div>
        <div>
          <dt>建议动作</dt>
          <dd>{task.recommendedAction}</dd>
        </div>
      </dl>
      {task.note ? <p className="care-note">{task.note}</p> : null}
      <div className="card-actions">
        <a className="text-button" href={`#/elder/${profile.elderId}/profile`}>
          查看档案
        </a>
        <a className="text-button" href={`#/medication/${profile.elderId}`}>
          查看用药计划
        </a>
      </div>
      <div className="button-row">
        <button
          disabled={!canAccept}
          title={canAccept ? "接单后进入处理中" : "当前步骤不可接单"}
          onClick={() => dispatch({ type: "CAREGIVER_ACCEPT_TASK" })}
        >
          接单
        </button>
        <button
          disabled={!canMarkViewed}
          title={canMarkViewed ? "记录护工已到场查看" : "接单后才能标记已查看"}
          onClick={() => dispatch({ type: "CAREGIVER_MARK_VIEWED" })}
        >
          标记已查看
        </button>
        <button
          disabled={!canConfirmMedication}
          title={canConfirmMedication ? "确认晚药后可完成记录" : "已查看后才能确认晚药"}
          onClick={() => dispatch({ type: "CONFIRM_EVENING_MEDICATION" })}
        >
          确认晚药
        </button>
        <button
          className="primary"
          disabled={!canComplete || isCompleted || isCancelled}
          title={canComplete ? "完成并写入固定模拟备注" : "确认晚药后才能完成"}
          onClick={() => dispatch({ type: "COMPLETE_CARE_TASK" })}
        >
          {isCompleted ? "已完成" : isCancelled ? "已取消" : "完成并记录"}
        </button>
      </div>
    </article>
  );
};
