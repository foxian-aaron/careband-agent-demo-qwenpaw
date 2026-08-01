import type { Dispatch } from "react";
import type { DemoAction, DemoState } from "../store/demoStore";
import {
  getActiveTaskForElder,
  getEventsForElder,
  getRiskForElder,
} from "../store/demoStore";
import { formatClock } from "../lib/dateUtils";
import { deriveCareLoopStatus, deriveDisplayStatus } from "../lib/displayStatus";
import {
  careLoopLabels,
  operationalLabels,
  riskLabels,
  taskStatusLabels,
} from "../lib/statusLabels";

interface DemoControlPanelProps {
  state: DemoState;
  dispatch: Dispatch<DemoAction>;
}

const chenId = "E001";

const getStage = (state: DemoState) => {
  const events = getEventsForElder(state, chenId);
  const task = getActiveTaskForElder(state, chenId);
  const risk = getRiskForElder(state, chenId);
  const careLoopStatus = deriveCareLoopStatus(chenId, state.tasks, events);
  if (risk.riskLevel === "data_insufficient") return "模拟数据不足";
  if (risk.riskLevel === "urgent") return "SOS 紧急测试";
  if (careLoopStatus === "completed") return "处理完成";
  if (careLoopStatus === "medication_confirmed") return "晚药已确认";
  if (careLoopStatus === "checked") return "护工已查看";
  if (task?.status === "in_progress") return "护工已接单";
  if (events.some((event) => event.eventType === "voice_symptom")) return "头晕事件已触发";
  return "初始需关注";
};

const getScript = (stage: string) => {
  if (stage === "初始需关注") {
    return "先展示陈伯虽然没有跌倒，但活动、睡眠和晚药确认都偏离了个人基线，因此系统给出“需关注”。";
  }
  if (stage === "头晕事件已触发") {
    return "现在说明语音反馈进入事件流，规则引擎把陈伯升级为高风险，并为护工生成高优先级任务。";
  }
  if (stage === "护工处理中") {
    return "切到家属端，展示家属看到的是温和的“护工正在查看”，不是复杂医学指标。";
  }
  if (stage === "护工已接单") {
    return "继续点击“标记已查看”，说明接单只是响应，已查看才代表护工到场确认。";
  }
  if (stage === "护工已查看") {
    return "现在点击“确认晚药”，展示用药确认会同步到家属端和长者驾驶舱。";
  }
  if (stage === "晚药已确认") {
    return "最后点击“完成护工处理”，写入备注并同步为已跟进 / 持续观察。";
  }
  if (stage === "处理完成") {
    return "最后回到机构端，展示任务完成后三端同步更新，形成照护闭环。";
  }
  if (stage === "SOS 紧急测试") {
    return "这是备用分支，用于说明 SOS 会绕过普通评分直接进入紧急流程。";
  }
  return "这是备用分支，用于说明数据不足时系统不会做过度判断，而是要求先确认佩戴和同步。";
};

export const DemoControlPanel = ({ state, dispatch }: DemoControlPanelProps) => {
  const risk = getRiskForElder(state, chenId);
  const task = getActiveTaskForElder(state, chenId);
  const events = getEventsForElder(state, chenId);
  const careLoopStatus = deriveCareLoopStatus(chenId, state.tasks, events);
  const displayStatus = deriveDisplayStatus(risk, careLoopStatus);
  const stage = getStage(state);
  const connected = state.backend.mode === "backend";
  const hasVoice = events.some((event) => event.eventType === "voice_symptom");
  const canTriggerDizziness = !connected && !hasVoice;
  const canTriggerSos = !connected || !task;
  const canAccept = Boolean(task && task.status === "pending");
  const canMarkViewed = Boolean(!connected && task && task.status === "in_progress" && careLoopStatus === "in_progress");
  const canConfirmMedication = Boolean(
    !connected && task && task.status === "in_progress" && careLoopStatus === "checked",
  );
  const canComplete = Boolean(
    task &&
      task.status === "in_progress" &&
      (connected || (
        state.snapshots[chenId].medicationEvening === "confirmed" &&
        ["checked", "medication_confirmed"].includes(careLoopStatus)
      )),
  );

  return (
    <section className="demo-control">
      <div className="control-status">
        <div>
          <span>当前 Demo 阶段</span>
          <strong>{stage}</strong>
        </div>
        <div>
          <span>陈伯前台展示状态</span>
          <strong>{displayStatus.label}</strong>
        </div>
        <div>
          <span>陈伯风险等级</span>
          <strong>{riskLabels[risk.riskLevel]}</strong>
        </div>
        <div>
          <span>当前任务状态</span>
          <strong>{task ? taskStatusLabels[task.status] : "暂无任务"}</strong>
        </div>
        <div>
          <span>闭环状态</span>
          <strong>{careLoopLabels[careLoopStatus]}</strong>
          <small>{operationalLabels[state.operationalStates[chenId]]}</small>
        </div>
      </div>
      <div className="control-buttons">
        <button disabled={connected} onClick={() => dispatch({ type: "RESET_DEMO" })}>重置 Demo</button>
        <button
          className="primary"
          disabled={!canTriggerDizziness}
          title={canTriggerDizziness ? "触发语音主诉并创建高优先级任务" : "本轮头晕事件已触发"}
          onClick={() => dispatch({ type: "TRIGGER_CHEN_DIZZINESS" })}
        >
          触发陈伯头晕语音事件
        </button>
        <button
          disabled={!canAccept}
          title={canAccept ? "接单后任务进入处理中" : "需要先触发任务，或当前任务已接单"}
          onClick={() => dispatch({ type: "CAREGIVER_ACCEPT_TASK" })}
        >
          护工接单
        </button>
        {!connected ? (
          <>
            <button
              disabled={!canMarkViewed}
              title={canMarkViewed ? "记录护工到场查看" : "护工接单后才能标记已查看"}
              onClick={() => dispatch({ type: "CAREGIVER_MARK_VIEWED" })}
            >
              标记已查看
            </button>
            <button
              disabled={!canConfirmMedication}
              title={canConfirmMedication ? "确认晚药状态" : "标记已查看后才能确认晚药"}
              onClick={() => dispatch({ type: "CONFIRM_EVENING_MEDICATION" })}
            >
              确认晚药
            </button>
          </>
        ) : null}
        <button
          disabled={!canComplete}
          title={canComplete ? "完成并写入护工备注" : "确认晚药后才能完成处理"}
          onClick={() => dispatch({ type: "COMPLETE_CARE_TASK" })}
        >
          完成护工处理
        </button>
        <button disabled={!canTriggerSos} onClick={() => dispatch({ type: "TRIGGER_SOS" })}>
          触发 SOS 测试
        </button>
        <button disabled={connected} onClick={() => dispatch({ type: "SIMULATE_DATA_GAP" })}>
          模拟数据不足
        </button>
      </div>
      <div className="panel">
        <div className="section-title">
          <span>当前事件列表</span>
          <h2>陈伯 24 小时事件</h2>
        </div>
        <ul className="event-list">
          {events.map((event) => (
            <li key={event.eventId}>
              <time>{formatClock(event.timestamp)}</time>
              <span>{event.title}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="script-card">
        <span>下一步建议演示话术</span>
        <p>{getScript(stage)}</p>
      </div>
    </section>
  );
};
