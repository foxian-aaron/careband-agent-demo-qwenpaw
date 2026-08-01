import { describe, expect, it } from "vitest";
import {
  analyzeElderVoiceCompanion,
  appendVoiceSessionExchange,
  sanitizeVoiceDraftsByElder,
  sanitizeVoiceSignalsByElder,
} from "../lib/elderVoiceCompanion";
import { createInitialDemoState, demoReducer, getRiskForElder, loadInitialState, serializeForStorage } from "../store/demoStore";

const analyze = (rawText: string) => analyzeElderVoiceCompanion({
  elderId: "E001",
  rawText,
  timestamp: "2026-08-02T10:00:00.123Z",
  context: { medicationEvening: "not_confirmed", locationZone: "二楼活动区" },
});
const knownElders = new Set(["E001", "E002", "E003", "E004"]);

describe("elder voice companion", () => {
  it("classifies all eight bounded intents", () => {
    expect(analyze("今天想聊聊天").signal.detectedIntent).toBe("companionship");
    expect(analyze("我有点头晕").signal.detectedIntent).toBe("symptom_report");
    expect(analyze("我今天吃药了吗").signal.detectedIntent).toBe("medication_question");
    expect(analyze("我年轻时在码头工作").signal.detectedIntent).toBe("past_memory");
    expect(analyze("我有点寂寞").signal.detectedIntent).toBe("loneliness_expression");
    expect(analyze("我不知道在哪里").signal.detectedIntent).toBe("location_confusion");
    expect(analyze("我想找护工").signal.detectedIntent).toBe("caregiver_request");
    expect(analyze("今天天气不错").signal.detectedIntent).toBe("general");
  });

  it("returns only safe summaries and pending drafts", () => {
    const rawText = "我年轻时在码头工作，这是只应留在页面的原话";
    const result = analyze(rawText);
    expect(JSON.stringify(result)).not.toContain(rawText);
    expect(result.signal.retentionPolicy).toBe("summary_only");
    expect(result.signal).not.toHaveProperty("riskLevel");
    expect(result.memoryDrafts.every((draft) => draft.reviewStatus === "pending")).toBe(true);
  });

  it("keeps emergency expressions as review signals instead of risk decisions", () => {
    const result = analyze("救命，我很痛");
    expect(result.signal.attentionLevel).toBe("immediate_review");
    expect(result.signal.shouldNotifyCaregiver).toBe(true);
    expect(result.signal).not.toHaveProperty("riskScore");
    expect(result.signal).not.toHaveProperty("recommendedAction");
  });

  it("bounds input and does not repeat raw medication or location text", () => {
    const long = `${"普通表达".repeat(200)}敏感尾部`;
    const general = analyze(long);
    expect(JSON.stringify(general)).not.toContain("敏感尾部");
    expect(analyze("我的药是什么").assistantReply).toContain("不会解释药理");
    const location = analyze("我不知道在哪里");
    expect(location.assistantReply).toContain("二楼活动区");
    expect(location.assistantReply).not.toMatch(/坐标|经度|纬度|轨迹/);
    const preciseLocation = analyzeElderVoiceCompanion({
      elderId: "E001",
      rawText: "我不知道在哪里",
      context: { locationZone: "北京市海淀区颐和园东门" },
    });
    expect(preciseLocation.assistantReply).not.toContain("北京市海淀区颐和园东门");
    const unknownMedication = analyzeElderVoiceCompanion({ elderId: "E001", rawText: "我今天吃药了吗" });
    expect(unknownMedication.assistantReply).toContain("暂无可核对的晚药记录");
    expect(unknownMedication.assistantReply).not.toContain("尚未确认");
  });

  it("keeps only the latest twenty page-session messages", () => {
    let messages: ReturnType<typeof appendVoiceSessionExchange> = [];
    for (let index = 0; index < 11; index += 1) {
      messages = appendVoiceSessionExchange(messages, `elder-${index}`, `assistant-${index}`, String(index));
    }
    expect(messages).toHaveLength(20);
    expect(messages.some((message) => message.text === "elder-0")).toBe(false);
    expect(messages[messages.length - 1]?.text).toBe("assistant-10");
  });

  it("stores sanitized summaries without changing rule-owned risk", () => {
    const initial = createInitialDemoState();
    const risk = getRiskForElder(initial, "E001");
    const rawText = "我年轻时在码头工作";
    const result = analyze(rawText);
    const next = demoReducer(initial, {
      type: "ADD_VOICE_COMPANION_RESULT",
      elderId: "E001",
      signal: result.signal,
      memoryDrafts: result.memoryDrafts,
    });
    expect(next.voiceSignalsByElderId.E001).toHaveLength(1);
    expect(next.voiceMemoryDraftsByElderId.E001[0].reviewStatus).toBe("pending");
    expect(JSON.stringify(serializeForStorage(next))).not.toContain(rawText);
    expect(getRiskForElder(next, "E001")).toEqual(risk);
  });

  it("fails closed for injected hydration data and preconfirmed drafts", () => {
    const valid = analyze("我年轻时在码头工作");
    expect(sanitizeVoiceSignalsByElder({ E001: [{ ...valid.signal, transcriptSummary: "任意原话" }] }, knownElders)).toEqual({});
    expect(sanitizeVoiceSignalsByElder({ E001: [{ ...valid.signal, shouldNotifyCaregiver: true }] }, knownElders)).toEqual({});
    expect(sanitizeVoiceSignalsByElder({ E001: [{ ...valid.signal, rawText: "原始语音" }] }, knownElders)).toEqual({});
    expect(sanitizeVoiceSignalsByElder({ UNKNOWN: [valid.signal] }, knownElders)).toEqual({});
    expect(sanitizeVoiceDraftsByElder({ E001: [{ ...valid.memoryDrafts[0], reviewStatus: "confirmed", contentSummary: "任意原话" }] }, knownElders)).toEqual({});
    expect(sanitizeVoiceDraftsByElder({ E001: [{ ...valid.memoryDrafts[0], rawText: "原始语音" }] }, knownElders)).toEqual({});
    expect(sanitizeVoiceDraftsByElder({ E001: [{ ...valid.memoryDrafts[0], visibility: "caregiver_only" }] }, knownElders)).toEqual({});
    expect(sanitizeVoiceDraftsByElder({ UNKNOWN: valid.memoryDrafts }, knownElders)).toEqual({});

    const initial = createInitialDemoState();
    const injected = demoReducer(initial, {
      type: "ADD_VOICE_COMPANION_RESULT",
      elderId: "E001",
      signal: { ...valid.signal, riskScore: 100, rawText: "原始语音" } as never,
      memoryDrafts: valid.memoryDrafts,
    });
    expect(injected).toBe(initial);
  });

  it("uses canonical elder IDs when hydrating localStorage", () => {
    const valid = analyze("我年轻时在码头工作");
    const initial = createInitialDemoState();
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: () => JSON.stringify({
            profiles: { ...initial.profiles, UNKNOWN: initial.profiles.E001 },
            voiceSignalsByElderId: { UNKNOWN: [{ ...valid.signal, elderId: "UNKNOWN", signalId: valid.signal.signalId.replace("E001", "UNKNOWN") }] },
            voiceMemoryDraftsByElderId: { UNKNOWN: valid.memoryDrafts.map((draft) => ({
              ...draft,
              elderId: "UNKNOWN",
              id: draft.id.replace("E001", "UNKNOWN"),
            })) },
          }),
        },
      },
    });
    try {
      const hydrated = loadInitialState();
      expect(hydrated.voiceSignalsByElderId).toEqual({});
      expect(hydrated.voiceMemoryDraftsByElderId).toEqual({});
    } finally {
      if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });

  it("clears voice state on reset and connected hydration", () => {
    const result = analyze("我有点寂寞");
    const withVoice = demoReducer(createInitialDemoState(), {
      type: "ADD_VOICE_COMPANION_RESULT",
      elderId: "E001",
      signal: result.signal,
      memoryDrafts: result.memoryDrafts,
    });
    expect(demoReducer(withVoice, { type: "RESET_DEMO" }).voiceSignalsByElderId).toEqual({});
    const connected = demoReducer(withVoice, {
      type: "BACKEND_CONNECTED",
      payload: {
        generatedAt: "2026-08-02T10:00:00.000Z",
        profiles: withVoice.profiles,
        snapshots: withVoice.snapshots,
        events: withVoice.events,
        tasks: withVoice.tasks,
        operationalStates: withVoice.operationalStates,
        riskMap: {},
        operationalSummary: { elderCount: 4, urgentCount: 0, highRiskCount: 0, activeTaskCount: 0, statusDistribution: {} },
      },
    });
    expect(connected.voiceSignalsByElderId).toEqual({});
    expect(connected.voiceMemoryDraftsByElderId).toEqual({});
  });
});
