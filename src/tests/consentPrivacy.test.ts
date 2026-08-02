import { describe, expect, it } from "vitest";
import {
  getVoiceMemoryReviewStatus,
  isVoiceMemoryFamilyVisible,
  sanitizeFamilyConsentMap,
  sanitizeVoiceReviewMap,
  selectFamilyVoiceMemorySummaries,
} from "../lib/consentPrivacy";
import { analyzeElderVoiceCompanion } from "../lib/elderVoiceCompanion";
import { deriveCareLoopStatus, deriveDisplayStatus } from "../lib/displayStatus";
import { buildFamilyStatusMessage } from "../lib/familyCopy";
import {
  createInitialDemoState,
  demoReducer as reduceDemo,
  grantFamilyConsentByCaregiver,
  getActiveTaskForElder,
  getEventsForElder,
  getFamilyVoiceMemorySummaries,
  getRiskForElder,
  loadInitialState,
  reviewVoiceDraftByCaregiver,
  revokeFamilyConsentByCaregiver,
  serializeForStorage,
} from "../store/demoStore";
import type {
  BackendSyncPayload,
  ConsentStatus,
  VoiceMemoryDraft,
} from "../types";

const now = "2026-08-02T06:30:00.000Z";

// Positive cases use the same dedicated caregiver gateway as the UI.
// Negative actor coverage calls reduceDemo directly so the gateway cannot mask it.
const demoReducer = (
  state: ReturnType<typeof createInitialDemoState>,
  action: Record<string, unknown>,
) => {
  if (action.type === "GRANT_FAMILY_CONSENT") {
    return reduceDemo(state, grantFamilyConsentByCaregiver(String(action.elderId)));
  }
  if (action.type === "REVOKE_FAMILY_CONSENT") {
    return reduceDemo(state, revokeFamilyConsentByCaregiver(String(action.elderId)));
  }
  if (action.type === "REVIEW_VOICE_DRAFT") {
    return reduceDemo(state, reviewVoiceDraftByCaregiver(
      String(action.elderId),
      String(action.draftId),
      action.decision as "confirmed" | "rejected",
    ));
  }
  return reduceDemo(state, action as never);
};

const makeConsent = (overrides: Partial<ConsentStatus> = {}): ConsentStatus => ({
  elderId: "E001",
  familyCanViewDailyStatus: true,
  familyCanViewMedicationStatus: true,
  familyCanViewLocationZone: true,
  familyCanViewVoiceSummary: true,
  doctorSummaryRequiresApproval: true,
  locationPrecision: "zone_only",
  voiceRawTextPolicy: "summary_only",
  updatedAt: "2026-06-10T09:00:00+08:00",
  ...overrides,
});

