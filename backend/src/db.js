import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { SAFETY_DISCLAIMER } from "./constants.js";
import { eventSchema } from "./validators.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");

const resolveDatabasePath = () => {
  const configured = process.env.DATABASE_PATH;
  if (!configured) return path.join(backendRoot, "data", "careband.sqlite");
  if (configured === ":memory:") return configured;
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(backendRoot, configured);
};

export const DEMO_BASELINES = {
  E001: {
    elder_id: "E001",
    avg_steps_7d: 2150,
    avg_sleep_7d: 6.5,
    avg_active_minutes_7d: 46,
    resting_hr_baseline: 72,
    baseline_confidence: 91,
  },
  E002: {
    elder_id: "E002",
    avg_steps_7d: 1680,
    avg_sleep_7d: 6.2,
    avg_active_minutes_7d: 38,
    resting_hr_baseline: 76,
    baseline_confidence: 88,
  },
  E003: {
    elder_id: "E003",
    avg_steps_7d: 2450,
    avg_sleep_7d: 6.9,
    avg_active_minutes_7d: 58,
    resting_hr_baseline: 70,
    baseline_confidence: 86,
  },
  E004: {
    elder_id: "E004",
    avg_steps_7d: 1900,
    avg_sleep_7d: 7.1,
    avg_active_minutes_7d: 42,
    resting_hr_baseline: 68,
    baseline_confidence: 94,
  },
  TEST001: {
    elder_id: "TEST001",
    avg_steps_7d: 1800,
    avg_sleep_7d: 6.5,
    avg_active_minutes_7d: 40,
    resting_hr_baseline: 72,
    baseline_confidence: 20,
    baseline_label: "基線建立中",
    usable_days: 0,
  },
};

let connection;

export const nowIso = () => new Date().toISOString();

export const parseJson = (value, fallback) => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

export const stringifyJson = (value) => JSON.stringify(value ?? {});

export function getDb() {
  if (connection) return connection;

  const dbPath = resolveDatabasePath();
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  connection = new Database(dbPath);
  connection.pragma("journal_mode = WAL");
  connection.pragma("foreign_keys = ON");

  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  connection.exec(schema);
  runMigrations(connection);
  seedDemoData(connection);
  normalizeStoredData(connection);

  return connection;
}

const tableColumns = (db, tableName) =>
  new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name));

