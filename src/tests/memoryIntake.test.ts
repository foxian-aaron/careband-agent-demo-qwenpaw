import { describe, expect, it } from "vitest";
import {
  buildConfirmedCareMemory,
  createMemoryDraft,
  isMemoryDraftFullyReviewed,
  MAX_MEMORY_DRAFT_ITEMS,
  MAX_MEMORY_INPUT_LENGTH,
  sanitizeConfirmedMemories,
  sanitizeMemoryDrafts,
} from "../lib/memoryIntake";
import {
  createInitialDemoState,
  demoReducer,
  getRiskForElder,
  serializeForStorage,
} from "../store/demoStore";
import type { BackendSyncPayload } from "../types";

const now = "2026-08-02T06:30:00.000Z";

describe("memory intake privacy and confirmation gate", () => {
  it("creates bounded pending summaries without copying the raw input", () => {
    const raw = `PRIVATE-RAW-${"夜间起床、晚药提醒、粤语沟通、家属通知。".repeat(80)}`;
    const draft = createMemoryDraft("E001", raw, "family_oral", now);

    expect(draft.items.length).toBeGreaterThan(0);
    expect(draft.items.length).toBeLessThanOrEqual(MAX_MEMORY_DRAFT_ITEMS);
    expect(draft.items.every((item) => item.reviewStatus === "pending")).toBe(true);
    expect(draft.items.every((item) => item.visibilityScope.join(",") === "caregiver,institution")).toBe(true);
    expect(JSON.stringify(draft)).not.toContain(raw);
    expect(JSON.stringify(draft)).not.toContain("PRIVATE-RAW");
    expect(JSON.stringify(draft)).not.toContain(raw.slice(0, MAX_MEMORY_INPUT_LENGTH));
    expect(raw.length).toBeGreaterThan(MAX_MEMORY_INPUT_LENGTH);
  });

  it("blocks unresolved drafts and keeps only confirmed items", () => {
    const draft = createMemoryDraft("E001", "晚药提醒，夜间起床。", "caregiver_input", now);
    expect(isMemoryDraftFullyReviewed(draft)).toBe(false);
    expect(buildConfirmedCareMemory(draft, now)).toBeNull();

    const reviewed = {
      ...draft,
      items: draft.items.map((item, index) => ({
        ...item,
        reviewStatus: index === 0 ? "confirmed" as const : "rejected" as const,
      })),
    };
    const saved = buildConfirmedCareMemory(reviewed, now);

    expect(saved?.items).toHaveLength(1);
    expect(saved?.items[0].reviewStatus).toBe("confirmed");
    expect(saved?.items[0].visibilityScope).toEqual(["caregiver", "institution"]);
    expect(saved?.items[0].visibilityScope).not.toContain("family");
  });

  it("updates immutably without changing risk authority or profile tags", () => {
    const initial = createInitialDemoState();
    const originalTags = [...initial.profiles.E001.riskTags];
    const originalRisk = getRiskForElder(initial, "E001");
    const draft = createMemoryDraft("E001", "粤语沟通。", "family_oral", now);

    const withDraft = demoReducer(initial, { type: "CREATE_MEMORY_DRAFT", draft });
    expect(withDraft).not.toBe(initial);
    expect(initial.memoryDraftsByElderId).toEqual({});

    const reviewed = demoReducer(withDraft, {
      type: "REVIEW_MEMORY_ITEM",
      elderId: "E001",
      itemId: draft.items[0].id,
      status: "confirmed",
      updatedAt: now,
    });
    const saved = demoReducer(reviewed, {
      type: "SAVE_CARE_MEMORY",
      elderId: "E001",
      confirmedAt: now,
    });

    expect(saved.careMemoriesByElderId.E001.items).toHaveLength(1);
    expect(saved.memoryDraftsByElderId.E001).toBeUndefined();
    expect(saved.profiles.E001.riskTags).toEqual(originalTags);
    expect(getRiskForElder(saved, "E001")).toEqual(originalRisk);
  });

  it("does not save pending drafts and reset clears all memory state", () => {
    const initial = createInitialDemoState();
    const raw = "UNIQUE-RAW-INTAKE-CONTENT";
    const draft = createMemoryDraft("E001", raw, "institution_record", now);
    const withDraft = demoReducer(initial, { type: "CREATE_MEMORY_DRAFT", draft });
    const blocked = demoReducer(withDraft, {
      type: "SAVE_CARE_MEMORY",
      elderId: "E001",
      confirmedAt: now,
    });

    expect(blocked.careMemoriesByElderId).toEqual({});
    expect(JSON.stringify(serializeForStorage(blocked))).not.toContain(raw);

    const reset = demoReducer(blocked, { type: "RESET_DEMO" });
    expect(reset.memoryDraftsByElderId).toEqual({});
    expect(reset.careMemoriesByElderId).toEqual({});
  });

  it("does not mix local Mock memory into a connected backend view", () => {
    const initial = createInitialDemoState();
    const draft = createMemoryDraft("E001", "粤语沟通。", "family_oral", now);
    const withDraft = demoReducer(initial, { type: "CREATE_MEMORY_DRAFT", draft });
    const payload: BackendSyncPayload = {
      generatedAt: now,
      profiles: { E001: initial.profiles.E001 },
      snapshots: { E001: initial.snapshots.E001 },
      events: initial.events.filter((event) => event.elderId === "E001"),
      tasks: initial.tasks.filter((task) => task.elderId === "E001"),
      operationalStates: { E001: initial.operationalStates.E001 },
      riskMap: { E001: getRiskForElder(initial, "E001") },
      operationalSummary: {
        elderCount: 1,
        urgentCount: 0,
        highRiskCount: 0,
        activeTaskCount: 0,
        statusDistribution: {},
      },
    };

    const connected = demoReducer(withDraft, { type: "BACKEND_CONNECTED", payload });
    expect(connected.backend.mode).toBe("backend");
    expect(connected.memoryDraftsByElderId).toEqual({});
    expect(connected.careMemoriesByElderId).toEqual({});
  });

  it("rejects malformed or oversized persisted memory and removes family visibility", () => {
    const draft = createMemoryDraft("E001", "粤语沟通。", "family_oral", now);
    const malformed = { E001: { ...draft, items: null } };
    const oversized = {
      E001: {
        ...draft,
        items: [{ ...draft.items[0], content: "x".repeat(241) }],
      },
    };
    expect(sanitizeMemoryDrafts(malformed)).toEqual({});
    expect(sanitizeMemoryDrafts(oversized)).toEqual({});

    const rawInjection = {
      E001: {
        ...draft,
        items: [{ ...draft.items[0], content: "PRIVATE SHORT RAW INTAKE" }],
      },
    };
    expect(sanitizeMemoryDrafts(rawInjection)).toEqual({});
    const initial = createInitialDemoState();
    const rejectedAction = demoReducer(initial, {
      type: "CREATE_MEMORY_DRAFT",
      draft: rawInjection.E001,
    });
    expect(rejectedAction).toBe(initial);

    const preconfirmed = {
      ...draft,
      items: draft.items.map((item) => ({
        ...item,
        reviewStatus: "confirmed" as const,
      })),
    };
    expect(demoReducer(initial, {
      type: "CREATE_MEMORY_DRAFT",
      draft: preconfirmed,
    })).toBe(initial);

    const reviewed = {
      ...draft,
      items: [{
        ...draft.items[0],
        reviewStatus: "confirmed" as const,
        visibilityScope: ["family" as const],
      }],
    };
    const confirmed = buildConfirmedCareMemory(reviewed, now);
    const sanitized = sanitizeConfirmedMemories({ E001: confirmed });
    expect(sanitized.E001.items[0].visibilityScope).toEqual(["caregiver", "institution"]);
  });
});
