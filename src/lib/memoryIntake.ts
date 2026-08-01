import type {
  CareMemoryCategory,
  CareMemoryDraft,
  CareMemoryItem,
  ConfirmedCareMemory,
  MemorySourceType,
  MemoryReviewStatus,
} from "../types";

export const MAX_MEMORY_INPUT_LENGTH = 1000;
export const MAX_MEMORY_DRAFT_ITEMS = 5;
export const MAX_MEMORY_ITEM_CONTENT_LENGTH = 240;
const MAX_MEMORY_RECORDS = 20;

const categories = new Set<CareMemoryCategory>([
  "general_context",
  "communication_preference",
  "medication_routine",
  "safety_observation",
  "family_preference",
]);
const sourceTypes = new Set<MemorySourceType>([
  "family_oral",
  "caregiver_input",
  "institution_record",
]);
const reviewStatuses = new Set<MemoryReviewStatus>([
  "pending",
  "confirmed",
  "rejected",
]);
const elderIdPattern = /^[A-Z0-9_-]{1,32}$/;
const allowedMemoryContents = new Set([
  "沟通时优先使用长者熟悉的表达方式，并由照护人员确认理解情况。",
  "资料提示存在日常用药提醒习惯，具体药物信息必须以机构记录和人工确认为准。",
  "夜间活动与行动安全可作为照护观察重点，异常情况仍须由照护人员现场确认。",
  "资料提到家属联系偏好；是否向家属展示任何摘要仍需后续授权。",
  "已收到一份照护背景资料，需由照护人员补充并逐条确认。",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isTimestamp = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));

const sanitizeMemoryItem = (
  value: unknown,
  elderId: string,
  confirmedOnly = false,
): CareMemoryItem | null => {
  if (!isRecord(value)) return null;
  const category = value.category as CareMemoryCategory;
  const sourceType = value.sourceType as MemorySourceType;
  const reviewStatus = value.reviewStatus as MemoryReviewStatus;
  if (
    typeof value.id !== "string" || value.id.length < 1 || value.id.length > 100 ||
    value.elderId !== elderId || !categories.has(category) || !sourceTypes.has(sourceType) ||
    !reviewStatuses.has(reviewStatus) || (confirmedOnly && reviewStatus !== "confirmed") ||
    typeof value.content !== "string" || value.content.length < 1 ||
    value.content.length > MAX_MEMORY_ITEM_CONTENT_LENGTH ||
    !allowedMemoryContents.has(value.content) ||
    typeof value.confidence !== "number" || !Number.isFinite(value.confidence) ||
    value.confidence < 0 || value.confidence > 1 || !isTimestamp(value.updatedAt)
  ) return null;
  return {
    id: value.id,
    elderId,
    category,
    content: value.content,
    sourceType,
    confidence: value.confidence,
    reviewStatus,
    visibilityScope: ["caregiver", "institution"],
    updatedAt: value.updatedAt,
  };
};

export const sanitizeMemoryDrafts = (
  value: unknown,
): Record<string, CareMemoryDraft> => {
  if (!isRecord(value)) return {};
  const result: Record<string, CareMemoryDraft> = {};
  for (const [elderId, candidate] of Object.entries(value).slice(0, MAX_MEMORY_RECORDS)) {
    if (!elderIdPattern.test(elderId) || !isRecord(candidate) || candidate.elderId !== elderId ||
        !Array.isArray(candidate.items) || candidate.items.length < 1 ||
        candidate.items.length > MAX_MEMORY_DRAFT_ITEMS || !isTimestamp(candidate.createdAt) ||
        !isTimestamp(candidate.updatedAt)) continue;
    const items = candidate.items.map((item) => sanitizeMemoryItem(item, elderId));
    if (items.some((item) => item === null)) continue;
    result[elderId] = {
      elderId,
      items: items as CareMemoryItem[],
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
    };
  }
  return result;
};

