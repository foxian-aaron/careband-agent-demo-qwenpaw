import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

test("an existing v0.2 database migrates without losing snapshots", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "careband-migration-"));
  const databasePath = path.join(directory, "legacy.sqlite");
  const legacy = new Database(databasePath);

  legacy.exec(`
    CREATE TABLE elders (
      elder_id TEXT PRIMARY KEY, name TEXT NOT NULL, age INTEGER NOT NULL,
      room TEXT NOT NULL, risk_tags TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE snapshots (
      snapshot_id TEXT PRIMARY KEY, elder_id TEXT NOT NULL, date TEXT NOT NULL,
      data_source TEXT NOT NULL, heart_rate_avg REAL, resting_heart_rate REAL,
      steps INTEGER, active_minutes REAL, sleep_duration REAL, wear_time_hours REAL,
      data_quality REAL NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE events (
      event_id TEXT PRIMARY KEY, elder_id TEXT NOT NULL, event_type TEXT NOT NULL,
      timestamp TEXT NOT NULL, source TEXT NOT NULL, raw_text TEXT, payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE tasks (
      task_id TEXT PRIMARY KEY, elder_id TEXT NOT NULL, source_event_id TEXT,
      priority TEXT NOT NULL, task_title TEXT NOT NULL, task_reason TEXT NOT NULL,
      recommended_action TEXT NOT NULL, status TEXT NOT NULL, handled_by TEXT,
      handled_note TEXT, created_at TEXT NOT NULL, completed_at TEXT
    );
    CREATE TABLE agent_outputs (
      output_id TEXT PRIMARY KEY, elder_id TEXT NOT NULL, source_event_id TEXT,
      status_level TEXT NOT NULL, risk_score REAL NOT NULL, caregiver_summary TEXT NOT NULL,
      family_summary TEXT NOT NULL, institution_summary TEXT NOT NULL,
      recommended_action TEXT NOT NULL, safety_disclaimer TEXT NOT NULL,
      key_reasons TEXT NOT NULL, agent_source TEXT NOT NULL DEFAULT 'mock', warning TEXT,
      created_at TEXT NOT NULL
    );
  `);

  const elderInsert = legacy.prepare(
    "INSERT INTO elders VALUES (?, ?, 78, '203', '[]', '2026-06-19T00:00:00.000Z')",
  );
  for (const elderId of ["E001", "E002", "E003", "E004"]) elderInsert.run(elderId, elderId);
  legacy.prepare(
    `INSERT INTO snapshots VALUES
     (?, 'E001', '2026-07-01', 'CSV', 70, 65, ?, 30, 7, 18, 90, ?)`,
  ).run("old", 1000, "2026-07-01T01:00:00.000Z");
  legacy.prepare(
    `INSERT INTO snapshots VALUES
     (?, 'E001', '2026-07-01', 'CSV', 71, 66, ?, 31, 7, 18, 91, ?)`,
  ).run("new", 2000, "2026-07-01T02:00:00.000Z");
  legacy.prepare(
    `INSERT INTO events VALUES
     ('EVT-LEGACY', 'E001', 'voice_symptom', '2026-07-11T08:00:00.000Z',
      'demo', '我有点头晕', '{}', '2026-07-11T08:00:01.000Z')`,
  ).run();
  legacy.prepare(
    `INSERT INTO tasks VALUES
     ('TASK-LEGACY', 'E001', 'EVT-LEGACY', 'high', '查看', '头晕', '人工确认',
      'pending', NULL, NULL, '2026-07-11T08:00:02.000Z', NULL)`,
  ).run();
  legacy.prepare(
    `INSERT INTO agent_outputs VALUES
     ('OUT-LEGACY', 'E001', NULL, 'observe', 30, 'a', 'b', 'c', 'd', 'e', '[]',
      'mock', NULL, '2026-07-11T08:00:03.000Z')`,
  ).run();
  legacy.close();

  process.env.DATABASE_PATH = databasePath;
  const dbModule = await import(`../src/db.js?migration=${Date.now()}`);
  const db = dbModule.getDb();

  try {
    const snapshot = db.prepare("SELECT * FROM snapshots WHERE elder_id = 'E001'").all();
    const event = db.prepare("SELECT * FROM events WHERE event_id = 'EVT-LEGACY'").get();
    const task = db.prepare("SELECT * FROM tasks WHERE task_id = 'TASK-LEGACY'").get();
    const output = db.prepare("SELECT * FROM agent_outputs WHERE output_id = 'OUT-LEGACY'").get();
    const testSubject = db.prepare("SELECT * FROM elders WHERE elder_id = 'TEST001'").get();

    assert.equal(snapshot.length, 1);
    assert.equal(snapshot[0].steps, 2000);
    assert.equal(event.event_type, "voice");
    assert.equal(event.status, "open");
    assert.equal(task.status, "open");
    assert.equal(output.status_level, "observation");
    assert.equal(testSubject.subject_kind, "team_test");
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
