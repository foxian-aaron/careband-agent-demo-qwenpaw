import type {
  MedicationStatus,
  VoiceCompanionIntent,
  VoiceInteractionSignal,
  VoiceMemoryDraft,
} from "../types";

export const voiceCompanionDisclaimer =
  "本功能只提供陪伴与照护提示，不构成医疗诊断。";

export interface ElderVoiceCompanionInput {
  elderId: string;
  rawText: string;
  timestamp?: string;
  context?: {
    medicationEvening?: MedicationStatus;
    locationZone?: string;
  };
}

export interface ElderVoiceCompanionResult {
  assistantReply: string;
  signal: VoiceInteractionSignal;
  memoryDrafts: VoiceMemoryDraft[];
}

export interface VoiceSessionMessage {
  id: string;
  role: "elder" | "assistant";
  text: string;
}

const intentSummaries: Record<VoiceCompanionIntent, string> = {
  companionship: "长者希望进行一次轻松陪伴交流。",
  symptom_report: "长者表达身体不适，需要护工结合规则结果人工复核。",
  medication_question: "长者询问已有用药确认记录，需要照护人员协助核对。",
  past_memory: "长者提到一段过去经历，具体内容需人工确认。",
  loneliness_expression: "长者表达想找人说话，适合照护人员主动关心。",
  location_confusion: "长者表达位置困惑，需要护工确认所在区域。",
  caregiver_request: "长者主动提出希望联系护工。",
  general: "长者进行了一次一般陪伴交流。",
};

const memorySummaries = {
  past_story: "提到一段过去经历，具体内容需由护工人工确认。",
  life_preference: "表达一项生活偏好，具体内容需由护工人工确认。",
  daily_rhythm: "在当前时段表达孤独或想找人说话，适合巡查时主动关心。",
} as const;

const memoryPolicies: Record<VoiceMemoryDraft["memoryType"], {
  confidence: number;
  visibility: VoiceMemoryDraft["visibility"];
}> = {
  past_story: { confidence: 0.82, visibility: "family_summary" },
  life_preference: { confidence: 0.76, visibility: "family_summary" },
  daily_rhythm: { confidence: 0.72, visibility: "caregiver_only" },
};

const replies: Record<VoiceCompanionIntent, string> = {
  companionship: "我在这里陪您聊一会儿。可以说说今天，也可以聊聊熟悉的往事。",
  symptom_report: `我听到了。请先坐稳并慢慢休息，我会留下照护摘要，请护工结合规则结果查看。${voiceCompanionDisclaimer}`,
  medication_question: "我只能帮您核对已有记录，不会解释药理、改变用药或建议药量。",
  past_memory: "这段往事对您很重要。我会先整理成待护工确认的摘要。",
  loneliness_expression: `我在这里陪您说一会儿，也会留下摘要供照护人员适时关心。${voiceCompanionDisclaimer}`,
  location_confusion: `请先不要着急，我只会显示机构已有的区域信息，并请护工确认。${voiceCompanionDisclaimer}`,
  caregiver_request: "好的，我会留下希望联系护工的照护摘要。请先在安全的位置稍等。",
  general: "我听到了。您可以慢慢说，我只会保留适合照护参考的摘要。",
};

const containsAny = (text: string, terms: string[]) =>
  terms.some((term) => text.includes(term));

const safeTimestamp = (value?: string) => {
  const timestamp = value ?? new Date().toISOString();
  return Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp).toISOString() : new Date().toISOString();
};

const compactTimestamp = (timestamp: string) => timestamp.replace(/\D/g, "").slice(0, 17);

const coarseZone = (value?: string) => {
  const zone = value?.trim();
  if (!zone || zone.length > 20) return null;
  const facilityFloor = /^(?:长者中心)?[一二三四五六七八九十]+楼(?:活动区|公共区|休息区|护理区|生活区)?$/;
  const sharedArea = /^(?:活动区|公共区|休息区|护理区|生活区|餐厅|花园|大厅)$/;
  return facilityFloor.test(zone) || sharedArea.test(zone) ? zone : null;
};

export const appendVoiceSessionExchange = (
  current: VoiceSessionMessage[],
  elderText: string,
  assistantText: string,
  id: string,
) => [
  ...current,
  { id: `elder-${id}`, role: "elder" as const, text: elderText },
  { id: `assistant-${id}`, role: "assistant" as const, text: assistantText },
].slice(-20);

const detectIntent = (text: string): VoiceCompanionIntent => {
  const emergency = containsAny(text, ["救命", "跌倒", "摔倒", "很痛", "胸口痛"]);
  const symptom = emergency || containsAny(text, ["头晕", "不舒服", "胸闷", "疼"]);
  if (symptom) return "symptom_report";
  if (containsAny(text, ["吃药", "用药", "药吃", "药是什么"])) return "medication_question";
  if (containsAny(text, ["不知道在哪里", "找不到房间", "迷路", "这是哪里"])) return "location_confusion";
  if (containsAny(text, ["找护工", "联系护工", "叫护工", "想找护工"])) return "caregiver_request";
  if (containsAny(text, ["孤单", "寂寞", "有点闷", "想找人说话"])) return "loneliness_expression";
  if (containsAny(text, ["以前", "年轻时", "那时候", "往事", "小时候"])) return "past_memory";
  if (containsAny(text, ["聊聊天", "聊一聊", "陪我", "想聊天"])) return "companionship";
  return "general";
};