export const sanitizeConfirmedMemories = (
  value: unknown,
): Record<string, ConfirmedCareMemory> => {
  if (!isRecord(value)) return {};
  const result: Record<string, ConfirmedCareMemory> = {};
  for (const [elderId, candidate] of Object.entries(value).slice(0, MAX_MEMORY_RECORDS)) {
    if (!elderIdPattern.test(elderId) || !isRecord(candidate) || candidate.elderId !== elderId ||
        !Array.isArray(candidate.items) || candidate.items.length > MAX_MEMORY_DRAFT_ITEMS ||
        !isTimestamp(candidate.confirmedAt)) continue;
    const items = candidate.items.map((item) => sanitizeMemoryItem(item, elderId, true));
    if (items.some((item) => item === null)) continue;
    result[elderId] = {
      elderId,
      items: items as CareMemoryItem[],
      confirmedAt: candidate.confirmedAt,
    };
  }
  return result;
};

interface DraftTemplate {
  category: CareMemoryCategory;
  matches: string[];
  content: string;
  confidence: number;
}

const templates: DraftTemplate[] = [
  {
    category: "communication_preference",
    matches: ["粤语", "方言", "听力"],
    content: "沟通时优先使用长者熟悉的表达方式，并由照护人员确认理解情况。",
    confidence: 0.82,
  },
  {
    category: "medication_routine",
    matches: ["晚药", "服药", "用药", "提醒"],
    content: "资料提示存在日常用药提醒习惯，具体药物信息必须以机构记录和人工确认为准。",
    confidence: 0.78,
  },
  {
    category: "safety_observation",
    matches: ["跌倒", "夜间", "起床", "离床"],
    content: "夜间活动与行动安全可作为照护观察重点，异常情况仍须由照护人员现场确认。",
    confidence: 0.8,
  },
  {
    category: "family_preference",
    matches: ["女儿", "儿子", "家属", "通知"],
    content: "资料提到家属联系偏好；是否向家属展示任何摘要仍需后续授权。",
    confidence: 0.76,
  },
];

const createItem = (
  elderId: string,
  template: Pick<DraftTemplate, "category" | "content" | "confidence">,
  sourceType: MemorySourceType,
  index: number,
  updatedAt: string,
): CareMemoryItem => ({
  id: `MEM-${elderId}-${template.category}-${index + 1}`,
  elderId,
  category: template.category,
  content: template.content,
  sourceType,
  confidence: template.confidence,
  reviewStatus: "pending",
  visibilityScope: ["caregiver", "institution"],
  updatedAt,
});

export const createMemoryDraft = (
  elderId: string,
  rawInput: string,
  sourceType: MemorySourceType,
  createdAt: string,
): CareMemoryDraft => {
  const input = rawInput.trim().slice(0, MAX_MEMORY_INPUT_LENGTH);
  const matched = templates.filter((template) =>
    template.matches.some((keyword) => input.includes(keyword)),
  );
  const selected = matched.length > 0
    ? matched
    : [{
        category: "general_context" as const,
        content: "已收到一份照护背景资料，需由照护人员补充并逐条确认。",
        confidence: 0.5,
      }];

  return {
    elderId,
    items: selected
      .slice(0, MAX_MEMORY_DRAFT_ITEMS)
      .map((template, index) => createItem(elderId, template, sourceType, index, createdAt)),
    createdAt,
    updatedAt: createdAt,
  };
};

export const isMemoryDraftFullyReviewed = (draft: CareMemoryDraft) =>
  draft.items.length > 0 &&
  draft.items.every((item) => item.reviewStatus !== "pending");

export const buildConfirmedCareMemory = (
  draft: CareMemoryDraft,
  confirmedAt: string,
): ConfirmedCareMemory | null => {
  if (!isMemoryDraftFullyReviewed(draft)) return null;
  return {
    elderId: draft.elderId,
    items: draft.items
      .filter((item) => item.reviewStatus === "confirmed")
      .map((item) => ({ ...item, visibilityScope: ["caregiver", "institution"] })),
    confirmedAt,
  };
};
