import type { BackendEventInput, BackendTaskPatch } from "./apiClient";

export const backendAuthoritativeTaskActions = [
  "CAREGIVER_ACCEPT_TASK",
  "CAREGIVER_MARK_VIEWED",
  "COMPLETE_CARE_TASK",
] as const;

export const isBackendAuthoritativeTaskAction = (actionType: string) =>
  backendAuthoritativeTaskActions.some((candidate) => candidate === actionType);

interface CompleteCareTaskInput {
  taskId: string;
  elderId: string;
  handledBy: string;
  handledNote: string;
}

interface CompleteCareTaskDependencies {
  patchTask: (taskId: string, changes: BackendTaskPatch) => Promise<unknown>;
  submitEvent: (event: BackendEventInput) => Promise<unknown>;
}

export const completeCareTaskOnBackend = async (
  input: CompleteCareTaskInput,
  dependencies: CompleteCareTaskDependencies,
) => {
  // The task state is authoritative. Resolve it before posting the lifecycle note so
  // a refresh failure can never leave the backend active while the UI falls back to done.
  await dependencies.patchTask(input.taskId, {
    status: "resolved",
    handled_by: input.handledBy,
    handled_note: input.handledNote,
  });
  await dependencies.submitEvent({
    elder_id: input.elderId,
    event_type: "manual_note",
    source: "dashboard",
    raw_text: input.handledNote,
    payload: { action: "caregiver_completed", note: input.handledNote },
  });
};
