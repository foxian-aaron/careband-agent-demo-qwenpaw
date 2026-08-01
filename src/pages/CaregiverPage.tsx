import { CareTaskCard } from "../components/CareTaskCard";
import { ElderSummaryCard } from "../components/ElderSummaryCard";
import { EmptyState } from "../components/EmptyState";
import { MedicalDisclaimer } from "../components/MedicalDisclaimer";
import { Timeline } from "../components/Timeline";
import { deriveCareLoopStatus, deriveDisplayStatus } from "../lib/displayStatus";
import {
  getEventsForElder,
  getActiveTaskForElder,
  getRiskForElder,
  useDemo,
} from "../store/demoStore";

const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };

export const CaregiverPage = () => {
  const { state, dispatch } = useDemo();
  const tasks = state.tasks
    .filter((task) => task.status !== "completed")
    .sort(
    (a, b) => priorityOrder[b.priority] - priorityOrder[a.priority],
  );
  const historyTasks = state.tasks
    .filter((task) => task.status === "completed")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const profiles = Object.values(state.profiles);
  const highRiskProfiles = profiles.filter((profile) =>
    ["urgent", "high_risk"].includes(getRiskForElder(state, profile.elderId).riskLevel),
  );
  const attentionProfiles = profiles.filter(
    (profile) => getRiskForElder(state, profile.elderId).riskLevel === "attention",
  );
  const operationEvents = state.events.filter((event) =>
    ["caregiver_accepted", "caregiver_checked", "caregiver_completed", "medication_confirmed", "system_risk_update", "voice_symptom"].includes(
      event.eventType,
    ),
  );

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span>护工端</span>
          <h1>今日待办与优先处理</h1>
          <p>打开页面后先看高优先级任务，再看需关注长者。</p>
        </div>
      </header>

      <section className="panel">
        <div className="section-title">
          <span>今日待办列表</span>
          <h2>按优先级排序</h2>
        </div>
        <div className="task-list">
          {tasks.length ? (
            tasks.map((task) => (
              (() => {
                const events = getEventsForElder(state, task.elderId);
                const risk = getRiskForElder(state, task.elderId);
                return (
                  <CareTaskCard
                    careLoopStatus={deriveCareLoopStatus(task.elderId, state.tasks, events)}
                    connected={state.backend.mode === "backend"}
                    dispatch={dispatch}
                    events={events}
                    key={task.taskId}
                    medicationEvening={state.snapshots[task.elderId].medicationEvening}
                    profile={state.profiles[task.elderId]}
                    risk={risk}
                    task={task}
                  />
                );
              })()
            ))
          ) : (
            <EmptyState title="暂无待办" description="当前没有需要护工处理的任务。" />
          )}
        </div>
      </section>

      <section className="two-column">
        <article className="panel">
          <div className="section-title">
            <span>高风险老人卡片</span>
            <h2>优先查看</h2>
          </div>
          <div className="card-stack">
            {highRiskProfiles.length ? (
              highRiskProfiles.map((profile) => (
                (() => {
                  const events = getEventsForElder(state, profile.elderId);
                  const risk = getRiskForElder(state, profile.elderId);
                  const careLoopStatus = deriveCareLoopStatus(profile.elderId, state.tasks, events);
                  return (
                    <ElderSummaryCard
                      careLoopStatus={careLoopStatus}
                      displayStatus={deriveDisplayStatus(risk, careLoopStatus)}
                      key={profile.elderId}
                      operationalState={state.operationalStates[profile.elderId] ?? "normal"}
                      profile={profile}
                      risk={risk}
                      task={getActiveTaskForElder(state, profile.elderId)}
                    />
                  );
                })()
              ))
            ) : (
              <EmptyState title="暂无高风险" description="当前没有高风险待处理长者。" />
            )}
          </div>
        </article>
        <article className="panel">
          <div className="section-title">
            <span>需关注老人卡片</span>
            <h2>巡查关注</h2>
          </div>
          <div className="card-stack">
            {attentionProfiles.map((profile) => (
              (() => {
                const events = getEventsForElder(state, profile.elderId);
                const risk = getRiskForElder(state, profile.elderId);
                const careLoopStatus = deriveCareLoopStatus(profile.elderId, state.tasks, events);
                return (
                  <ElderSummaryCard
                    careLoopStatus={careLoopStatus}
                    displayStatus={deriveDisplayStatus(risk, careLoopStatus)}
                    key={profile.elderId}
                    operationalState={state.operationalStates[profile.elderId] ?? "normal"}
                    profile={profile}
                    risk={risk}
                    task={getActiveTaskForElder(state, profile.elderId)}
                  />
                );
              })()
            ))}
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="section-title">
          <span>历史处理记录</span>
          <h2>已完成任务</h2>
        </div>
        <div className="task-list task-list--history">
          {historyTasks.length ? (
            historyTasks.map((task) => {
              const events = getEventsForElder(state, task.elderId);
              const risk = getRiskForElder(state, task.elderId);
              return (
                <CareTaskCard
                  careLoopStatus={deriveCareLoopStatus(task.elderId, state.tasks, events)}
                  connected={state.backend.mode === "backend"}
                  dispatch={dispatch}
                  events={events}
                  key={task.taskId}
                  medicationEvening={state.snapshots[task.elderId].medicationEvening}
                  profile={state.profiles[task.elderId]}
                  risk={risk}
                  task={task}
                />
              );
            })
          ) : (
            <EmptyState title="暂无历史记录" description="完成任务后会在这里保留处理记录。" />
          )}
        </div>
      </section>

      <section className="panel">
        <div className="section-title">
          <span>操作记录时间线</span>
          <h2>护工与系统记录</h2>
        </div>
        <Timeline events={operationEvents} compact />
      </section>
      <MedicalDisclaimer />
    </div>
  );
};
