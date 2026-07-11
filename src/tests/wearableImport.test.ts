import { describe, expect, it } from "vitest";
import {
  mapBackendSnapshotToWearable,
  mapRecentSnapshotsToTrend,
  parseWearableCsv,
} from "../lib/wearableImport";

describe("wearable snapshot normalization", () => {
  it("maps backend percentages to UI ratios while preserving missing metrics", () => {
    const snapshot = mapBackendSnapshotToWearable({
      snapshot_id: "SNAP-E001-2026-07-01",
      elder_id: "E001",
      date: "2026-07-01",
      data_source: "CSV",
      heart_rate_avg: 76,
      resting_heart_rate: null,
      steps: null,
      active_minutes: null,
      sleep_duration: 6.4,
      wear_time_hours: 18,
      data_quality: 85,
      created_at: "2026-07-11T10:00:00+08:00",
    });

    expect(snapshot.dataQuality).toBe(0.85);
    expect(snapshot.restingHeartRate).toBeNull();
    expect(snapshot.steps).toBeNull();
    expect(snapshot.activeMinutes).toBeNull();
    expect(snapshot.importedAt).toBe("2026-07-11T10:00:00+08:00");
  });

  it("does not invent resting heart rate, zero metrics, or an import timestamp", () => {
    const [snapshot] = parseWearableCsv(
      "E001",
      [
        "date,heart_rate_avg,resting_heart_rate,steps,active_minutes,sleep_duration,wear_time_hours,data_quality",
        "2026-07-01,76,,,,6.4,18,85",
      ].join("\n"),
      "CSV",
    );

    expect(snapshot).toMatchObject({
      heartRateAvg: 76,
      restingHeartRate: null,
      steps: null,
      activeMinutes: null,
      sleepDuration: 6.4,
      dataQuality: 0.85,
      importedAt: null,
    });
  });

  it("builds the dashboard trend from the seven most recent distinct snapshot dates", () => {
    const snapshots = Array.from({ length: 8 }, (_, index) => ({
      snapshot_id: `S-${index}`,
      elder_id: "E001",
      date: `2026-07-${String(index + 1).padStart(2, "0")}`,
      data_source: "CSV",
      heart_rate_avg: null,
      resting_heart_rate: null,
      steps: index === 7 ? null : 1000 + index,
      active_minutes: null,
      sleep_duration: 6 + index / 10,
      wear_time_hours: 18,
      data_quality: index === 7 ? 35 : 85,
      created_at: `2026-07-${String(index + 1).padStart(2, "0")}T10:00:00Z`,
    }));
    snapshots.push({ ...snapshots[7], snapshot_id: "S-7-older", steps: 999 });

    const trend = mapRecentSnapshotsToTrend("E001", snapshots, 0.9, "attention");

    expect(trend.points).toHaveLength(7);
    expect(trend.points[0]?.date).toBe("07/02");
    expect(trend.points[trend.points.length - 1]).toMatchObject({
      date: "07/08",
      steps: null,
      riskLevel: "data_insufficient",
    });
  });
});
