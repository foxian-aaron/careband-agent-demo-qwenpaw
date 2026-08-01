import type {
  ConsentStatus,
  VoiceMemoryDraft,
  VoiceMemoryReviewDecision,
} from "../types";

/**
 * Stage 13 — privacy & consent helpers (pure, no store access).
 *
 * The family-visible voice summary is unlocked only when three independent
 * gates are ALL satisfied at once:
 *
 *   1. 授权  — the Mock family authorization for this elder is granted, AND
 *              the underlying consent field `familyCanViewVoiceSummary` allows
 *              it (fail-closed when the consent field is false/unknown);
 *   2. 人工 confirmed — a caregiver has manually confirmed this specific
 *              draft (never auto-confirmed, never self-reviewed by the elder);
 *   3. family_summary — the draft's own visibility policy is `family_summary`
 *              (a `caregiver_only` draft is never shown to family).
 *
 * A draft that is pending, rejected, or caregiver_only is always hidden.
 */

/** Map of draftId -> caregiver review decision (session-only). */
export type VoiceReviewMap = Record<string, VoiceMemoryReviewDecision>;

/**
 * Decide whether a single voice memory draft may be shown to family.
 * Returns false for any missing/unknown value so the gate fails closed.
 */
export const isVoiceMemoryFamilyVisible = (
  consent: ConsentStatus | undefined,
  draft: VoiceMemoryDraft,
  authorized: boolean,
  review: VoiceMemoryReviewDecision | undefined,
): boolean => {
  if (!consent?.familyCanViewVoiceSummary) return false;
  if (!authorized) return false;
  if (draft.visibility !== "family_summary") return false;
  if (review !== "confirmed") return false;
  return true;
};

/**
 * Return only the fixed family-facing summary strings for drafts that pass the
 * triple gate. The raw `VoiceMemoryDraft` objects (which carry confidence and
 * the full draft id) are deliberately not returned — family must never see the
 * original words, the confidence value, or any internal attention level.
 */
export const selectFamilyVoiceMemorySummaries = (
  consent: ConsentStatus | undefined,
  drafts: VoiceMemoryDraft[],
  reviews: VoiceReviewMap,
  authorized: boolean,
): string[] =>
  drafts
    .filter((draft) =>
      isVoiceMemoryFamilyVisible(consent, draft, authorized, reviews[draft.id]),
    )
    .map((draft) => draft.contentSummary);

/** The caregiver review status for a draft (undefined => pending). */
export const getVoiceMemoryReviewStatus = (
  reviews: VoiceReviewMap,
  draftId: string,
): VoiceMemoryReviewDecision | "pending" => reviews[draftId] ?? "pending";

/**
 * Defense-in-depth sanitizer for the persisted per-elder review map
 * (`voiceReviewByElderId`). Session review results are never persisted, so any
 * injected value is dropped — only an empty map is trusted, and no fabricated
 * confirmation can survive a reload.
 */
export const sanitizeVoiceReviewMap = (
  value: unknown,
): Record<string, VoiceReviewMap> => {
  if (!value || typeof value !== "object") return {};
  return {};
};

/**
 * Defense-in-depth sanitizer for the persisted family-consent authorization
 * map. Mock authorization is session-only, so any persisted value is dropped.
 */
export const sanitizeFamilyConsentMap = (value: unknown): Record<string, boolean> => {
  if (!value || typeof value !== "object") return {};
  return {};
};
