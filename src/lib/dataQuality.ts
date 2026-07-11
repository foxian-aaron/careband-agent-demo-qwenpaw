const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

/** Convert the backend/SQLite 0-100 data_quality value to the UI 0-1 ratio. */
export const apiDataQualityToRatio = (quality: number | null | undefined) => {
  if (typeof quality !== "number" || !Number.isFinite(quality)) return 0;
  return Number((clamp(quality, 0, 100) / 100).toFixed(4));
};

/** Convert the UI 0-1 ratio to an integer percentage for labels only. */
export const ratioDataQualityToPercent = (quality: number | null | undefined) => {
  if (typeof quality !== "number" || !Number.isFinite(quality)) return 0;
  return Math.round(clamp(quality, 0, 1) * 100);
};

/** One-time compatibility for state saved before UI dataQuality moved from 0-100 to 0-1. */
export const migratePersistedDataQuality = (quality: number | undefined) => {
  if (quality === undefined) return undefined;
  if (!Number.isFinite(quality)) return 0;
  return quality > 1
    ? apiDataQualityToRatio(quality)
    : Number(clamp(quality, 0, 1).toFixed(4));
};
