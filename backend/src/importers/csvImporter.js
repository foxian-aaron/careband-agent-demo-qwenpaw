// backend/src/importers/csvImporter.js
//
// CareBand Stage 9A — minimal CSV DailySnapshot importer (Issue #23).
//
// Pure module: no database, no logging, no Date.now. parseDailySnapshotsCsv()
// takes raw CSV text plus the server-authoritative elder_id and returns a NEW
// parsed result. It:
//   * rejects any CSV whose header is not EXACTLY the ten required columns;
//   * discards client-supplied elder_id / data_source values and stamps the
//     server-owned elder_id and data_source="CSV Import" on every row;
//   * coerces empty numeric cells to null and validates real YYYY-MM-DD dates,
//     nonnegative numbers, integer steps, sleep/wear <= 24, data_quality 0..100;
//   * enforces the 64 KiB csv_text cap and the 366 data-row cap;
//   * validates every row against the daily_snapshot JSON Schema via the
//     existing Ajv 8.18.0, with a LOCAL strict "careband-date" format keyword
//     (no extra dependency).
//
// No snapshot_id / client risk field can ever enter a stored payload: the
// schema uses additionalProperties:false and this builder only ever emits the
// ten canonical keys.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { ValidationError } from "../eventContract.js";

const schema = JSON.parse(
  readFileSync(
    new URL("../schemas/daily_snapshot.schema.json", import.meta.url),
    "utf8",
  ),
);

// Exactly these header names — no more, no less. The presence of elder_id and
// data_source columns is required for format consistency, but their per-row
// values are always overwritten by the server.
export const REQUIRED_HEADERS = [
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
const REQUIRED_HEADER_SET = new Set(REQUIRED_HEADERS);

const DATA_SOURCE_OVERRIDE = "CSV Import";
const MAX_CSV_BYTES = 64 * 1024; // 64 KiB
const MAX_DATA_ROWS = 366;

// Numeric cell formats: only plain nonnegative decimals (or integers for
// steps). Rejects hex, scientific notation, signs, thousands separators, and
// any other non-numeric noise.
const NUMBER_RE = /^\d+(\.\d+)?$/;
const INTEGER_RE = /^\d+$/;

const NULLABLE_METRICS = [
  "heart_rate_avg",
  "resting_heart_rate",
  "steps",
  "active_minutes",
  "sleep_duration",
  "wear_time_hours",
  "data_quality",
];

// --- local strict YYYY-MM-DD format (registered into Ajv, no dependency) -----

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Strict calendar-date check for YYYY-MM-DD (rejects 2026-13-01, 2026-02-30,
 *  slash formats, and non-strings). Non-strings return true so the JSON Schema
 *  "type" check owns that responsibility. */
export function isStrictCalendarDate(value) {
  if (typeof value !== "string") return true;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
// Register the local strict date format keyword so the schema's
// `format: "careband-date"` is validated (and strict mode does not reject it as
// an unknown format) without pulling in ajv-formats.
ajv.addFormat("careband-date", (data) => isStrictCalendarDate(data));
const validateSnapshot = ajv.compile(schema);

// ----------------------------- CSV tokenizer --------------------------------

/**
 * Minimal RFC-4180-style CSV tokenizer. Handles double-quoted fields, escaped
 * quotes (""), commas inside quotes, and CRLF / LF / CR line endings. Blank
 * lines (rows whose every field is empty) are dropped. Returns an array of
 * string-array rows. Malformed quoting is rejected with the same fixed
 * validation error used for all other invalid CSV input.
 */
function tokenizeCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const len = text.length;
  for (let i = 0; i < len; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      if (field !== "") throw new ValidationError("validation_error");
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // Treat CR and CRLF as a single row break.
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (text[i + 1] === "\n") i += 1;
    } else {
      field += c;
    }
  }
  if (inQuotes) throw new ValidationError("validation_error");
  // Flush a trailing field/row when the text does not end with a newline.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop blank lines (rows where every field is the empty string).
  return rows.filter((r) => r.some((f) => f !== ""));
}

// --------------------------- per-cell coercion ------------------------------

/** Empty / whitespace-only cell -> null; otherwise the numeric value. Rejects
 *  anything that is not a plain nonnegative decimal (or integer for steps). */
function metricOrNull(rawValue, kind) {
  const s = typeof rawValue === "string" ? rawValue.trim() : "";
  if (s === "") return null;
  const re = kind === "integer" ? INTEGER_RE : NUMBER_RE;
  if (!re.test(s)) throw new ValidationError("validation_error");
  const value = Number(s);
  // Reject values that overflow to Infinity (e.g. hundreds of digits).
  if (!Number.isFinite(value)) throw new ValidationError("validation_error");
  return value;
}

/** Build the canonical ten-key snapshot for one row. elder_id and data_source
 *  are ALWAYS server-owned; client values are discarded. */
