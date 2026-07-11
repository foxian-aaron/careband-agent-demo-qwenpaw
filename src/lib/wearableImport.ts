import type {
  ElderTrend,
  RiskLevel,
  WearableDailySnapshot,
  WearableDataSource,
} from "../types";
import type { BackendSnapshot } from "./apiClient";
import { apiDataQualityToRatio } from "./dataQuality";

export const wearableCsvExample = `elder_id,date,data_source,heart_rate_avg,resting_heart_rate,steps,active_minutes,sleep_duration,wear_time_hours,data_quality
E001,2026-07-01,CSV Import,76,68,2100,38,6.4,18,85
E001,2026-07-02,CSV Import,78,,1980,35,6.1,17,80
E001,2026-07-03,CSV Import,86,72,820,18,4.8,15,72`;

export const chenWearableSevenDayCsv = `elder_id,date,data_source,heart_rate_avg,resting_heart_rate,steps,active_minutes,sleep_duration,wear_time_hours,data_quality
E001,2026-06-04,CSV Import,74,67,2280,44,6.8,19,88
E001,2026-06-05,CSV Import,75,67,2110,40,6.4,18,85
E001,2026-06-06,CSV Import,73,66,2360,46,6.7,19,88
E001,2026-06-07,CSV Import,77,68,1980,35,6.3,17,82
E001,2026-06-08,CSV Import,79,69,1620,30,5.7,16,78
E001,2026-06-09,CSV Import,82,70,1140,24,5.1,15,74
E001,2026-06-10,CSV Import,86,72,820,18,4.8,15,72`;

const parseNullableNumber = (value: string): number | null => {
  if (!value.trim()) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
};

export const mapBackendSnapshotToWearable = (
  snapshot: BackendSnapshot,
): WearableDailySnapshot => ({
  id: snapshot.snapshot_id,
  elderId: snapshot.elder_id,
  date: snapshot.date,
  dataSource: snapshot.data_source,
  heartRateAvg: snapshot.heart_rate_avg,
  restingHeartRate: snapshot.resting_heart_rate,
  steps: snapshot.steps,
  activeMinutes: snapshot.active_minutes,
  sleepDuration: snapshot.sleep_duration,
  wearTimeHours: snapshot.wear_time_hours,
  dataQuality: apiDataQualityToRatio(snapshot.data_quality),
  importedAt: snapshot.created_at || null,
});

export const mapBackendSnapshotsToWearable = (snapshots: BackendSnapshot[]) =>
  snapshots.map(mapBackendSnapshotToWearable);

export const mapRecentSnapshotsToTrend = (
  elderId: string,
  snapshots: BackendSnapshot[],
  medicationOnTimeRate: number,
  currentRiskLevel: RiskLevel,
): ElderTrend => {
  const snapshotsByDate = new Map<string, BackendSnapshot>();
  for (const snapshot of snapshots) {
    const existing = snapshotsByDate.get(snapshot.date);
    if (!existing || snapshot.created_at > existing.created_at) {
      snapshotsByDate.set(snapshot.date, snapshot);
    }
  }

  const recent = [...snapshotsByDate.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-7);
  const latestDate = recent[recent.length - 1]?.date;

  return {
    elderId,
    points: recent.map((snapshot) => ({
      date: snapshot.date.slice(5).replace("-", "/"),
      steps: snapshot.steps,
      sleepHours: snapshot.sleep_duration,
      medicationOnTimeRate,
      riskLevel:
        apiDataQualityToRatio(snapshot.data_quality) < 0.4
          ? "data_insufficient"
          : snapshot.date === latestDate
            ? currentRiskLevel
            : "observation",
    })),
  };
};

export const parseWearableCsv = (
  elderId: string,
  csvText: string,
  source: WearableDataSource,
): WearableDailySnapshot[] => {
  const lines = csvText
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const [headerLine, ...rows] = lines;
  if (!headerLine || rows.length === 0) return [];

  const headers = headerLine.split(",").map((header) => header.trim());
  const getValue = (values: string[], key: string) => values[headers.indexOf(key)] ?? "";
  return rows.map((row, index) => {
    const values = row.split(",").map((value) => value.trim());
    const rawQuality = parseNullableNumber(getValue(values, "data_quality"));
    const importedAt =
      getValue(values, "imported_at") || getValue(values, "created_at") || null;
    return {
      id: `WDS-${elderId}-${index + 1}`,
      elderId,
      date: getValue(values, "date"),
      dataSource: source,
      heartRateAvg: parseNullableNumber(getValue(values, "heart_rate_avg")),
      restingHeartRate: parseNullableNumber(getValue(values, "resting_heart_rate")),
      steps: parseNullableNumber(getValue(values, "steps")),
      activeMinutes: parseNullableNumber(getValue(values, "active_minutes")),
      sleepDuration: parseNullableNumber(getValue(values, "sleep_duration")),
      wearTimeHours: parseNullableNumber(getValue(values, "wear_time_hours")),
      dataQuality: apiDataQualityToRatio(rawQuality),
      importedAt,
    };
  });
};

export const latestWearableSnapshot = (snapshots: WearableDailySnapshot[]) =>
  snapshots.slice().sort((a, b) => a.date.localeCompare(b.date))[
    snapshots.length - 1
  ];