const makeDraft = (overrides: Partial<VoiceMemoryDraft> = {}): VoiceMemoryDraft => ({
  id: "VOICE-MEMORY-E001-20260802063000000-1",
  elderId: "E001",
  memoryType: "past_story",
  contentSummary: "提到一段过去经历，具体内容需由护工人工确认。",
  confidence: 0.82,
  reviewStatus: "pending",
  visibility: "family_summary",
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

describe("consent privacy — triple gate logic", () => {
  const familySummaryDraft = makeDraft();
  const caregiverOnlyDraft = makeDraft({
    id: "VOICE-MEMORY-E001-20260802063000000-2",
    memoryType: "daily_rhythm",
    contentSummary: "在当前时段表达孤独或想找人说话，适合巡查时主动关心。",
    confidence: 0.72,
    visibility: "caregiver_only",
  });

  it("is visible only when authorized + confirmed + family_summary + consent field", () => {
    expect(
      isVoiceMemoryFamilyVisible(makeConsent(), familySummaryDraft, true, "confirmed"),
    ).toBe(true);
  });

  it("is hidden when pending (no caregiver review)", () => {
    expect(
      isVoiceMemoryFamilyVisible(makeConsent(), familySummaryDraft, true, undefined),
    ).toBe(false);
    expect(
      isVoiceMemoryFamilyVisible(makeConsent(), familySummaryDraft, true, "pending" as never),
    ).toBe(false);
  });

  it("is hidden when rejected", () => {
    expect(
      isVoiceMemoryFamilyVisible(makeConsent(), familySummaryDraft, true, "rejected"),
    ).toBe(false);
  });

  it("is hidden when visibility is caregiver_only even if confirmed+authorized", () => {
    expect(
      isVoiceMemoryFamilyVisible(makeConsent(), caregiverOnlyDraft, true, "confirmed"),
    ).toBe(false);
  });

  it("is hidden when not authorized even if confirmed + family_summary", () => {
    expect(
      isVoiceMemoryFamilyVisible(makeConsent(), familySummaryDraft, false, "confirmed"),
    ).toBe(false);
  });

  it("is hidden when consent field familyCanViewVoiceSummary is false", () => {
    expect(
      isVoiceMemoryFamilyVisible(
        makeConsent({ familyCanViewVoiceSummary: false }),
        familySummaryDraft,
        true,
        "confirmed",
      ),
    ).toBe(false);
  });

  it("is hidden when consent is undefined (fail closed)", () => {
    expect(
      isVoiceMemoryFamilyVisible(undefined, familySummaryDraft, true, "confirmed"),
    ).toBe(false);
  });

  it("selectFamilyVoiceMemorySummaries returns only fixed summary strings", () => {
    const summaries = selectFamilyVoiceMemorySummaries(
      makeConsent(),
      [familySummaryDraft, caregiverOnlyDraft],
      { [familySummaryDraft.id]: "confirmed" },
      true,
    );
    expect(summaries).toEqual([familySummaryDraft.contentSummary]);
    expect(summaries.some((s) => s.includes("confidence"))).toBe(false);
    // never leaks confidence or raw id
    expect(JSON.stringify(summaries)).not.toContain("0.82");
    expect(JSON.stringify(summaries)).not.toContain(familySummaryDraft.id);
  });

  it("getVoiceMemoryReviewStatus defaults to pending", () => {
    expect(getVoiceMemoryReviewStatus({}, "missing")).toBe("pending");
    expect(getVoiceMemoryReviewStatus({ x: "confirmed" }, "x")).toBe("confirmed");
    expect(getVoiceMemoryReviewStatus({ x: "rejected" }, "x")).toBe("rejected");
  });
});

describe("consent privacy — store session state", () => {
  it("rejects authorization writes from a family actor", () => {
    const initial = createInitialDemoState();
    const attempted = reduceDemo(initial, {
      type: "GRANT_FAMILY_CONSENT",
      elderId: "E001",
      actorRole: "family",
    } as never);
    expect(attempted).toBe(initial);
  });
  const addDrafts = (state: ReturnType<typeof createInitialDemoState>) => {
    const result = analyzeElderVoiceCompanion({
      elderId: "E001",
      rawText: "我年轻时在码头工作，我喜欢钓鱼",
      timestamp: now,
    });
    return demoReducer(state, {
      type: "ADD_VOICE_COMPANION_RESULT",
      elderId: "E001",
      signal: result.signal,
      memoryDrafts: result.memoryDrafts,
    });
  };

  const familySummaryDraftId = (state: ReturnType<typeof createInitialDemoState>) => {
    const drafts = state.voiceMemoryDraftsByElderId.E001 ?? [];
    return drafts.find((d) => d.visibility === "family_summary")?.id ?? "";
  };

  it("grant + confirm reveals the summary via the store selector", () => {
    const withDrafts = addDrafts(createInitialDemoState());
    const draftId = familySummaryDraftId(withDrafts);
    expect(draftId).not.toBe("");

    const granted = demoReducer(withDrafts, { type: "GRANT_FAMILY_CONSENT", elderId: "E001" });
    const confirmed = demoReducer(granted, {
      type: "REVIEW_VOICE_DRAFT",
      elderId: "E001",
      draftId,
      decision: "confirmed",
    });

    const summaries = getFamilyVoiceMemorySummaries(confirmed, "E001");
    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries.every((s) => typeof s === "string")).toBe(true);
  });

  it("without authorization the summary stays hidden even when confirmed", () => {
    const withDrafts = addDrafts(createInitialDemoState());
    const draftId = familySummaryDraftId(withDrafts);
    const confirmed = demoReducer(withDrafts, {
      type: "REVIEW_VOICE_DRAFT",
      elderId: "E001",
      draftId,
      decision: "confirmed",
    });
    expect(getFamilyVoiceMemorySummaries(confirmed, "E001")).toEqual([]);
  });

  it("revoke immediately hides an already-revealed summary", () => {
    const withDrafts = addDrafts(createInitialDemoState());
    const draftId = familySummaryDraftId(withDrafts);
    const granted = demoReducer(withDrafts, { type: "GRANT_FAMILY_CONSENT", elderId: "E001" });
    const confirmed = demoReducer(granted, {
      type: "REVIEW_VOICE_DRAFT",
      elderId: "E001",
      draftId,
      decision: "confirmed",
    });
    expect(getFamilyVoiceMemorySummaries(confirmed, "E001").length).toBeGreaterThan(0);

    const revoked = demoReducer(confirmed, { type: "REVOKE_FAMILY_CONSENT", elderId: "E001" });
    expect(getFamilyVoiceMemorySummaries(revoked, "E001")).toEqual([]);
    expect(revoked.familyConsentByElderId.E001).toBeUndefined();
  });

  it("rejected draft is never visible to family", () => {
    const withDrafts = addDrafts(createInitialDemoState());
    const draftId = familySummaryDraftId(withDrafts);
    const granted = demoReducer(withDrafts, { type: "GRANT_FAMILY_CONSENT", elderId: "E001" });
    const rejected = demoReducer(granted, {
      type: "REVIEW_VOICE_DRAFT",
      elderId: "E001",
      draftId,
      decision: "rejected",
    });
    expect(getFamilyVoiceMemorySummaries(rejected, "E001")).toEqual([]);
  });

  it("E002 (voice consent denied) never reveals even when granted+confirmed", () => {
    const result = analyzeElderVoiceCompanion({
      elderId: "E002",
      rawText: "我年轻时在码头工作",
      timestamp: now,
    });
    const withDrafts = demoReducer(createInitialDemoState(), {
      type: "ADD_VOICE_COMPANION_RESULT",
      elderId: "E002",
      signal: result.signal,
      memoryDrafts: result.memoryDrafts,
    });
    const draftId = withDrafts.voiceMemoryDraftsByElderId.E002?.[0]?.id ?? "";
    const granted = demoReducer(withDrafts, { type: "GRANT_FAMILY_CONSENT", elderId: "E002" });
    const confirmed = demoReducer(granted, {
      type: "REVIEW_VOICE_DRAFT",
      elderId: "E002",
      draftId,
      decision: "confirmed",
    });
    expect(getFamilyVoiceMemorySummaries(confirmed, "E002")).toEqual([]);
  });

  it("grant/review do not change risk level or produce events", () => {
    const withDrafts = addDrafts(createInitialDemoState());
    const draftId = familySummaryDraftId(withDrafts);
    const originalRisk = getRiskForElder(withDrafts, "E001");
    const originalEventCount = withDrafts.events.length;

    const granted = demoReducer(withDrafts, { type: "GRANT_FAMILY_CONSENT", elderId: "E001" });
    const confirmed = demoReducer(granted, {
      type: "REVIEW_VOICE_DRAFT",
      elderId: "E001",
      draftId,
      decision: "confirmed",
    });

    expect(getRiskForElder(confirmed, "E001")).toEqual(originalRisk);
    expect(confirmed.events.length).toBe(originalEventCount);
  });

  it("RESET clears all session authorization and review", () => {
    const withDrafts = addDrafts(createInitialDemoState());
    const draftId = familySummaryDraftId(withDrafts);
    const granted = demoReducer(withDrafts, { type: "GRANT_FAMILY_CONSENT", elderId: "E001" });
    const confirmed = demoReducer(granted, {
      type: "REVIEW_VOICE_DRAFT",
      elderId: "E001",
      draftId,
      decision: "confirmed",
    });

    const reset = demoReducer(confirmed, { type: "RESET_DEMO" });
    expect(reset.familyConsentByElderId).toEqual({});
    expect(reset.voiceReviewByElderId).toEqual({});
    expect(getFamilyVoiceMemorySummaries(reset, "E001")).toEqual([]);
  });

  it("connected hydration clears session authorization and review", () => {
    const withDrafts = addDrafts(createInitialDemoState());
    const draftId = familySummaryDraftId(withDrafts);
    const granted = demoReducer(withDrafts, { type: "GRANT_FAMILY_CONSENT", elderId: "E001" });
    const confirmed = demoReducer(granted, {
      type: "REVIEW_VOICE_DRAFT",
      elderId: "E001",
      draftId,
      decision: "confirmed",
    });

    const initial = createInitialDemoState();
    const payload: BackendSyncPayload = {
      generatedAt: now,
      profiles: { E001: initial.profiles.E001 },
      snapshots: { E001: initial.snapshots.E001 },
      events: initial.events.filter((e) => e.elderId === "E001"),
      tasks: initial.tasks.filter((t) => t.elderId === "E001"),
      operationalStates: { E001: initial.operationalStates.E001 },
      riskMap: { E001: getRiskForElder(initial, "E001") },
      operationalSummary: {
        elderCount: 1, urgentCount: 0, highRiskCount: 0, activeTaskCount: 0, statusDistribution: {},
      },
    };
    const connected = demoReducer(confirmed, { type: "BACKEND_CONNECTED", payload });
    expect(connected.backend.mode).toBe("backend");
    expect(connected.familyConsentByElderId).toEqual({});
    expect(connected.voiceReviewByElderId).toEqual({});
  });

  it("connected mode blocks local authorization/review writes without faking success", () => {
    const initial = createInitialDemoState();
    const payload: BackendSyncPayload = {
      generatedAt: now,
      profiles: { E001: initial.profiles.E001 },
      snapshots: { E001: initial.snapshots.E001 },
      events: [], tasks: [], operationalStates: { E001: initial.operationalStates.E001 },
      riskMap: { E001: getRiskForElder(initial, "E001") },
      operationalSummary: {
        elderCount: 1, urgentCount: 0, highRiskCount: 0, activeTaskCount: 0, statusDistribution: {},
      },
    };
    const connected = demoReducer(initial, { type: "BACKEND_CONNECTED", payload });

    const granted = demoReducer(connected, { type: "GRANT_FAMILY_CONSENT", elderId: "E001" });
    expect(granted.familyConsentByElderId).toEqual({});
    expect(granted.backend.readOnlyNotice).toBeTruthy();

    const reviewed = demoReducer(connected, {
      type: "REVIEW_VOICE_DRAFT", elderId: "E001", draftId: "x", decision: "confirmed",
    });
    expect(reviewed.voiceReviewByElderId).toEqual({});
    expect(reviewed.backend.readOnlyNotice).toBeTruthy();
  });
});

describe("consent privacy — persistence boundaries", () => {
  it("serializeForStorage never writes session authorization or review", () => {
    const state = demoReducer(createInitialDemoState(), {
      type: "GRANT_FAMILY_CONSENT", elderId: "E001",
    });
    const serialized = serializeForStorage(state);
    const json = JSON.stringify(serialized);
    expect(json).not.toContain("familyConsentByElderId");
    expect(json).not.toContain("voiceReviewByElderId");
  });

  it("loadInitialState drops any injected session consent/review from storage", () => {
    const injected = createInitialDemoState();
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: () => JSON.stringify({
            ...injected,
            profiles: {
              ...injected.profiles,
              UNKNOWN: { ...injected.profiles.E001, elderId: "UNKNOWN" },
            },
            profileDetails: {
              ...injected.profileDetails,
              E002: {
                ...injected.profileDetails.E002,
                consentStatus: {
                  ...injected.profileDetails.E002.consentStatus,
                  familyCanViewVoiceSummary: true,
                },
              },
            },
            familyConsentByElderId: { E001: true, E002: true },
            voiceReviewByElderId: { E001: { "VOICE-MEMORY-E001-x": "confirmed" } },
          }),
        },
      },
    });
    try {
      const loaded = loadInitialState();
      expect(loaded.familyConsentByElderId).toEqual({});
      expect(loaded.voiceReviewByElderId).toEqual({});
      expect(loaded.profiles.UNKNOWN).toBeUndefined();
      expect(loaded.profileDetails.E002.consentStatus.familyCanViewVoiceSummary).toBe(false);
    } finally {
      if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });

  it("sanitizers always return empty maps for any input", () => {
    expect(sanitizeFamilyConsentMap({ E001: true })).toEqual({});
    expect(sanitizeVoiceReviewMap({ E001: { x: "confirmed" } })).toEqual({});
    expect(sanitizeFamilyConsentMap(null)).toEqual({});
    expect(sanitizeVoiceReviewMap("forged")).toEqual({});
  });
});

describe("consent privacy — family copy", () => {
  it("never copies a raw voice transcript into family-facing status text", () => {
    const state = demoReducer(createInitialDemoState(), { type: "TRIGGER_CHEN_DIZZINESS" });
    const profile = state.profiles.E001;
    const risk = getRiskForElder(state, "E001");
    const events = getEventsForElder(state, "E001");
    const loop = deriveCareLoopStatus("E001", state.tasks, events);
    const display = deriveDisplayStatus(risk, loop);
    const message = buildFamilyStatusMessage(
      profile,
      risk,
      display,
      state.snapshots.E001,
      getActiveTaskForElder(state, "E001"),
      loop,
      true,
    );
    expect(message).not.toContain("我有点头晕");
    expect(message).not.toContain("头晕");
  });
});
