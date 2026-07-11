import { describe, expect, it } from "vitest";
import type { BackendTask } from "../lib/apiClient";
import { deriveCareLoopStatus } from "../lib/displayStatus";
import { mapBackendTask } from "../store/demoStore";

const cancelledBackendTask: BackendTask = {
  task_id: "TASK-CANCELLED",
  elder_id: "E001",
  source_event_id: "EVT-OPEN",
  priority: "urgent",
  task_title: "Cancelled urgent task",
  task_reason: "SOS",
  recommended_action: "Check immediately",
  status: "cancelled",
  handled_by: "护工A",
  handled_note: "Cancelled without resolution",
  created_at: "2026-07-11T10:00:00.000Z",
  completed_at: "2026-07-11T10:05:00.000Z",
};

describe("canonical backend task status mapping", () => {
  it("keeps cancelled distinct from completed and does not report a closed care loop", () => {
    const task = mapBackendTask(cancelledBackendTask);
    const careLoop = deriveCareLoopStatus("E001", [task], [
      {
        eventId: "EVT-OPEN",
        elderId: "E001",
        eventType: "sos_long_press",
        timestamp: "2026-07-11T10:00:00.000Z",
        title: "SOS",
        source: "hardware_simulator",
        status: "open",
        linkedTaskId: "TASK-CANCELLED",
      },
    ]);

    expect(task.status).toBe("cancelled");
    expect(careLoop).toBe("none");
  });

  it("projects the current Agent output source onto backend task cards", () => {
    const task = mapBackendTask(
      { ...cancelledBackendTask, status: "open" },
      "qwenpaw",
    );

    expect(task.agentSummarySource).toBe("qwenpaw");
  });
});