function buildSnapshot(record, elderId) {
  const dateStr =
    typeof record.date === "string" ? record.date.trim() : "";
  // Explicit strict-date check so a bad date is rejected deterministically,
  // independent of Ajv's runtime format-validation behaviour.
  if (!isStrictCalendarDate(dateStr)) {
    throw new ValidationError("validation_error");
  }
  const snapshot = {
    elder_id: elderId,
    date: dateStr,
    data_source: DATA_SOURCE_OVERRIDE,
    heart_rate_avg: metricOrNull(record.heart_rate_avg, "number"),
    resting_heart_rate: metricOrNull(record.resting_heart_rate, "number"),
    steps: metricOrNull(record.steps, "integer"),
    active_minutes: metricOrNull(record.active_minutes, "number"),
    sleep_duration: metricOrNull(record.sleep_duration, "number"),
    wear_time_hours: metricOrNull(record.wear_time_hours, "number"),
    data_quality: metricOrNull(record.data_quality, "number"),
  };
  if (!validateSnapshot(snapshot)) {
    throw new ValidationError("validation_error");
  }
  return snapshot;
}

// ------------------------------ aggregation ---------------------------------

function summarize(snapshots) {
  const dates = snapshots.map((s) => s.date).sort();
  const qualities = snapshots
    .map((s) => s.data_quality)
    .filter((q) => q !== null);

  const date_range =
    dates.length > 0
      ? { start: dates[0], end: dates[dates.length - 1] }
      : null;

  const avgDataQuality =
    qualities.length > 0
      ? qualities.reduce((a, b) => a + b, 0) / qualities.length
      : null;
  const minDataQuality =
    qualities.length > 0 ? Math.min(...qualities) : null;
  const maxDataQuality =
    qualities.length > 0 ? Math.max(...qualities) : null;

  const lowQualityRows = snapshots.filter(
    (s) => s.data_quality !== null && s.data_quality < 50,
  ).length;
  const missingRows = snapshots.filter((s) =>
    NULLABLE_METRICS.some((k) => s[k] === null),
  ).length;

  const warnings = [];
  if (missingRows > 0) {
    warnings.push(
      `${missingRows} row(s) contain one or more missing measurements`,
    );
  }
  if (lowQualityRows > 0) {
    warnings.push(`${lowQualityRows} row(s) have data_quality below 50`);
  }

  return {
    count: snapshots.length,
    snapshots,
    date_range,
    quality_summary: {
      rows: snapshots.length,
      avg_data_quality: avgDataQuality,
      min_data_quality: minDataQuality,
      max_data_quality: maxDataQuality,
      low_quality_rows: lowQualityRows,
    },
    warnings,
  };
}

// -------------------------------- entrypoint --------------------------------

/**
 * Parse and validate a CSV daily-snapshot payload.
 *
 * @param {object}  opts
 * @param {string}  opts.csvText - raw CSV text (<= 64 KiB)
 * @param {string}  opts.elderId - server-authoritative elder id stamped on every row
 * @returns {{count:number,snapshots:object[],date_range:object|null,quality_summary:object,warnings:string[]}}
 * @throws {ValidationError} on any invalid / oversized / malformed input
 */
export function parseDailySnapshotsCsv({ csvText, elderId }) {
  if (typeof csvText !== "string") {
    throw new ValidationError("validation_error");
  }
  if (Buffer.byteLength(csvText, "utf8") > MAX_CSV_BYTES) {
    throw new ValidationError("validation_error");
  }

  // Strip a leading UTF-8 BOM if present.
  const text =
    csvText.length > 0 && csvText.charCodeAt(0) === 0xfeff
      ? csvText.slice(1)
      : csvText;

  const rows = tokenizeCsv(text);
  if (rows.length === 0) {
    throw new ValidationError("validation_error");
  }

  const header = rows[0].map((h) => (typeof h === "string" ? h.trim() : ""));
  const headerSet = new Set(header);
  if (
    header.length !== REQUIRED_HEADERS.length ||
    headerSet.size !== REQUIRED_HEADERS.length
  ) {
    throw new ValidationError("validation_error");
  }
  for (const name of header) {
    if (!REQUIRED_HEADER_SET.has(name)) {
      throw new ValidationError("validation_error");
    }
  }

  const dataRows = rows.slice(1);
  if (dataRows.length === 0) {
    throw new ValidationError("validation_error");
  }
  if (dataRows.length > MAX_DATA_ROWS) {
    throw new ValidationError("validation_error");
  }

  const snapshots = [];
  const seenDates = new Set();
  for (const cells of dataRows) {
    if (cells.length !== header.length) {
      throw new ValidationError("validation_error");
    }
    const record = {};
    header.forEach((name, idx) => {
      record[name] = cells[idx];
    });
    const snapshot = buildSnapshot(record, elderId);
    if (seenDates.has(snapshot.date)) {
      throw new ValidationError("validation_error");
    }
    seenDates.add(snapshot.date);
    snapshots.push(snapshot);
  }

  return summarize(snapshots);
}

export { DATA_SOURCE_OVERRIDE, MAX_CSV_BYTES, MAX_DATA_ROWS };