const ensureColumn = (db, tableName, columnName, definition) => {
  if (tableColumns(db, tableName).has(columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
};

function runMigrations(db) {
  const migrate = db.transaction(() => {
    ensureColumn(db, "elders", "subject_kind", "TEXT NOT NULL DEFAULT 'elder'");
    ensureColumn(db, "events", "received_at", "TEXT");
    ensureColumn(db, "events", "severity_hint", "TEXT NOT NULL DEFAULT 'info'");
    ensureColumn(db, "events", "data_quality", "TEXT NOT NULL DEFAULT 'medium'");
    ensureColumn(db, "events", "status", "TEXT NOT NULL DEFAULT 'open'");
    ensureColumn(db, "events", "resolved_at", "TEXT");
    ensureColumn(db, "events", "resolved_by", "TEXT");
    ensureColumn(db, "events", "linked_task_id", "TEXT");
    ensureColumn(db, "tasks", "updated_at", "TEXT");
    ensureColumn(db, "agent_runs", "requested_provider", "TEXT");

    db.prepare(
      `DELETE FROM snapshots
       WHERE rowid NOT IN (
         SELECT MAX(rowid) FROM snapshots GROUP BY elder_id, date
       )`,
    ).run();
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_elder_date_unique ON snapshots (elder_id, date)",
    );
    db.prepare(
      `UPDATE snapshots
       SET data_source = CASE LOWER(TRIM(data_source))
         WHEN 'csv' THEN 'CSV Import'
         WHEN 'apple health' THEN 'Apple Health Export'
         WHEN 'apple watch' THEN 'Apple Health Export'
         WHEN 'demo' THEN 'Demo Seed'
         WHEN 'mock' THEN 'Demo Seed'
         ELSE data_source
       END`,
    ).run();

    db.prepare("UPDATE elders SET subject_kind = 'team_test' WHERE elder_id = 'TEST001'").run();
    db.prepare("UPDATE tasks SET status = 'open' WHERE status = 'pending'").run();
    db.prepare("UPDATE tasks SET status = 'resolved' WHERE status = 'completed'").run();
    db.prepare(
      "UPDATE tasks SET updated_at = COALESCE(updated_at, completed_at, created_at)",
    ).run();
    db.prepare(
      "UPDATE agent_runs SET requested_provider = COALESCE(requested_provider, provider)",
    ).run();
    db.prepare("UPDATE agent_outputs SET status_level = 'observation' WHERE status_level = 'observe'").run();
    db.prepare(
      "UPDATE agent_outputs SET status_level = 'data_insufficient' WHERE status_level = 'insufficient_data'",
    ).run();

    db.prepare(
      `INSERT OR IGNORE INTO schema_migrations (migration_id, applied_at)
       VALUES (?, ?)`,
    ).run("2026-07-11-core-contract-v1", nowIso());
  });

  migrate();
}

function normalizeStoredData(db) {
  const rows = db.prepare("SELECT * FROM events").all();
  const update = db.prepare(
    `UPDATE events
     SET event_type = @event_type,
         source = @source,
         raw_text = @raw_text,
         payload = @payload,
         received_at = @received_at,
         severity_hint = @severity_hint,
         data_quality = @data_quality,
         status = @status
     WHERE event_id = @event_id`,
  );

  const normalize = db.transaction(() => {
    for (const row of rows) {
      const event = eventSchema.parse({
        ...row,
        occurred_at: row.timestamp,
        received_at: row.received_at || row.created_at || row.timestamp,
        payload: parseJson(row.payload, {}),
      });
      update.run({
        event_id: row.event_id,
        event_type: event.event_type,
        source: event.source,
        raw_text: event.raw_text,
        payload: stringifyJson(event.payload),
        received_at: row.received_at || row.created_at || row.timestamp,
        severity_hint: row.severity_hint === "info" ? event.severity_hint : row.severity_hint,
        data_quality: row.data_quality || event.data_quality,
        status: row.status || "open",
      });
    }
  });

  normalize();
  db.prepare("UPDATE elders SET subject_kind = 'team_test' WHERE elder_id = 'TEST001'").run();
}

function seedDemoData(db) {
  const demoCount = db
    .prepare("SELECT COUNT(*) AS count FROM elders WHERE elder_id IN ('E001', 'E002', 'E003', 'E004')")
    .get().count;
  if (demoCount === 4) {
    ensureTestElder(db);
    return;
  }

  const createdAt = "2026-06-19T08:00:00+08:00";
  const elders = [
    {
      elder_id: "E001",
      name: "陈伯",
      age: 78,
      room: "203",
      risk_tags: ["轻度跌倒风险", "用药需提醒", "活动下降"],
    },
    {
      elder_id: "E002",
      name: "李婆婆",
      age: 82,
      room: "205",
      risk_tags: ["夜间离床关注", "睡眠偏低"],
    },
    {
      elder_id: "E003",
      name: "黄叔",
      age: 76,
      room: "201",
      risk_tags: ["活动趋势观察", "冠心病史"],
    },
    {
      elder_id: "E004",
      name: "梁婆婆",
      age: 74,
      room: "206",
      risk_tags: ["常规观察"],
    },
  ];

  const snapshots = [
    {
      snapshot_id: "SNAP-E001-SEED",
      elder_id: "E001",
      date: "2026-06-19",
      data_source: "Demo Seed",
      heart_rate_avg: 86,
      resting_heart_rate: 72,
      steps: 820,
      active_minutes: 18,
      sleep_duration: 4.8,
      wear_time_hours: 18.5,
      data_quality: 82,
      created_at: "2026-06-19T07:05:00+08:00",
    },
    {
      snapshot_id: "SNAP-E002-SEED",
      elder_id: "E002",
      date: "2026-06-19",
      data_source: "Demo Seed",
      heart_rate_avg: 82,
      resting_heart_rate: 76,
      steps: 1180,
      active_minutes: 25,
      sleep_duration: 4.4,
      wear_time_hours: 19.2,
      data_quality: 87,
      created_at: "2026-06-19T07:02:00+08:00",
    },
    {
      snapshot_id: "SNAP-E003-SEED",
      elder_id: "E003",
      date: "2026-06-19",
      data_source: "Demo Seed",
      heart_rate_avg: 75,
      resting_heart_rate: 70,
      steps: 1050,
      active_minutes: 30,
      sleep_duration: 6.4,
      wear_time_hours: 17.8,
      data_quality: 80,
      created_at: "2026-06-19T06:58:00+08:00",
    },
    {
      snapshot_id: "SNAP-E004-SEED",
      elder_id: "E004",
      date: "2026-06-19",
      data_source: "Demo Seed",
      heart_rate_avg: 69,
      resting_heart_rate: 68,
      steps: 1840,
      active_minutes: 41,
      sleep_duration: 7,
      wear_time_hours: 20.1,
      data_quality: 93,
      created_at: "2026-06-19T07:04:00+08:00",
    },
  ];

  const events = [
    {
      event_id: "EVT-E001-ACTIVITY-LOW",
      elder_id: "E001",
      event_type: "low_activity",
      timestamp: "2026-06-19T12:30:00+08:00",
      source: "system",
      raw_text: "活动量明显低于本人近期基线",
      payload: { activity_drop_percent: 62 },
      created_at: "2026-06-19T12:30:00+08:00",
    },
    {
      event_id: "EVT-E001-MED-PM-REMINDER",
      elder_id: "E001",
      event_type: "medication_reminder",
      timestamp: "2026-06-19T20:00:00+08:00",
      source: "system",
      raw_text: "晚药提醒，暂未确认",
      payload: { medication_confirmed: false },
      created_at: "2026-06-19T20:00:00+08:00",
    },
    {
      event_id: "EVT-E002-NIGHT-AWAY",
      elder_id: "E002",
      event_type: "night_wakeup",
      timestamp: "2026-06-19T03:20:00+08:00",
      source: "mock_wearable",
      raw_text: "夜间离床次数增加",
      payload: { night_wakeup_count: 4 },
      created_at: "2026-06-19T03:20:00+08:00",
    },
    {
      event_id: "EVT-E003-ACTIVITY-TREND",
      elder_id: "E003",
      event_type: "low_activity",
      timestamp: "2026-06-19T17:40:00+08:00",
      source: "system",
      raw_text: "活动量连续两天下降",
      payload: { activity_drop_percent: 57 },
      created_at: "2026-06-19T17:40:00+08:00",
    },
    {
      event_id: "EVT-E004-STABLE",
      elder_id: "E004",
      event_type: "system_risk_update",
      timestamp: "2026-06-19T18:10:00+08:00",
      source: "system",
      raw_text: "今日状态接近个人基线",
      payload: {},
      created_at: "2026-06-19T18:10:00+08:00",
    },
  ];

  const tasks = [
    {
      task_id: "TASK-E002-SLEEP",
      elder_id: "E002",
      source_event_id: "EVT-E002-NIGHT-AWAY",
      priority: "medium",
      task_title: "李婆婆睡眠与夜间离床需关注",
      task_reason: "睡眠偏低 + 夜间离床次数增加",
      recommended_action: "请护工晚间巡查时确认休息情况，必要时提醒减少夜间走动风险。",
      status: "in_progress",
      handled_by: "护工A",
      handled_note: null,
      created_at: "2026-06-19T08:10:00+08:00",
      completed_at: null,
    },
  ];

  const seedRisk = {
    E001: {
      status_level: "attention",
      risk_score: 62,
      key_reasons: ["步數較個人基線下降約 62%，睡眠較基線下降約 26%。"],
      recommended_action: "建議護工今日內查看狀態，並確認休息、活動與用藥情況。",
    },
    E002: {
      status_level: "observation",
      risk_score: 38,
      key_reasons: [
        "睡眠較個人基線下降約 29%。",
        "有一項輕度偏離個人基線。第一版以靜息心率而非平均心率比較基線。",
      ],
      recommended_action: "建議護工在例行巡查中關注變化，必要時複核資料。",
    },
    E003: {
      status_level: "observation",
      risk_score: 38,
      key_reasons: [
        "步數較個人基線下降約 57%。",
        "有一項輕度偏離個人基線。第一版以靜息心率而非平均心率比較基線。",
      ],
      recommended_action: "建議護工在例行巡查中關注變化，必要時複核資料。",
    },
    E004: {
      status_level: "stable",
      risk_score: 12,
      key_reasons: ["今日關鍵指標接近個人基線。"],
      recommended_action: "保持常規照護與日常觀察。",
    },
  };

  const agentOutputs = elders.map((elder) => {
    const risk = seedRisk[elder.elder_id];
    const stable = risk.status_level === "stable";
    return {
      output_id: `AGENT-${elder.elder_id}-SEED`,
      elder_id: elder.elder_id,
      source_event_id: null,
      status_level: risk.status_level,
      risk_score: risk.risk_score,
      caregiver_summary:
        stable
          ? `${elder.name}今日指标接近个人基线，保持常规照护。`
          : `${elder.name}今日有一项以上指标偏离个人基线，建议护工在巡查中确认状态。`,
      family_summary:
        stable
          ? `${elder.name}今日状态平稳，中心会继续常规观察。`
          : `${elder.name}今日有需要关注的变化，照护人员会继续跟进。`,
      institution_summary:
        stable
          ? `${elder.name}可维持常规观察。`
          : `${elder.name}建议纳入今日巡查关注列表。`,
      recommended_action: risk.recommended_action,
      safety_disclaimer: SAFETY_DISCLAIMER,
      key_reasons: stringifyJson(risk.key_reasons),
      agent_source: "mock",
      warning: null,
      created_at: "2026-06-19T20:10:00+08:00",
    };
  });

  const insertElder = db.prepare(
    `INSERT INTO elders (elder_id, name, age, room, risk_tags, created_at)
     VALUES (@elder_id, @name, @age, @room, @risk_tags, @created_at)`,
  );
  const insertSnapshot = db.prepare(
    `INSERT INTO snapshots (
      snapshot_id, elder_id, date, data_source, heart_rate_avg,
      resting_heart_rate, steps, active_minutes, sleep_duration,
      wear_time_hours, data_quality, created_at
    ) VALUES (
      @snapshot_id, @elder_id, @date, @data_source, @heart_rate_avg,
      @resting_heart_rate, @steps, @active_minutes, @sleep_duration,
      @wear_time_hours, @data_quality, @created_at
    )`,
  );
  const insertEvent = db.prepare(
    `INSERT INTO events (
      event_id, elder_id, event_type, timestamp, source, raw_text, payload, created_at
    ) VALUES (
      @event_id, @elder_id, @event_type, @timestamp, @source, @raw_text, @payload, @created_at
    )`,
  );
  const insertTask = db.prepare(
    `INSERT INTO tasks (
      task_id, elder_id, source_event_id, priority, task_title, task_reason,
      recommended_action, status, handled_by, handled_note, created_at, completed_at
    ) VALUES (
      @task_id, @elder_id, @source_event_id, @priority, @task_title, @task_reason,
      @recommended_action, @status, @handled_by, @handled_note, @created_at, @completed_at
    )`,
  );
  const insertAgentOutput = db.prepare(
    `INSERT INTO agent_outputs (
      output_id, elder_id, source_event_id, status_level, risk_score,
      caregiver_summary, family_summary, institution_summary, recommended_action,
      safety_disclaimer, key_reasons, agent_source, warning, created_at
    ) VALUES (
      @output_id, @elder_id, @source_event_id, @status_level, @risk_score,
      @caregiver_summary, @family_summary, @institution_summary, @recommended_action,
      @safety_disclaimer, @key_reasons, @agent_source, @warning, @created_at
    )`,
  );

  const seed = db.transaction(() => {
    for (const elder of elders) {
      insertElder.run({
        ...elder,
        risk_tags: stringifyJson(elder.risk_tags),
        created_at: createdAt,
      });
    }
    for (const snapshot of snapshots) insertSnapshot.run(snapshot);
    for (const event of events) {
      insertEvent.run({ ...event, payload: stringifyJson(event.payload) });
    }
    for (const task of tasks) insertTask.run(task);
    for (const output of agentOutputs) insertAgentOutput.run(output);
  });

  seed();
  ensureTestElder(db);
}

function ensureTestElder(db) {
  const exists = db.prepare("SELECT elder_id FROM elders WHERE elder_id = ?").get("TEST001");
  if (exists) {
    db.prepare("UPDATE elders SET subject_kind = 'team_test' WHERE elder_id = 'TEST001'").run();
    return;
  }

  db.prepare(
    `INSERT INTO elders (elder_id, name, age, room, risk_tags, subject_kind, created_at)
     VALUES (@elder_id, @name, @age, @room, @risk_tags, @subject_kind, @created_at)`,
  ).run({
    elder_id: "TEST001",
    name: "團隊測試資料",
    age: 30,
    room: "TEST",
    risk_tags: stringifyJson(["團隊成員 Apple Watch 測試資料", "非真實長者資料"]),
    subject_kind: "team_test",
    created_at: nowIso(),
  });
}

const averageField = (rows, field, fallback) => {
  const values = rows
    .map((row) => row[field])
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return fallback;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
};

function getSnapshotBaseline(elderId, excludeDate) {
  const db = getDb();
  const latestDate =
    excludeDate ??
    db.prepare("SELECT date FROM snapshots WHERE elder_id = ? ORDER BY date DESC LIMIT 1").get(elderId)
      ?.date;
  const fallback = DEMO_BASELINES[elderId] ?? {
    elder_id: elderId,
    avg_steps_7d: 1800,
    avg_sleep_7d: 6.5,
    avg_active_minutes_7d: 40,
    resting_hr_baseline: 72,
    baseline_confidence: 70,
  };
  const rows = latestDate
    ? db
        .prepare(
          `SELECT * FROM snapshots
           WHERE elder_id = ? AND data_quality >= 40 AND date < ?
           ORDER BY date DESC, created_at DESC
           LIMIT 7`,
        )
        .all(elderId, latestDate)
    : [];
  const enoughDays = rows.length >= 3;

  return {
    elder_id: elderId,
    avg_steps_7d: averageField(rows, "steps", fallback.avg_steps_7d),
    avg_sleep_7d: averageField(rows, "sleep_duration", fallback.avg_sleep_7d),
    avg_active_minutes_7d: averageField(rows, "active_minutes", fallback.avg_active_minutes_7d),
    resting_hr_baseline: averageField(rows, "resting_heart_rate", fallback.resting_hr_baseline),
    baseline_confidence: enoughDays
      ? Math.min(95, 50 + rows.length * 6)
      : fallback.baseline_confidence,
    baseline_label: enoughDays ? "7日基線" : fallback.baseline_label ?? "演示基線",
    usable_days: rows.length,
    excludes_date: latestDate ?? null,
  };
}

export function getBaseline(elderId, excludeDate) {
  return getSnapshotBaseline(elderId, excludeDate);
}

export function mapElder(row) {
  if (!row) return null;
  return {
    ...row,
    risk_tags: parseJson(row.risk_tags, []),
  };
}

export function mapSnapshot(row) {
  return row ?? null;
}

export function mapEvent(row) {
  if (!row) return null;
  return {
    ...row,
    occurred_at: row.timestamp,
    received_at: row.received_at ?? row.created_at,
    payload: parseJson(row.payload, {}),
  };
}

export function mapTask(row) {
  return row ?? null;
}

export function mapAgentOutput(row) {
  if (!row) return null;
  return {
    ...row,
    key_reasons: parseJson(row.key_reasons, []),
  };
}

export function mapImportRun(row) {
  if (!row) return null;
  return {
    ...row,
    quality_summary: parseJson(row.quality_summary, {}),
    warnings: parseJson(row.warnings, []),
  };
}

export function mapAgentRun(row) {
  if (!row) return null;
  return {
    ...row,
    fallback_used: Boolean(row.fallback_used),
    input_summary: parseJson(row.input_summary, {}),
  };
}

export function listElders() {
  return getDb()
    .prepare("SELECT * FROM elders ORDER BY elder_id")
    .all()
    .map(mapElder);
}

export function getElder(elderId) {
  return mapElder(getDb().prepare("SELECT * FROM elders WHERE elder_id = ?").get(elderId));
}

export function getLatestSnapshot(elderId) {
  return mapSnapshot(
    getDb()
      .prepare(
        `SELECT * FROM snapshots
         WHERE elder_id = ?
         ORDER BY date DESC, created_at DESC
         LIMIT 1`,
      )
      .get(elderId),
  );
}

export function getRecentSnapshots(elderId, limit = 7) {
  const safeLimit = Math.max(1, Math.min(31, Number(limit) || 7));
  return getDb()
    .prepare(
      `SELECT * FROM snapshots
       WHERE elder_id = ?
       ORDER BY date DESC, created_at DESC
       LIMIT ?`,
    )
    .all(elderId, safeLimit)
    .map(mapSnapshot);
}

export function getEventsForElder(elderId) {
  return getDb()
    .prepare("SELECT * FROM events WHERE elder_id = ? ORDER BY timestamp ASC")
    .all(elderId)
    .map(mapEvent);
}

export function getActiveEventsForElder(elderId, { windowHours = 24, now = Date.now() } = {}) {
  const windowStart = now - Math.max(1, Number(windowHours) || 24) * 60 * 60 * 1000;
  const futureTolerance = now + 5 * 60 * 1000;
  return getDb()
    .prepare(
      `SELECT * FROM events
       WHERE elder_id = ? AND status = 'open'
       ORDER BY timestamp ASC`,
    )
    .all(elderId)
    .map(mapEvent)
    .filter((event) => {
      const occurredAt = Date.parse(event.occurred_at);
      return Number.isFinite(occurredAt) && occurredAt >= windowStart && occurredAt <= futureTolerance;
    });
}

export function getOpenTasksForElder(elderId) {
  return getDb()
    .prepare(
      `SELECT * FROM tasks
       WHERE elder_id = ? AND status NOT IN ('resolved', 'cancelled')
       ORDER BY created_at DESC`,
    )
    .all(elderId)
    .map(mapTask);
}

export function getTasksForElder(elderId) {
  return getDb()
    .prepare("SELECT * FROM tasks WHERE elder_id = ? ORDER BY created_at DESC")
    .all(elderId)
    .map(mapTask);
}

export function getLatestAgentOutput(elderId) {
  return mapAgentOutput(
    getDb()
      .prepare(
        `SELECT * FROM agent_outputs
         WHERE elder_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(elderId),
  );
}

export function getLatestAgentRun(elderId) {
  return mapAgentRun(
    getDb()
      .prepare(
        `SELECT * FROM agent_runs
         WHERE elder_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(elderId),
  );
}

export function insertSnapshot(snapshot) {
  const db = getDb();
  const record = {
    ...snapshot,
    snapshot_id: snapshot.snapshot_id ?? randomUUID(),
    created_at: snapshot.created_at ?? nowIso(),
  };

  db.prepare(
    `INSERT INTO snapshots (
      snapshot_id, elder_id, date, data_source, heart_rate_avg,
      resting_heart_rate, steps, active_minutes, sleep_duration,
      wear_time_hours, data_quality, created_at
    ) VALUES (
      @snapshot_id, @elder_id, @date, @data_source, @heart_rate_avg,
      @resting_heart_rate, @steps, @active_minutes, @sleep_duration,
      @wear_time_hours, @data_quality, @created_at
    )
    ON CONFLICT(elder_id, date) DO UPDATE SET
      data_source = excluded.data_source,
      heart_rate_avg = excluded.heart_rate_avg,
      resting_heart_rate = excluded.resting_heart_rate,
      steps = excluded.steps,
      active_minutes = excluded.active_minutes,
      sleep_duration = excluded.sleep_duration,
      wear_time_hours = excluded.wear_time_hours,
      data_quality = excluded.data_quality,
      created_at = excluded.created_at`,
  ).run(record);

  return mapSnapshot(
    db.prepare("SELECT * FROM snapshots WHERE elder_id = ? AND date = ?").get(record.elder_id, record.date),
  );
}

export function insertEvent(event) {
  const db = getDb();
  const occurredAt = event.occurred_at ?? event.timestamp ?? nowIso();
  const receivedAt = event.received_at ?? nowIso();
  const record = {
    event_id: event.event_id ?? randomUUID(),
    elder_id: event.elder_id,
    event_type: event.event_type,
    timestamp: occurredAt,
    source: event.source,
    raw_text: event.raw_text ?? null,
    payload: stringifyJson(event.payload ?? {}),
    received_at: receivedAt,
    severity_hint: event.severity_hint ?? "info",
    data_quality: event.data_quality ?? "medium",
    status: "open",
    resolved_at: null,
    resolved_by: null,
    linked_task_id: null,
    created_at: event.created_at ?? nowIso(),
  };

  const result = db.prepare(
    `INSERT OR IGNORE INTO events (
      event_id, elder_id, event_type, timestamp, source, raw_text, payload,
      received_at, severity_hint, data_quality, status, resolved_at, resolved_by,
      linked_task_id, created_at
    ) VALUES (
      @event_id, @elder_id, @event_type, @timestamp, @source, @raw_text, @payload,
      @received_at, @severity_hint, @data_quality, @status, @resolved_at, @resolved_by,
      @linked_task_id, @created_at
    )`,
  ).run(record);

  if (result.changes > 0) {
    insertAuditLog({
      elder_id: record.elder_id,
      action: "event.accepted",
      actor: record.source,
      target_type: "event",
      target_id: record.event_id,
      metadata: {
        event_type: record.event_type,
        severity_hint: record.severity_hint,
      },
    });
  }

  return {
    event: mapEvent(db.prepare("SELECT * FROM events WHERE event_id = ?").get(record.event_id)),
    inserted: result.changes > 0,
  };
}

export function insertAuditLog({ elder_id = null, action, actor, target_type, target_id = null, metadata = {} }) {
  const db = getDb();
  const record = {
    audit_id: randomUUID(),
    elder_id,
    action,
    actor,
    target_type,
    target_id,
    metadata: stringifyJson(metadata),
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO audit_logs (
       audit_id, elder_id, action, actor, target_type, target_id, metadata, created_at
     ) VALUES (
       @audit_id, @elder_id, @action, @actor, @target_type, @target_id, @metadata, @created_at
     )`,
  ).run(record);
  return { ...record, metadata };
}

export function insertImportRun(run) {
  const db = getDb();
  const record = {
    import_id: run.import_id ?? randomUUID(),
    elder_id: run.elder_id,
    source_type: run.source_type,
    file_name: run.file_name ?? null,
    status: run.status ?? "confirmed",
    snapshot_count: run.snapshot_count ?? 0,
    date_start: run.date_start ?? null,
    date_end: run.date_end ?? null,
    quality_summary: stringifyJson(run.quality_summary ?? {}),
    warnings: stringifyJson(run.warnings ?? []),
    created_at: run.created_at ?? nowIso(),
  };

  db.prepare(
    `INSERT INTO import_runs (
       import_id, elder_id, source_type, file_name, status, snapshot_count,
       date_start, date_end, quality_summary, warnings, created_at
     ) VALUES (
       @import_id, @elder_id, @source_type, @file_name, @status, @snapshot_count,
       @date_start, @date_end, @quality_summary, @warnings, @created_at
     )`,
  ).run(record);

  insertAuditLog({
    elder_id: record.elder_id,
    action: "wearable.import.confirmed",
    actor: "dashboard",
    target_type: "import_run",
    target_id: record.import_id,
    metadata: {
      source_type: record.source_type,
      snapshot_count: record.snapshot_count,
      date_start: record.date_start,
      date_end: record.date_end,
    },
  });

  return mapImportRun(
    db.prepare("SELECT * FROM import_runs WHERE import_id = ?").get(record.import_id),
  );
}

export function insertSnapshotImport({ snapshots, import_run }) {
  const db = getDb();
  const confirm = db.transaction(() => {
    const inserted = snapshots.map((snapshot) => insertSnapshot(snapshot));
    const importRun = insertImportRun({
      ...import_run,
      snapshot_count: inserted.length,
    });
    return { snapshots: inserted, import_run: importRun };
  });

  return confirm();
}

export function insertAgentRun(run) {
  const db = getDb();
  const record = {
    run_id: run.run_id ?? randomUUID(),
    elder_id: run.elder_id,
    source_event_id: run.source_event_id ?? null,
    provider: run.provider,
    requested_provider: run.requested_provider ?? run.provider,
    model: run.model ?? null,
    started_at: run.started_at ?? nowIso(),
    duration_ms: run.duration_ms ?? null,
    validation_status: run.validation_status,
    fallback_used: run.fallback_used ? 1 : 0,
    error_reason: run.error_reason ?? null,
    input_summary: stringifyJson(run.input_summary ?? {}),
    raw_response_excerpt:
      typeof run.raw_response_excerpt === "string"
        ? run.raw_response_excerpt.slice(0, 8000)
        : null,
    created_at: run.created_at ?? nowIso(),
  };

  db.prepare(
    `INSERT INTO agent_runs (
       run_id, elder_id, source_event_id, provider, requested_provider, model, started_at,
       duration_ms, validation_status, fallback_used, error_reason,
       input_summary, raw_response_excerpt, created_at
     ) VALUES (
       @run_id, @elder_id, @source_event_id, @provider, @requested_provider, @model, @started_at,
       @duration_ms, @validation_status, @fallback_used, @error_reason,
       @input_summary, @raw_response_excerpt, @created_at
     )`,
  ).run(record);

  insertAuditLog({
    elder_id: record.elder_id,
    action:
      record.validation_status === "failed"
        ? "agent.failed"
        : record.fallback_used
          ? "agent.fallback"
          : "agent.completed",
    actor: record.provider,
    target_type: "agent_run",
    target_id: record.run_id,
    metadata: {
      validation_status: record.validation_status,
      fallback_used: Boolean(record.fallback_used),
      requested_provider: record.requested_provider,
      duration_ms: record.duration_ms,
    },
  });

  return mapAgentRun(
    db.prepare("SELECT * FROM agent_runs WHERE run_id = ?").get(record.run_id),
  );
}

export function listImportRuns(elderId, limit = 20) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  return getDb()
    .prepare(
      `SELECT * FROM import_runs
       WHERE elder_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(elderId, safeLimit)
    .map(mapImportRun);
}

export function createTaskForRisk({ elder, event, riskResult }) {
  const actionable = ["attention", "high_risk", "urgent"].includes(riskResult.status_level);
  if (!actionable) return null;

  const db = getDb();
  const existing = db
    .prepare(
      `SELECT * FROM tasks
       WHERE elder_id = ? AND status NOT IN ('resolved', 'cancelled')
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(elder.elder_id);

  if (existing) {
    if (event?.event_id) {
      db.prepare("UPDATE events SET linked_task_id = ? WHERE event_id = ?").run(
        existing.task_id,
        event.event_id,
      );
    }
    const nextPriority =
      riskResult.status_level === "urgent"
        ? "urgent"
        : riskResult.status_level === "high_risk"
          ? "high"
          : "medium";
    const priorityRank = { low: 1, medium: 2, high: 3, urgent: 4 };

    if ((priorityRank[nextPriority] ?? 0) > (priorityRank[existing.priority] ?? 0)) {
      const nextTitle =
        riskResult.status_level === "urgent"
          ? `${elder.name} 出現緊急照護事件`
          : riskResult.status_level === "high_risk"
            ? `${elder.name} 需要立即查看`
            : `${elder.name} 需要照護關注`;
      const nextReason = riskResult.key_reasons.join("；") || "規則引擎提示需要關注";

      db.prepare(
        `UPDATE tasks
         SET source_event_id = ?, priority = ?, task_title = ?, task_reason = ?,
             recommended_action = ?, updated_at = ?
         WHERE task_id = ?`,
      ).run(
        event?.event_id ?? existing.source_event_id,
        nextPriority,
        nextTitle,
        nextReason,
        riskResult.recommended_action,
        nowIso(),
        existing.task_id,
      );
      insertAuditLog({
        elder_id: elder.elder_id,
        action: "task.escalated",
        actor: "rule_engine",
        target_type: "task",
        target_id: existing.task_id,
        metadata: {
          previous_priority: existing.priority,
          priority: nextPriority,
          source_event_id: event?.event_id ?? existing.source_event_id,
        },
      });
      return mapTask(db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(existing.task_id));
    }

    return mapTask(existing);
  }

  const lifecycleOnlyAction =
    event?.event_type === "manual_note" &&
    ["caregiver_accepted", "caregiver_checked", "caregiver_completed"].includes(
      event.payload?.action,
    );
  if (lifecycleOnlyAction) return null;

  const priority =
    riskResult.status_level === "urgent"
      ? "urgent"
      : riskResult.status_level === "high_risk"
        ? "high"
        : "medium";
  const title =
    riskResult.status_level === "urgent"
      ? `${elder.name}出现紧急照护事件`
      : riskResult.status_level === "high_risk"
        ? `${elder.name}需要立即查看`
        : `${elder.name}需要照护关注`;

  const record = {
    task_id: randomUUID(),
    elder_id: elder.elder_id,
    source_event_id: event?.event_id ?? null,
    priority,
    task_title: title,
    task_reason: riskResult.key_reasons.join("；") || "规则引擎提示需要关注",
    recommended_action: riskResult.recommended_action,
    status: "open",
    handled_by: null,
    handled_note: null,
    created_at: nowIso(),
    updated_at: nowIso(),
    completed_at: null,
  };

  db.prepare(
    `INSERT INTO tasks (
      task_id, elder_id, source_event_id, priority, task_title, task_reason,
      recommended_action, status, handled_by, handled_note, created_at, updated_at, completed_at
    ) VALUES (
      @task_id, @elder_id, @source_event_id, @priority, @task_title, @task_reason,
      @recommended_action, @status, @handled_by, @handled_note, @created_at, @updated_at, @completed_at
    )`,
  ).run(record);

  if (event?.event_id) {
    db.prepare("UPDATE events SET linked_task_id = ? WHERE event_id = ?").run(
      record.task_id,
      event.event_id,
    );
  }

  insertAuditLog({
    elder_id: elder.elder_id,
    action: "task.created",
    actor: "rule_engine",
    target_type: "task",
    target_id: record.task_id,
    metadata: {
      priority: record.priority,
      source_event_id: record.source_event_id,
      status_level: riskResult.status_level,
    },
  });

  return mapTask(db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(record.task_id));
}

export function updateTask(taskId, changes) {
  const db = getDb();
  const current = db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId);
  if (!current) return null;

  const nextStatus = changes.status ?? current.status;
  if (["resolved", "cancelled"].includes(current.status) && nextStatus !== current.status) {
    const error = new Error(`Task ${taskId} is already ${current.status} and cannot be reopened.`);
    error.statusCode = 409;
    throw error;
  }
  if (nextStatus === "cancelled" && current.priority === "urgent") {
    const error = new Error("Urgent caregiver tasks cannot be cancelled; resolve them with a handling record.");
    error.statusCode = 409;
    throw error;
  }

  const next = {
    task_id: taskId,
    status: nextStatus,
    handled_by: changes.handled_by ?? current.handled_by,
    handled_note: changes.handled_note ?? current.handled_note,
    updated_at: nowIso(),
    completed_at:
      changes.completed_at ??
      (["resolved", "cancelled"].includes(changes.status) && !current.completed_at
        ? nowIso()
        : current.completed_at),
  };

  db.prepare(
    `UPDATE tasks
     SET status = @status,
          handled_by = @handled_by,
          handled_note = @handled_note,
          updated_at = @updated_at,
          completed_at = @completed_at
     WHERE task_id = @task_id`,
  ).run(next);

  if (["resolved", "cancelled"].includes(next.status)) {
    db.prepare(
      `UPDATE events
       SET status = 'resolved', resolved_at = ?, resolved_by = ?
       WHERE linked_task_id = ? OR event_id = ?`,
    ).run(
      next.completed_at ?? next.updated_at,
      next.handled_by ?? (next.status === "cancelled" ? "task_cancelled" : "caregiver"),
      taskId,
      current.source_event_id,
    );
  }

  insertAuditLog({
    elder_id: current.elder_id,
    action: `task.${next.status}`,
    actor: next.handled_by ?? "dashboard",
    target_type: "task",
    target_id: taskId,
    metadata: { previous_status: current.status, status: next.status },
  });

  return mapTask(db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId));
}

export function insertAgentOutput(output) {
  const db = getDb();
  const record = {
    ...output,
    output_id: output.output_id ?? randomUUID(),
    source_event_id: output.source_event_id ?? null,
    safety_disclaimer: output.safety_disclaimer ?? SAFETY_DISCLAIMER,
    key_reasons: stringifyJson(output.key_reasons ?? []),
    agent_source: output.agent_source ?? "mock",
    warning: output.warning ?? null,
    created_at: output.created_at ?? nowIso(),
  };

  db.prepare(
    `INSERT INTO agent_outputs (
      output_id, elder_id, source_event_id, status_level, risk_score,
      caregiver_summary, family_summary, institution_summary, recommended_action,
      safety_disclaimer, key_reasons, agent_source, warning, created_at
    ) VALUES (
      @output_id, @elder_id, @source_event_id, @status_level, @risk_score,
      @caregiver_summary, @family_summary, @institution_summary, @recommended_action,
      @safety_disclaimer, @key_reasons, @agent_source, @warning, @created_at
    )`,
  ).run(record);

  return mapAgentOutput(
    db.prepare("SELECT * FROM agent_outputs WHERE output_id = ?").get(record.output_id),
  );
}

export function resetDemoData() {
  const db = getDb();
  const reset = db.transaction(() => {
    const demoIds = "'E001', 'E002', 'E003', 'E004'";
    db.prepare(`DELETE FROM audit_logs WHERE elder_id IN (${demoIds})`).run();
    db.prepare(`DELETE FROM agent_runs WHERE elder_id IN (${demoIds})`).run();
    db.prepare(`DELETE FROM import_runs WHERE elder_id IN (${demoIds})`).run();
    db.prepare(`DELETE FROM agent_outputs WHERE elder_id IN (${demoIds})`).run();
    db.prepare(`DELETE FROM tasks WHERE elder_id IN (${demoIds})`).run();
    db.prepare(`DELETE FROM events WHERE elder_id IN (${demoIds})`).run();
    db.prepare(`DELETE FROM snapshots WHERE elder_id IN (${demoIds})`).run();
    db.prepare(`DELETE FROM elders WHERE elder_id IN (${demoIds})`).run();
    seedDemoData(db);
    normalizeStoredData(db);
    insertAuditLog({
      action: "demo.reset",
      actor: "local_demo",
      target_type: "demo",
      metadata: { preserved_elder_ids: ["TEST001"] },
    });
  });

  reset();
  return {
    elders: db.prepare("SELECT COUNT(*) AS count FROM elders").get().count,
    snapshots: db.prepare("SELECT COUNT(*) AS count FROM snapshots").get().count,
    events: db.prepare("SELECT COUNT(*) AS count FROM events").get().count,
    tasks: db.prepare("SELECT COUNT(*) AS count FROM tasks").get().count,
    agent_outputs: db.prepare("SELECT COUNT(*) AS count FROM agent_outputs").get().count,
  };
}
