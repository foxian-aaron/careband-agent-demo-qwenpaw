import { describe, expect, it, vi } from "vitest";

import {
  completeCareTaskOnBackend,
  isBackendAuthoritativeTaskAction,
} from "../lib/careTaskWorkflow";

describe("backend-authoritative care task workflow", () => {
  it("never allows task mutations to use the local success fallback", () => {
    expect(isBackendAuthoritativeTaskAction("CAREGIVER_ACCEPT_TASK")).toBe(true);
    expect(isBackendAuthoritativeTaskAction("CAREGIVER_MARK_VIEWED")).toBe(true);
    expect(isBackendAuthoritativeTaskAction("COMPLETE_CARE_TASK")).toBe(true);
    expect(isBackendAuthoritativeTaskAction("TRIGGER_SOS")).toBe(false);
  });

  it("resolves the backend task before submitting the completion note", async () => {
    const calls: string[] = [];
    const patchTask = vi.fn(async () => {
      calls.push("patch-resolved");
    });
    const submitEvent = vi.fn(async () => {
      calls.push("post-note");
      throw new Error("dashboard refresh unavailable");
    });

    await expect(
      completeCareTaskOnBackend(
        {
          taskId: "TASK-1",
          elderId: "E001",
          handledBy: "护工A",
          handledNote: "已查看并完成处理",
        },
        { patchTask, submitEvent },
      ),
    ).rejects.toThrow("dashboard refresh unavailable");

    expect(calls).toEqual(["patch-resolved", "post-note"]);
  });
});