const buildMemoryDrafts = (
  elderId: string,
  text: string,
  intent: VoiceCompanionIntent,
  timestamp: string,
): VoiceMemoryDraft[] => {
  const result: VoiceMemoryDraft[] = [];
  const add = (
    memoryType: VoiceMemoryDraft["memoryType"],
  ) => {
    const policy = memoryPolicies[memoryType];
    result.push({
      id: `VOICE-MEMORY-${elderId}-${compactTimestamp(timestamp)}-${result.length + 1}`,
      elderId,
      memoryType,
      contentSummary: memorySummaries[memoryType],
      confidence: policy.confidence,
      reviewStatus: "pending",
      visibility: policy.visibility,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  };

  if (intent === "past_memory") add("past_story");
  if (containsAny(text, ["喜欢", "不喜欢", "习惯"])) add("life_preference");
  if (intent === "loneliness_expression") add("daily_rhythm");
  return result.slice(0, 2);
};

export const analyzeElderVoiceCompanion = (
  input: ElderVoiceCompanionInput,
): ElderVoiceCompanionResult => {
  const text = input.rawText.trim().slice(0, 500);
  const timestamp = safeTimestamp(input.timestamp);
  const detectedIntent = detectIntent(text);
  const emergency = containsAny(text, ["救命", "跌倒", "摔倒", "很痛", "胸口痛"]);
  const attentionLevel = emergency || detectedIntent === "location_confusion"
    ? "immediate_review"
    : ["symptom_report", "medication_question", "caregiver_request", "loneliness_expression"].includes(detectedIntent)
      ? "review"
      : "routine";
  const shouldNotifyCaregiver = attentionLevel !== "routine";
  let assistantReply = replies[detectedIntent];
  if (detectedIntent === "medication_question") {
    if (input.context?.medicationEvening === "confirmed") {
      assistantReply = `已有记录显示晚药已确认。${replies.medication_question}`;
    } else if (input.context?.medicationEvening === "not_confirmed") {
      assistantReply = `已有记录显示晚药尚未确认，请让护工协助核对。${replies.medication_question}`;
    } else {
      assistantReply = `暂无可核对的晚药记录，请让护工协助确认。${replies.medication_question}`;
    }
  }
  if (detectedIntent === "location_confusion") {
    const zone = coarseZone(input.context?.locationZone);
    assistantReply = zone
      ? `机构记录的当前区域是“${zone}”。${replies.location_confusion}`
      : replies.location_confusion;
  }

  return {
    assistantReply,
    signal: {
      signalId: `VOICE-${input.elderId}-${compactTimestamp(timestamp)}`,
      elderId: input.elderId,
      timestamp,
      transcriptSummary: intentSummaries[detectedIntent],
      detectedIntent,
      attentionLevel,
      shouldNotifyCaregiver,
      retentionPolicy: "summary_only",
    },
    memoryDrafts: buildMemoryDrafts(input.elderId, text, detectedIntent, timestamp),
  };
};

const validIntents = new Set<VoiceCompanionIntent>(Object.keys(intentSummaries) as VoiceCompanionIntent[]);
const validAttention = new Set(["routine", "review", "immediate_review"]);
const validMemoryTypes = new Set(Object.keys(memorySummaries));

const hasOnlyKeys = (value: object, allowed: ReadonlySet<string>) =>
  Object.keys(value).every((key) => allowed.has(key));

const signalKeys = new Set([
  "signalId", "elderId", "timestamp", "transcriptSummary", "detectedIntent",
  "attentionLevel", "shouldNotifyCaregiver", "retentionPolicy",
]);

const draftKeys = new Set([
  "id", "elderId", "memoryType", "contentSummary", "confidence",
  "reviewStatus", "visibility", "createdAt", "updatedAt",
]);

export const sanitizeVoiceSignal = (
  value: unknown,
  expectedElderId?: string,
): VoiceInteractionSignal | null => {
  if (!value || typeof value !== "object") return null;
  if (!hasOnlyKeys(value, signalKeys)) return null;
  const item = value as Partial<VoiceInteractionSignal>;
  const signalIdMatchesElder = typeof item.signalId === "string" &&
    item.signalId.startsWith(`VOICE-${item.elderId}-`);
  if (
    typeof item.signalId !== "string" || !/^VOICE-[A-Za-z0-9_-]+-\d{17}$/.test(item.signalId) ||
    !signalIdMatchesElder ||
    typeof item.elderId !== "string" || (expectedElderId && item.elderId !== expectedElderId) ||
    typeof item.timestamp !== "string" || !Number.isFinite(Date.parse(item.timestamp)) ||
    typeof item.detectedIntent !== "string" || !validIntents.has(item.detectedIntent as VoiceCompanionIntent) ||
    typeof item.attentionLevel !== "string" || !validAttention.has(item.attentionLevel) ||
    typeof item.shouldNotifyCaregiver !== "boolean" || item.retentionPolicy !== "summary_only"
  ) return null;
  const intent = item.detectedIntent as VoiceCompanionIntent;
  if (item.transcriptSummary !== intentSummaries[intent]) return null;
  const attention = item.attentionLevel as VoiceInteractionSignal["attentionLevel"];
  const allowedAttention: Record<VoiceCompanionIntent, VoiceInteractionSignal["attentionLevel"][]> = {
    companionship: ["routine"],
    symptom_report: ["review", "immediate_review"],
    medication_question: ["review"],
    past_memory: ["routine"],
    loneliness_expression: ["review"],
    location_confusion: ["immediate_review"],
    caregiver_request: ["review"],
    general: ["routine"],
  };
  if (!allowedAttention[intent].includes(attention) || item.shouldNotifyCaregiver !== (attention !== "routine")) return null;
  return {
    signalId: item.signalId,
    elderId: item.elderId,
    timestamp: new Date(item.timestamp).toISOString(),
    transcriptSummary: intentSummaries[intent],
    detectedIntent: intent,
    attentionLevel: attention,
    shouldNotifyCaregiver: item.shouldNotifyCaregiver,
    retentionPolicy: "summary_only",
  };
};

export const sanitizeVoiceMemoryDraft = (
  value: unknown,
  expectedElderId?: string,
): VoiceMemoryDraft | null => {
  if (!value || typeof value !== "object") return null;
  if (!hasOnlyKeys(value, draftKeys)) return null;
  const item = value as Partial<VoiceMemoryDraft>;
  const draftIdMatchesElder = typeof item.id === "string" &&
    item.id.startsWith(`VOICE-MEMORY-${item.elderId}-`);
  if (
    typeof item.id !== "string" || !/^VOICE-MEMORY-[A-Za-z0-9_-]+-\d{17}-[12]$/.test(item.id) ||
    !draftIdMatchesElder ||
    typeof item.elderId !== "string" || (expectedElderId && item.elderId !== expectedElderId) ||
    typeof item.memoryType !== "string" || !validMemoryTypes.has(item.memoryType) ||
    typeof item.confidence !== "number" || item.confidence < 0 || item.confidence > 1 ||
    item.reviewStatus !== "pending" ||
    (item.visibility !== "caregiver_only" && item.visibility !== "family_summary") ||
    typeof item.createdAt !== "string" || !Number.isFinite(Date.parse(item.createdAt)) ||
    typeof item.updatedAt !== "string" || !Number.isFinite(Date.parse(item.updatedAt))
  ) return null;
  const memoryType = item.memoryType as VoiceMemoryDraft["memoryType"];
  const policy = memoryPolicies[memoryType];
  if (
    item.contentSummary !== memorySummaries[memoryType] ||
    item.confidence !== policy.confidence ||
    item.visibility !== policy.visibility
  ) return null;
  return {
    id: item.id,
    elderId: item.elderId,
    memoryType,
    contentSummary: memorySummaries[memoryType],
    confidence: policy.confidence,
    reviewStatus: "pending",
    visibility: policy.visibility,
    createdAt: new Date(item.createdAt).toISOString(),
    updatedAt: new Date(item.updatedAt).toISOString(),
  };
};

export const sanitizeVoiceSignalsByElder = (
  value: unknown,
  knownElderIds: ReadonlySet<string>,
): Record<string, VoiceInteractionSignal[]> => {
  if (!value || typeof value !== "object") return {};
  return Object.entries(value).reduce<Record<string, VoiceInteractionSignal[]>>((result, [elderId, entries]) => {
    if (!knownElderIds.has(elderId) || !Array.isArray(entries)) return result;
    const safe = entries.map((entry) => sanitizeVoiceSignal(entry, elderId)).filter((entry): entry is VoiceInteractionSignal => Boolean(entry));
    if (safe.length > 0) result[elderId] = safe.slice(-20);
    return result;
  }, {});
};

export const sanitizeVoiceDraftsByElder = (
  value: unknown,
  knownElderIds: ReadonlySet<string>,
): Record<string, VoiceMemoryDraft[]> => {
  if (!value || typeof value !== "object") return {};
  return Object.entries(value).reduce<Record<string, VoiceMemoryDraft[]>>((result, [elderId, entries]) => {
    if (!knownElderIds.has(elderId) || !Array.isArray(entries)) return result;
    const safe = entries.map((entry) => sanitizeVoiceMemoryDraft(entry, elderId)).filter((entry): entry is VoiceMemoryDraft => Boolean(entry));
    if (safe.length > 0) result[elderId] = safe.slice(-10);
    return result;
  }, {});
};
