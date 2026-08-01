import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const APPLE_HEALTH_TYPES = Object.freeze({
  steps: "HKQuantityTypeIdentifierStepCount",
  heartRate: "HKQuantityTypeIdentifierHeartRate",
  restingHeartRate: "HKQuantityTypeIdentifierRestingHeartRate",
  exercise: "HKQuantityTypeIdentifierAppleExerciseTime",
  sleep: "HKCategoryTypeIdentifierSleepAnalysis",
});

const SUPPORTED_TYPES = new Set(Object.values(APPLE_HEALTH_TYPES));
const ASLEEP_VALUES = new Set([
  "HKCategoryValueSleepAnalysisAsleep",
  "HKCategoryValueSleepAnalysisAsleepCore",
  "HKCategoryValueSleepAnalysisAsleepDeep",
  "HKCategoryValueSleepAnalysisAsleepREM",
  "HKCategoryValueSleepAnalysisAsleepUnspecified",
]);
const CSV_HEADERS = [
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
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?$/;
const MAX_TAG_BYTES = 64 * 1024;
const MAX_DTD_BYTES = 256 * 1024;
const MAX_XML_BYTES = 1024 * 1024 * 1024;
const MAX_SLEEP_INTERVALS = 16_384;
const MAX_XML_DEPTH = 64;
const MAX_RECORDS = 10_000_000;
const MAX_SLEEP_RECORDS = 100_000;
const STRICT_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export class AppleHealthError extends Error {
  constructor(code) {
    super(code);
    this.name = "AppleHealthError";
    this.code = code;
  }
}

const fail = (code) => {
  throw new AppleHealthError(code);
};

const closeDescriptor = (descriptor) => {
  try {
    fs.closeSync(descriptor);
  } catch (error) {
    if (error?.code !== "EBADF") throw error;
  }
};

const isWithin = (candidate, root) => {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};

const samePath = (left, right) => path.relative(path.resolve(left), path.resolve(right)) === "";

const assertPhysicalDirectory = (directory, code) => {
  try {
    const lexical = path.resolve(directory);
    const entry = fs.lstatSync(lexical);
    if (!entry.isDirectory() || entry.isSymbolicLink()) fail(code);
    const canonical = fs.realpathSync(lexical);
    if (!samePath(canonical, lexical)) fail(code);
    return canonical;
  } catch (error) {
    if (error instanceof AppleHealthError) throw error;
    fail(code);
  }
};

export function resolvePrivateAppleHealthInput(inputPath, projectRoot) {
  try {
    const privateRoot = assertPhysicalDirectory(path.resolve(projectRoot, "private_data"), "APPLE_HEALTH_INPUT_REJECTED");
    const root = assertPhysicalDirectory(path.join(privateRoot, "apple_health"), "APPLE_HEALTH_INPUT_REJECTED");
    if (!isWithin(root, privateRoot)) fail("APPLE_HEALTH_INPUT_REJECTED");
    const candidate = fs.realpathSync(path.resolve(inputPath));
    if (!isWithin(candidate, root) || !fs.statSync(candidate).isFile()) fail("APPLE_HEALTH_INPUT_REJECTED");
    return candidate;
  } catch (error) {
    if (error instanceof AppleHealthError) throw error;
    fail("APPLE_HEALTH_INPUT_REJECTED");
  }
}

export function resolvePrivateDerivedOutput(projectRoot) {
  const privateRoot = path.resolve(projectRoot, "private_data");
  const derivedRoot = path.join(privateRoot, "derived");
  const output = path.join(derivedRoot, "apple-health-daily.csv");
  try {
    for (const entry of [privateRoot, derivedRoot, output]) {
      if (fs.existsSync(entry) && fs.lstatSync(entry).isSymbolicLink()) {
        fail("APPLE_HEALTH_OUTPUT_REJECTED");
      }
    }
    return output;
  } catch (error) {
    if (error instanceof AppleHealthError) throw error;
    fail("APPLE_HEALTH_OUTPUT_REJECTED");
  }
}

const getTimestampParts = (value) => {
  if (typeof value !== "string") return null;
  const match = value.match(TIMESTAMP);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, sign, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const localMillis = Date.UTC(year, month - 1, day, hour, minute, second);
  const local = new Date(localMillis);
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second
  ) return null;
  let offsetMinutes = 0;
  if (sign) {
    const offsetHour = Number(offsetHourText);
    const offsetMinute = Number(offsetMinuteText);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return null;
    offsetMinutes = (offsetHour * 60 + offsetMinute) * (sign === "-" ? -1 : 1);
  }
  return {
    dateKey: `${yearText}-${monthText}-${dayText}`,
    instant: new Date(localMillis - offsetMinutes * 60_000),
  };
};

