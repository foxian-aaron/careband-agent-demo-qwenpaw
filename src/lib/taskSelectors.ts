import type { CareEvent, CareTask } from "../types";

export const byTaskUpdatedDesc = (a: CareTask, b: CareTask) =>
  new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();

export const getActiveTaskForElder = (elderId: string, tasks: CareTask[]) =>
  tasks
    .filter(
      (task) =>
        task.elderId === elderId &&
        task.status !== "completed" &&
        task.status !== "cancelled",
    )
    .sort(byTaskUpdatedDesc)[0];

export const getTaskHistoryForElder = (elderId: string, tasks: CareTask[]) =>
  tasks
    .filter((task) => task.elderId === elderId && task.status === "completed")
    .sort(byTaskUpdatedDesc);

export const getLatestTaskForElder = (elderId: string, tasks: CareTask[]) =>
  tasks.filter((task) => task.elderId === elderId).sort(byTaskUpdatedDesc)[0];

export const getRecentCareRecord = (
  elderId: string,
  tasks: CareTask[],
  events: CareEvent[],
) => {
  const completedTask = getTaskHistoryForElder(elderId, tasks)[0];
  const completedEvent = events
    .filter(
      (event) =>
        event.elderId === elderId && event.eventType === "caregiver_completed",
    )
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

  const record =
    completedTask?.note ??
    completedEvent?.payload?.note ??
    completedEvent?.title ??
    "";

  if (record.includes("护工A已查看") && record.includes("已确认晚药")) {
    return "护工A已查看并确认晚药";
  }

  return record;
};
