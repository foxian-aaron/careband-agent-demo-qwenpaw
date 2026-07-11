import { snapshotSchema } from "../validators.js";

const requiredHeaders = [
  "elder_id",
  "date",
  "data_source",
  "heart_rate_avg",
  "resting_heart_rate",
  "steps",
  "active_minutes",
  "sleep_duration",
  "wear_time_hours",
  "data_quality",
];

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result.map((value) => value.trim());
}

export function parseDailySnapshotsCsv(csvText, options = {}) {
  const lines = csvText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("CSV 至少需要标题行和一行数据。");
  }

  const headers = parseCsvLine(lines[0]);
  const missing = requiredHeaders.filter((header) => !headers.includes(header));
  if (missing.length) {
    throw new Error(`CSV 缺少字段：${missing.join(", ")}`);
  }

  return lines.slice(1).map((line, rowIndex) => {
    const values = parseCsvLine(line);
    const raw = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    if (options.elderId) raw.elder_id = options.elderId;
    if (options.dataSource) raw.data_source = options.dataSource;
    const parsed = snapshotSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`CSV 第 ${rowIndex + 2} 行格式错误：${parsed.error.message}`);
    }
    return parsed.data;
  });
}