export const parseAppleHealthTimestamp = (value) => getTimestampParts(value)?.instant ?? null;
export const getAppleLocalDateKey = (value) => getTimestampParts(value)?.dateKey ?? null;

const numberInRange = (value, minimum, maximum) => {
  if (typeof value !== "string" || !STRICT_DECIMAL.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
};

const average = (total, count) => count
  ? Number((total / count).toFixed(1))
  : null;

const parseAttributes = (source) => {
  const record = {};
  const attributes = /\s+([A-Za-z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gy;
  let cursor = 0;
  while (cursor < source.length) {
    attributes.lastIndex = cursor;
    const match = attributes.exec(source);
    if (!match) {
      if (/^\s*$/.test(source.slice(cursor))) break;
      return null;
    }
    if (Object.hasOwn(record, match[1])) return null;
    record[match[1]] = match[2] ?? match[3];
    cursor = attributes.lastIndex;
  }
  return record;
};

const newWarningCounts = () => ({
  invalid_timestamp: 0,
  invalid_metric: 0,
  unsupported_unit: 0,
  mixed_step_sources: 0,
});

const newRecordCounts = () => ({
  steps: 0,
  heart_rate: 0,
  resting_heart_rate: 0,
  exercise_time: 0,
  sleep: 0,
});

const newDay = (date) => ({
  date,
  watchSteps: 0,
  otherSteps: 0,
  hasWatchSteps: false,
  hasOtherSteps: false,
  heartRateTotal: 0,
  heartRateCount: 0,
  restingHeartRateTotal: 0,
  restingHeartRateCount: 0,
  activeMinutes: 0,
  hasExercise: false,
  sleepMilliseconds: 0,
  hasSleep: false,
});

const ensureDay = (state, date) => {
  if (state.days.has(date)) return state.days.get(date);
  if (state.days.size >= state.limitDays) {
    const oldestDate = [...state.days.keys()].sort()[0];
    if (date <= oldestDate) return null;
    state.days.delete(oldestDate);
  }
  state.days.set(date, newDay(date));
  return state.days.get(date);
};

const addSleepInterval = (intervals, next) => {
  let low = 0;
  let high = intervals.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (intervals[middle].end < next.start) low = middle + 1;
    else high = middle;
  }
  let index = low;
  if (index === intervals.length) {
    intervals.push(next);
  } else {
    while (index < intervals.length && intervals[index].start <= next.end) {
      if (intervals[index].end > next.end) next.wakeDate = intervals[index].wakeDate;
      next.start = Math.min(next.start, intervals[index].start);
      next.end = Math.max(next.end, intervals[index].end);
      intervals.splice(index, 1);
    }
    intervals.splice(index, 0, next);
  }
  if (intervals.length > MAX_SLEEP_INTERVALS) fail("APPLE_HEALTH_COMPLEXITY_LIMIT");
};

const unitMatches = (unit, accepted) => accepted.includes(String(unit ?? "").trim().toLowerCase());

const exerciseMinutes = (value, unit) => {
  const number = numberInRange(value, 0, Number.MAX_SAFE_INTEGER);
  if (number === null) return { value: null, unsupported: false };
  const normalized = String(unit ?? "").trim().toLowerCase();
  let minutes;
  if (["min", "minute", "minutes"].includes(normalized)) minutes = number;
  else if (["s", "sec", "second", "seconds"].includes(normalized)) minutes = number / 60;
  else if (["h", "hr", "hour", "hours"].includes(normalized)) minutes = number * 60;
  else return { value: null, unsupported: true };
  return minutes <= 1440
    ? { value: minutes, unsupported: false }
    : { value: null, unsupported: false };
};

const processRecord = (record, state) => {
  if (!SUPPORTED_TYPES.has(record.type)) return;
  const start = getTimestampParts(record.startDate);
  if (!start) {
    state.warningCounts.invalid_timestamp += 1;
    return;
  }

  if (record.type === APPLE_HEALTH_TYPES.steps) {
    state.recordCounts.steps += 1;
    if (!unitMatches(record.unit, ["count"])) {
      state.warningCounts.unsupported_unit += 1;
      return;
    }
    const value = numberInRange(record.value, 0, 200_000);
    if (value === null) {
      state.warningCounts.invalid_metric += 1;
      return;
    }
    const day = ensureDay(state, start.dateKey);
    if (!day) return;
    if (`${record.sourceName ?? ""} ${record.device ?? ""}`.toLowerCase().includes("watch")) {
      day.watchSteps += value;
      day.hasWatchSteps = true;
    } else {
      day.otherSteps += value;
      day.hasOtherSteps = true;
    }
    return;
  }

  if (record.type === APPLE_HEALTH_TYPES.heartRate) {
    state.recordCounts.heart_rate += 1;
    if (!unitMatches(record.unit, ["count/min", "count/minute"])) {
      state.warningCounts.unsupported_unit += 1;
      return;
    }
    const value = numberInRange(record.value, 20, 250);
    if (value === null) state.warningCounts.invalid_metric += 1;
    else {
      const day = ensureDay(state, start.dateKey);
      if (!day) return;
      day.heartRateTotal += value;
      day.heartRateCount += 1;
    }
    return;
  }

  if (record.type === APPLE_HEALTH_TYPES.restingHeartRate) {
    state.recordCounts.resting_heart_rate += 1;
    if (!unitMatches(record.unit, ["count/min", "count/minute"])) {
      state.warningCounts.unsupported_unit += 1;
      return;
    }
    const value = numberInRange(record.value, 20, 200);
    if (value === null) state.warningCounts.invalid_metric += 1;
    else {
      const day = ensureDay(state, start.dateKey);
      if (!day) return;
      day.restingHeartRateTotal += value;
      day.restingHeartRateCount += 1;
    }
    return;
  }

  if (record.type === APPLE_HEALTH_TYPES.exercise) {
    state.recordCounts.exercise_time += 1;
    const normalized = exerciseMinutes(record.value, record.unit);
    if (normalized.unsupported) state.warningCounts.unsupported_unit += 1;
    else if (normalized.value === null) state.warningCounts.invalid_metric += 1;
    else {
      const day = ensureDay(state, start.dateKey);
      if (!day) return;
      day.activeMinutes = Math.min(1440, day.activeMinutes + normalized.value);
      day.hasExercise = true;
    }
    return;
  }

  state.recordCounts.sleep += 1;
  state.sleepRecordCount += 1;
  if (state.sleepRecordCount > MAX_SLEEP_RECORDS) fail("APPLE_HEALTH_COMPLEXITY_LIMIT");
  if (!ASLEEP_VALUES.has(record.value)) return;
  const end = getTimestampParts(record.endDate);
  if (!end || end.instant <= start.instant || end.instant - start.instant > 24 * 3_600_000) {
    state.warningCounts.invalid_timestamp += 1;
    return;
  }
  addSleepInterval(state.sleepIntervals, {
    start: start.instant.getTime(),
    end: end.instant.getTime(),
    wakeDate: end.dateKey,
  });
};

const makeSnapshot = (day, warningCounts) => {
  if (day.hasWatchSteps && day.hasOtherSteps) warningCounts.mixed_step_sources += 1;
  const sleepHours = day.hasSleep
    ? Math.min(24, day.sleepMilliseconds / 3_600_000)
    : null;
  const rawSteps = day.hasWatchSteps ? Math.round(day.watchSteps) : day.hasOtherSteps ? Math.round(day.otherSteps) : null;
  const steps = rawSteps !== null && rawSteps <= 200_000 ? rawSteps : null;
  if (rawSteps !== null && steps === null) warningCounts.invalid_metric += 1;
  const quality = Math.min(
    100,
    (steps !== null ? 25 : 0) +
      (day.heartRateCount ? 25 : 0) +
      (day.hasSleep ? 25 : 0) +
      (day.hasExercise ? 15 : 0) +
      (day.restingHeartRateCount ? 10 : 0),
  );
  return {
    elder_id: "TEST001",
    date: day.date,
    data_source: "Apple Health Local Aggregate",
    heart_rate_avg: average(day.heartRateTotal, day.heartRateCount),
    resting_heart_rate: average(day.restingHeartRateTotal, day.restingHeartRateCount),
    steps,
    active_minutes: day.hasExercise ? Number(day.activeMinutes.toFixed(1)) : null,
    sleep_duration: sleepHours === null ? null : Number(sleepHours.toFixed(2)),
    wear_time_hours: null,
    data_quality: quality,
  };
};

const findMarkupEnd = (buffer) => {
  let quote = null;
  for (let index = 1; index < buffer.length; index += 1) {
    const character = buffer[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === ">") return index;
  }
  return -1;
};

const findDoctypeEnd = (buffer) => {
  let quote = null;
  let subsetDepth = 0;
  for (let index = "<!DOCTYPE".length; index < buffer.length; index += 1) {
    const character = buffer[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "[") subsetDepth += 1;
    else if (character === "]") {
      subsetDepth -= 1;
      if (subsetDepth < 0) return -2;
    } else if (character === ">" && subsetDepth === 0) return index;
  }
  return -1;
};

const consumeTags = (state, text, final = false) => {
  state.buffer += text;
  while (true) {
    const start = state.buffer.indexOf("<");
    if (start === -1) {
      if (!state.stack.length && state.buffer.trim()) fail("APPLE_HEALTH_INVALID_XML");
      state.buffer = "";
      if (final && (!state.rootSeen || !state.rootClosed || state.stack.length)) {
        fail("APPLE_HEALTH_INVALID_XML");
      }
      return;
    }
    if (start > 0) {
      if (!state.stack.length && state.buffer.slice(0, start).trim()) fail("APPLE_HEALTH_INVALID_XML");
      state.buffer = state.buffer.slice(start);
    }

    const boundedSpecial = (terminator) => {
      const end = state.buffer.indexOf(terminator);
      if (end === -1) {
        if (Buffer.byteLength(state.buffer, "utf8") > MAX_TAG_BYTES || final) fail("APPLE_HEALTH_INVALID_XML");
        return false;
      }
      if (Buffer.byteLength(state.buffer.slice(0, end + terminator.length), "utf8") > MAX_TAG_BYTES) {
        fail("APPLE_HEALTH_TAG_TOO_LARGE");
      }
      state.buffer = state.buffer.slice(end + terminator.length);
      return true;
    };
    if (state.buffer.startsWith("<!--")) {
      if (!boundedSpecial("-->")) return;
      continue;
    }
    if (state.buffer.startsWith("<![CDATA[")) {
      if (!state.stack.length || state.rootClosed) fail("APPLE_HEALTH_INVALID_XML");
      if (!boundedSpecial("]]>") ) return;
      continue;
    }
    if (state.buffer.startsWith("<?")) {
      if (!boundedSpecial("?>")) return;
      continue;
    }
    if (state.buffer.startsWith("<!DOCTYPE")) {
      if (state.rootSeen || state.doctypeSeen) fail("APPLE_HEALTH_INVALID_XML");
      const doctypeEnd = findDoctypeEnd(state.buffer);
      if (doctypeEnd === -2) fail("APPLE_HEALTH_INVALID_XML");
      if (doctypeEnd === -1) {
        if (Buffer.byteLength(state.buffer, "utf8") > MAX_DTD_BYTES || final) fail("APPLE_HEALTH_INVALID_XML");
        return;
      }
      const doctype = state.buffer.slice(0, doctypeEnd + 1);
      if (
        Buffer.byteLength(doctype, "utf8") > MAX_DTD_BYTES ||
        !/^<!DOCTYPE\s+HealthData(?:\s*\[[\s\S]*\])?\s*>$/.test(doctype) ||
        /\b(?:SYSTEM|PUBLIC)\b|<!ENTITY\b/i.test(doctype)
      ) fail("APPLE_HEALTH_INVALID_XML");
      state.doctypeSeen = true;
      state.buffer = state.buffer.slice(doctypeEnd + 1);
      continue;
    }
    if (!final && "<!DOCTYPE".startsWith(state.buffer)) return;
    if (state.buffer.startsWith("<!")) fail("APPLE_HEALTH_INVALID_XML");

    const end = findMarkupEnd(state.buffer);
    if (end === -1) {
      if (Buffer.byteLength(state.buffer, "utf8") > MAX_TAG_BYTES) fail("APPLE_HEALTH_TAG_TOO_LARGE");
      if (final) fail("APPLE_HEALTH_INVALID_XML");
      return;
    }
    if (Buffer.byteLength(state.buffer.slice(0, end + 1), "utf8") > MAX_TAG_BYTES) {
      fail("APPLE_HEALTH_TAG_TOO_LARGE");
    }
    const markup = state.buffer.slice(0, end + 1);
    state.buffer = state.buffer.slice(end + 1);

    const closing = markup.match(/^<\/([A-Za-z0-9_:-]+)\s*>$/);
    if (closing) {
      if (state.stack.at(-1) !== closing[1]) fail("APPLE_HEALTH_INVALID_XML");
      state.stack.pop();
      if (closing[1] === "HealthData") state.rootClosed = true;
      continue;
    }

    const opening = markup.match(/^<([A-Za-z0-9_:-]+)([\s\S]*?)(\/?)>$/);
    if (!opening) fail("APPLE_HEALTH_INVALID_XML");
    const [, name, attributeSource, slash] = opening;
    const attributes = parseAttributes(attributeSource);
    if (!attributes) fail("APPLE_HEALTH_INVALID_XML");
    const selfClosing = slash === "/";
    if (!state.rootSeen) {
      if (name !== "HealthData" || selfClosing) fail("APPLE_HEALTH_INVALID_XML");
      state.rootSeen = true;
      state.stack.push(name);
      continue;
    }
    if (state.rootClosed || !state.stack.length) fail("APPLE_HEALTH_INVALID_XML");
    if (name === "HealthData") fail("APPLE_HEALTH_INVALID_XML");
    if (name === "Record" && state.stack.length === 1) {
      state.recordCount += 1;
      if (state.recordCount > MAX_RECORDS) fail("APPLE_HEALTH_COMPLEXITY_LIMIT");
      processRecord(attributes, state);
    }
    if (!selfClosing) {
      if (state.stack.length >= MAX_XML_DEPTH) fail("APPLE_HEALTH_COMPLEXITY_LIMIT");
      state.stack.push(name);
    }
  }
};

export async function analyzeAppleHealthXmlFile(filePath, options = {}) {
  const requestedLimit = Number(options.limitDays ?? 14);
  const limitDays = Number.isInteger(requestedLimit) && requestedLimit >= 1 && requestedLimit <= 366 ? requestedLimit : 14;
  let stat;
  let descriptor;
  try {
    if (fs.lstatSync(filePath).isSymbolicLink()) fail("APPLE_HEALTH_INPUT_REJECTED");
    descriptor = fs.openSync(filePath, "r");
    stat = fs.fstatSync(descriptor);
    const current = fs.statSync(filePath);
    if (
      stat.dev !== current.dev ||
      stat.ino !== current.ino ||
      stat.nlink !== 1 ||
      fs.realpathSync(filePath) !== path.resolve(filePath)
    ) fail("APPLE_HEALTH_INPUT_REJECTED");
  } catch {
    if (descriptor !== undefined) closeDescriptor(descriptor);
    fail("APPLE_HEALTH_INPUT_REJECTED");
  }
  if (!stat.isFile() || stat.size > MAX_XML_BYTES) {
    closeDescriptor(descriptor);
    fail("APPLE_HEALTH_INPUT_REJECTED");
  }
  const state = {
    days: new Map(),
    limitDays,
    warningCounts: newWarningCounts(),
    recordCounts: newRecordCounts(),
    buffer: "",
    bytesRead: 0,
    rootSeen: false,
    rootClosed: false,
    doctypeSeen: false,
    recordCount: 0,
    sleepRecordCount: 0,
    stack: [],
    sleepIntervals: [],
  };
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    const chunk = Buffer.allocUnsafe(64 * 1024);
    while (true) {
      const bytesRead = fs.readSync(descriptor, chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      state.bytesRead += bytesRead;
      if (state.bytesRead > MAX_XML_BYTES) fail("APPLE_HEALTH_INPUT_REJECTED");
      consumeTags(state, decoder.decode(chunk.subarray(0, bytesRead), { stream: true }));
    }
    consumeTags(state, decoder.decode(), true);
  } catch (error) {
    if (error instanceof AppleHealthError) throw error;
    if (error instanceof TypeError) fail("APPLE_HEALTH_INVALID_ENCODING");
    fail("APPLE_HEALTH_INPUT_REJECTED");
  } finally {
    closeDescriptor(descriptor);
  }

  for (const interval of state.sleepIntervals) {
    const day = ensureDay(state, interval.wakeDate);
    if (!day) continue;
    day.hasSleep = true;
    day.sleepMilliseconds += interval.end - interval.start;
  }

  const allSnapshots = [...state.days.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((day) => makeSnapshot(day, state.warningCounts));
  const snapshots = allSnapshots;
  const dateRange = {
    start: snapshots[0]?.date ?? null,
    end: snapshots.at(-1)?.date ?? null,
  };
  return {
    snapshots,
    preview: {
      days_detected: allSnapshots.length,
      date_range: dateRange,
      record_counts: state.recordCounts,
      warning_counts: state.warningCounts,
      sample_daily_snapshots: snapshots.slice(-5),
    },
  };
}

const csvValue = (value) => {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function snapshotsToCsv(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) fail("APPLE_HEALTH_NO_DATA");
  return [
    CSV_HEADERS.join(","),
    ...snapshots.map((snapshot) => CSV_HEADERS.map((header) => csvValue(snapshot[header])).join(",")),
  ].join("\n");
}

export function writePrivateDerivedCsv(projectRoot, csvText) {
  const privateRoot = path.resolve(projectRoot, "private_data");
  const derivedRoot = path.join(privateRoot, "derived");
  if (fs.existsSync(privateRoot) && fs.lstatSync(privateRoot).isSymbolicLink()) {
    fail("APPLE_HEALTH_OUTPUT_REJECTED");
  }
  fs.mkdirSync(derivedRoot, { recursive: true, mode: 0o700 });
  const privateReal = assertPhysicalDirectory(privateRoot, "APPLE_HEALTH_OUTPUT_REJECTED");
  const derivedReal = assertPhysicalDirectory(derivedRoot, "APPLE_HEALTH_OUTPUT_REJECTED");
  if (!isWithin(derivedReal, privateReal) || !samePath(derivedReal, path.join(privateReal, "derived"))) {
    fail("APPLE_HEALTH_OUTPUT_REJECTED");
  }
  const target = path.join(derivedRoot, "apple-health-daily.csv");
  if (fs.existsSync(target)) {
    const existing = fs.lstatSync(target);
    if (!existing.isFile() || existing.nlink !== 1) fail("APPLE_HEALTH_OUTPUT_REJECTED");
  }

  const temporary = path.join(derivedRoot, `.apple-health-daily.${randomUUID()}.tmp`);
  let descriptor;
  let temporaryIdentity;
  let createdTemporary = false;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    createdTemporary = true;
    temporaryIdentity = fs.fstatSync(descriptor);
    if (
      !temporaryIdentity.isFile() ||
      temporaryIdentity.nlink !== 1 ||
      !samePath(fs.realpathSync(temporary), temporary) ||
      !samePath(assertPhysicalDirectory(privateRoot, "APPLE_HEALTH_OUTPUT_REJECTED"), privateReal) ||
      !samePath(assertPhysicalDirectory(derivedRoot, "APPLE_HEALTH_OUTPUT_REJECTED"), derivedReal)
    ) fail("APPLE_HEALTH_OUTPUT_REJECTED");
    fs.writeFileSync(descriptor, csvText, { encoding: "utf8" });
    fs.fchmodSync(descriptor, 0o600);
    fs.fsyncSync(descriptor);
    closeDescriptor(descriptor);
    descriptor = undefined;
    if (
      !samePath(assertPhysicalDirectory(privateRoot, "APPLE_HEALTH_OUTPUT_REJECTED"), privateReal) ||
      !samePath(assertPhysicalDirectory(derivedRoot, "APPLE_HEALTH_OUTPUT_REJECTED"), derivedReal)
    ) fail("APPLE_HEALTH_OUTPUT_REJECTED");
    fs.renameSync(temporary, target);
    createdTemporary = false;
    return target;
  } catch (error) {
    if (descriptor !== undefined) closeDescriptor(descriptor);
    if (createdTemporary && fs.existsSync(temporary)) {
      const current = fs.lstatSync(temporary);
      if (temporaryIdentity && current.dev === temporaryIdentity.dev && current.ino === temporaryIdentity.ino) {
        fs.rmSync(temporary, { force: true });
      }
    }
    if (error instanceof AppleHealthError) throw error;
    fail("APPLE_HEALTH_OUTPUT_REJECTED");
  }
}
