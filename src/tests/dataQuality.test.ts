import { describe, expect, it } from "vitest";
import {
  apiDataQualityToRatio,
  migratePersistedDataQuality,
  ratioDataQualityToPercent,
} from "../lib/dataQuality";

describe("wearable data quality units", () => {
  it("converts the backend 0-100 percentage to the UI 0-1 ratio once", () => {
    expect(apiDataQualityToRatio(85)).toBe(0.85);
    expect(apiDataQualityToRatio(0)).toBe(0);
    expect(apiDataQualityToRatio(100)).toBe(1);
  });

  it("clamps invalid boundaries instead of producing impossible percentages", () => {
    expect(apiDataQualityToRatio(-5)).toBe(0);
    expect(apiDataQualityToRatio(120)).toBe(1);
    expect(apiDataQualityToRatio(Number.NaN)).toBe(0);
    expect(ratioDataQualityToPercent(0.85)).toBe(85);
    expect(ratioDataQualityToPercent(2)).toBe(100);
  });

  it("migrates the legacy persisted 0-100 UI value without changing current ratios", () => {
    expect(migratePersistedDataQuality(85)).toBe(0.85);
    expect(migratePersistedDataQuality(0.85)).toBe(0.85);
    expect(migratePersistedDataQuality(undefined)).toBeUndefined();
  });
});
