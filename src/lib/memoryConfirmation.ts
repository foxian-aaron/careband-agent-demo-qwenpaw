import type { CareMemoryItem, InitialCareMemory } from "../types";

const uniqueContents = (items: CareMemoryItem[], categories: CareMemoryItem["category"][]) =>
  Array.from(
    new Set(
      items
        .filter((item) => categories.includes(item.category))
        .map((item) => item.content.trim())
        .filter(Boolean),
    ),
  );

export const isMemoryDraftFullyReviewed = (draft: InitialCareMemory) =>
  draft.items.length > 0 &&
  draft.items.every((item) => ["confirmed", "rejected"].includes(item.confirmationStatus));

export const composeProfileRiskTags = (
  profileRiskTags: string[],
  memoryDerivedRiskTags: string[],
) => Array.from(new Set([...profileRiskTags, ...memoryDerivedRiskTags]));

export const inferLegacyProfileBaseRiskTags = (
  legacyVisibleRiskTags: string[],
  legacyMemoryDerivedRiskTags: string[],
) => {
  const memoryDerived = new Set(legacyMemoryDerivedRiskTags);
  return legacyVisibleRiskTags.filter((tag) => !memoryDerived.has(tag));
};

export const buildConfirmedCareMemory = (
  draft: InitialCareMemory,
  updatedAt = new Date().toISOString(),
): InitialCareMemory | null => {
  if (!isMemoryDraftFullyReviewed(draft)) return null;

  const confirmedItems = draft.items.filter(
    (item) => item.confirmationStatus === "confirmed",
  );

  return {
    ...draft,
    summary: `已由人工逐条复核并确认 ${confirmedItems.length} 条初始照护记忆。`,
    riskTags: uniqueContents(confirmedItems, ["safety_risk"]),
    communicationPreferences: uniqueContents(confirmedItems, ["communication_preference"]),
    medicationNotes: uniqueContents(confirmedItems, ["medication_notes"]),
    familyNotificationPreferences: uniqueContents(confirmedItems, ["family_notification"]),
    observationFocus: uniqueContents(confirmedItems, ["health_background", "safety_risk"]),
    missingQuestions: uniqueContents(confirmedItems, ["missing_question"]),
    items: confirmedItems,
    updatedAt,
  };
};
