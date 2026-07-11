import { describe, expect, it } from "vitest";

import {
  buildConfirmedCareMemory,
  isMemoryDraftFullyReviewed,
} from "../lib/memoryConfirmation";
import {
  createInitialDemoState,
  demoReducer,
  migratePersistedDemoState,
} from "../store/demoStore";
import type { CareMemoryItem, InitialCareMemory } from "../types";

const item = (
  id: string,
  category: CareMemoryItem["category"],
  confirmationStatus: CareMemoryItem["confirmationStatus"],
  content: string,
): CareMemoryItem => ({
  id,
  elderId: "E001",
  category,
  content,
  sourceType: "family_oral",
  sourceDetail: "family",
  sourceDate: "2026-07-11",
  confidence: 0.8,
  confirmationStatus,
  visibilityScope: ["caregiver"],
  updatedAt: "2026-07-11T08:00:00.000Z",
});

const draft = (items: CareMemoryItem[]): InitialCareMemory => ({
  elderId: "E001",
  summary: "AI draft",
  riskTags: ["unreviewed AI risk tag"],
  communicationPreferences: ["unreviewed preference"],
  medicationNotes: [],
  familyNotificationPreferences: [],
  observationFocus: [],
  missingQuestions: [],
  items,
  createdAt: "2026-07-11T08:00:00.000Z",
  updatedAt: "2026-07-11T08:00:00.000Z",
});

describe("care memory confirmation gate", () => {
  it("does not save while any AI-generated item remains unresolved", () => {
    const pendingDraft = draft([
      item("1", "safety_risk", "confirmed", "夜间离床需关注"),
      item("2", "communication_preference", "pending", "粤语优先"),
    ]);

    expect(isMemoryDraftFullyReviewed(pendingDraft)).toBe(false);
    expect(buildConfirmedCareMemory(pendingDraft)).toBeNull();
  });

  it("keeps only confirmed items and rebuilds aggregates from those items", () => {
    const reviewedDraft = draft([
      item("1", "safety_risk", "confirmed", "夜间离床需关注"),
      item("2", "communication_preference", "confirmed", "粤语优先"),
      item("3", "medication_notes", "rejected", "不可信的用药草稿"),
    ]);

    const saved = buildConfirmedCareMemory(reviewedDraft, "2026-07-11T09:00:00.000Z");

    expect(saved?.items.map((entry) => entry.id)).toEqual(["1", "2"]);
    expect(saved?.riskTags).toEqual(["夜间离床需关注"]);
    expect(saved?.communicationPreferences).toEqual(["粤语优先"]);
    expect(saved?.medicationNotes).toEqual([]);
    expect(saved?.riskTags).not.toContain("unreviewed AI risk tag");
  });

  it("replaces memory-derived risk tags after re-review while preserving profile tags", () => {
    const initial = createInitialDemoState();
    const originalProfileTags = [...initial.profiles.E001.riskTags];
    const memoryRiskTag = "家属补充的夜间离床关注";

    let state = demoReducer(initial, {
      type: "CREATE_MEMORY_DRAFT",
      draft: draft([item("risk-1", "safety_risk", "confirmed", memoryRiskTag)]),
    });
    state = demoReducer(state, {
      type: "SAVE_INITIAL_CARE_MEMORY",
      elderId: "E001",
    });

    expect(state.profiles.E001.riskTags).toEqual(
      expect.arrayContaining([...originalProfileTags, memoryRiskTag]),
    );
    expect(state.profileBaseRiskTagsByElderId.E001).toEqual(originalProfileTags);

    state = demoReducer(state, {
      type: "CONFIRM_MEMORY_ITEM",
      elderId: "E001",
      itemId: "risk-1",
      status: "rejected",
    });
    state = demoReducer(state, {
      type: "SAVE_INITIAL_CARE_MEMORY",
      elderId: "E001",
    });

    expect(state.initialCareMemoryByElderId.E001.riskTags).toEqual([]);
    expect(state.profileBaseRiskTagsByElderId.E001).toEqual(originalProfileTags);
    expect(state.profiles.E001.riskTags).toEqual(originalProfileTags);
    expect(state.profiles.E001.riskTags).not.toContain(memoryRiskTag);
  });

  it("migrates legacy serialized union tags so a rejected memory tag can be removed", () => {
    const elderId = "LEGACY001";
    const originalProfileTag = "原始机构档案标签";
    const legacyMemoryTag = "旧版 AI 夜间风险标签";
    const savedMemory = draft([
      {
        ...item("legacy-risk-1", "safety_risk", "confirmed", legacyMemoryTag),
        elderId,
      },
    ]);
    savedMemory.elderId = elderId;
    savedMemory.riskTags = [legacyMemoryTag];
    savedMemory.summary = "旧版已保存记忆";

    const legacySerializedState = JSON.parse(
      JSON.stringify({
        profiles: {
          [elderId]: {
            elderId,
            name: "旧版迁移测试长者",
            age: 80,
            room: "T01",
            floor: "测试层",
            chronicConditions: [],
            riskTags: [originalProfileTag, legacyMemoryTag],
            caregiverId: "CG-A",
            familyContactId: "FAM-LEGACY001",
            subjectKind: "elder",
          },
        },
        initialCareMemoryByElderId: { [elderId]: savedMemory },
        memoryDraftsByElderId: { [elderId]: savedMemory },
      }),
    );

    let state = migratePersistedDemoState(legacySerializedState);

    expect(state.profileBaseRiskTagsByElderId[elderId]).toEqual([originalProfileTag]);
    expect(state.profiles[elderId].riskTags).toEqual([
      originalProfileTag,
      legacyMemoryTag,
    ]);

    state = demoReducer(state, {
      type: "CONFIRM_MEMORY_ITEM",
      elderId,
      itemId: "legacy-risk-1",
      status: "rejected",
    });
    state = demoReducer(state, {
      type: "SAVE_INITIAL_CARE_MEMORY",
      elderId,
    });

    expect(state.initialCareMemoryByElderId[elderId].riskTags).toEqual([]);
    expect(state.profileBaseRiskTagsByElderId[elderId]).toEqual([originalProfileTag]);
    expect(state.profiles[elderId].riskTags).toEqual([originalProfileTag]);
  });
});
