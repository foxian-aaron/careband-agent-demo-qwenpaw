import type { Dispatch } from "react";
import type { DemoAction } from "../store/demoStore";
import type { CareEvent, CareTask, ElderProfile, MedicationStatus, RiskResult } from "../types";
import type { CareLoopStatus } from "../lib/displayStatus";
import { careLoopLabels, priorityLabels, taskStatusLabels } from "../lib/statusLabels";
import { RiskBadge } from "./RiskBadge";

interface CareTaskCardProps {
  task: CareTask;
  profile: ElderProfile;
  risk: RiskResult;
  careLoopStatus: CareLoopStatus;
  events: CareEvent[];
  medicationEvening: MedicationStatus;
  connected: boolean;
  dispatch: Dispatch<DemoAction>;
}

export const CareTaskCard = ({
  task,
  profile,
  risk,
  careLoopStatus,
  events,
  medicationEvening,
  connected,
  dispatch,
}: CareTaskCardProps) => {
  const isChen = profile.elderId === "E001";
  const isCompleted = task.status === "completed";
  const hasChecked = events.some((event) => event.eventType === "caregiver_checked");
  const canAccept = isChen && task.status === "pending";
  const canMarkViewed = !connected && isChen && task.status === "in_progress" && !hasChecked;
  const canConfirmMedication =
    !connected && isChen && task.status === "in_progress" && hasChecked && medicationEvening !== "confirmed";
  const canComplete =
    isChen &&
    task.status === "in_progress" &&
    (connected || (hasChecked && medicationEvening === "confirmed"));

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
        {!connected ? (
          <>
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
          </>
        ) : null}
        <button
          className="primary"
          disabled={!canComplete || isCompleted}
          title={canComplete ? "完成并写入固定模拟备注" : "确认晚药后才能完成"}
          onClick={() => dispatch({ type: "COMPLETE_CARE_TASK" })}
        >
          {isCompleted ? "已完成" : "完成并记录"}
        </button>
      </div>
    </article>
  );
};
