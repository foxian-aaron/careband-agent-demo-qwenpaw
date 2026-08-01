// backend/tests/database.test.js
//
// Stage 3 SQLite foundation contract coverage:
//   * a fresh database creates exactly the 9 required business tables
//   * foreign_keys = ON; file databases use WAL journaling
//   * the initial migration 0001-core-schema is registered exactly once
//   * first initialization seeds exactly 5 subjects (E001-E004=elder,
//     TEST001=team_test) and no health/risk records
//   * repeated initialization does not duplicate subjects
//   * subjects persist across close + reopen
//   * a row violating the elder foreign key is rejected
//   * risk_tags is stored as parseable JSON
//
// Each test works against a throwaway database file under the system temp dir
// and closes + cleans up its handles.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

import { openDatabase, getDb, closeDb } from "../src/db.js";

const REQUIRED_TABLES = [
  "elders",
  "snapshots",
  "events",
  "tasks",
  "agent_outputs",
  "agent_runs",
  "import_runs",
  "audit_logs",
  "schema_migrations",
];

let tmpRoot;
let seq = 0;

before(() => {
  // The scratch directory MUST live under the system temp.
  tmpRoot = mkdtempSync(join(tmpdir(), "careband-db-test-"));
  assert.ok(
    tmpRoot.startsWith(tmpdir()),
    "scratch database directory must be under the system temp",
  );
});

after(() => {
  closeDb();
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

function newDbPath() {
  return join(tmpRoot, `careband-${process.pid}-${Date.now()}-${seq++}.sqlite`);
}

function tableNames(db) {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .all();
  return rows.map((r) => r.name).sort();
}

test("a fresh database contains exactly the 9 required business tables", () => {
  const path = newDbPath();
  try {
    const db = openDatabase(path);
    assert.deepEqual(tableNames(db), [...REQUIRED_TABLES].sort());
  } finally {
    closeDb();
  }
});

test("foreign_keys is ON and file databases use WAL journaling", () => {
  const path = newDbPath();
  try {
    const db = openDatabase(path);
    assert.equal(Number(db.pragma("foreign_keys", { simple: true })), 1);
    assert.equal(db.pragma("journal_mode", { simple: true }), "wal");
  } finally {
    closeDb();
  }
});

test("the initial migration 0001-core-schema is registered exactly once", () => {
  const path = newDbPath();
  try {
    openDatabase(path);
    let db = getDb();
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get().n,
      1,
    );
    assert.equal(
      db.prepare("SELECT migration_id FROM schema_migrations").get()
        .migration_id,
      "0001-core-schema",
    );

    // Re-opening the same file must not register the migration again.
    closeDb();
    openDatabase(path);
    db = getDb();
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get().n,
      1,
    );
  } finally {
    closeDb();
  }
});

test("first initialization seeds exactly 5 subjects with the correct kinds", () => {
  const path = newDbPath();
  try {
    openDatabase(path);
    const db = getDb();
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM elders").get().n, 5);
    for (const id of ["E001", "E002", "E003", "E004"]) {
      assert.equal(
        db
          .prepare("SELECT subject_kind FROM elders WHERE elder_id = ?")
          .get(id).subject_kind,
        "elder",
      );
    }
    assert.equal(
      db
        .prepare("SELECT subject_kind FROM elders WHERE elder_id = ?")
        .get("TEST001").subject_kind,
      "team_test",
    );
    // No health / risk / business records are seeded in this stage.
    for (const table of [
      "snapshots",
      "events",
      "tasks",
      "agent_outputs",
      "agent_runs",
    ]) {
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,
        0,
        `${table} must be empty after seed`,
      );
    }
  } finally {
    closeDb();
  }
});

test("repeated initialization does not create duplicate subjects", () => {
  const path = newDbPath();
  try {
    openDatabase(path);
    closeDb();
    openDatabase(path);
    closeDb();
    openDatabase(path);
    const db = getDb();
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM elders").get().n, 5);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get().n,
      1,
    );
  } finally {
    closeDb();
  }
});

test("subjects persist across close and reopen", () => {
  const path = newDbPath();
  openDatabase(path);
  closeDb();
  openDatabase(path);
  try {
    const db = getDb();
    const rows = db
      .prepare("SELECT elder_id, subject_kind FROM elders ORDER BY elder_id")
      .all();
    assert.equal(rows.length, 5);
    assert.deepEqual(
      rows.map((r) => r.elder_id),
      ["E001", "E002", "E003", "E004", "TEST001"],
    );
  } finally {
    closeDb();
  }
});

test("inserting a row that violates the elder foreign key is rejected", () => {
  const path = newDbPath();
  try {
    openDatabase(path);
    const db = getDb();
    assert.throws(() =>
      db
        .prepare(
          "INSERT INTO snapshots (elder_id, snapshot_date, payload, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(
          "DOES_NOT_EXIST",
          "2026-08-01",
          "{}",
          new Date().toISOString(),
        ),
    );
  } finally {
    closeDb();
  }
});

test("inserting a snapshot with a NULL snapshot_date is rejected", () => {
  const path = newDbPath();
  try {
    openDatabase(path);
    const db = getDb();
    assert.throws(() =>
      db
        .prepare(
          "INSERT INTO snapshots (elder_id, snapshot_date, payload, created_at) VALUES (?, ?, ?, ?)",
        )
        .run("E001", null, "{}", new Date().toISOString()),
    );
  } finally {
    closeDb();
  }
});

test("a duplicate (elder_id, snapshot_date) snapshot insert is rejected", () => {
  const path = newDbPath();
  try {
    openDatabase(path);
    const db = getDb();
    db.prepare(
      "INSERT INTO snapshots (elder_id, snapshot_date, payload, created_at) VALUES (?, ?, ?, ?)",
    ).run("E001", "2026-08-01", "{}", new Date().toISOString());
    assert.throws(() =>
      db
        .prepare(
          "INSERT INTO snapshots (elder_id, snapshot_date, payload, created_at) VALUES (?, ?, ?, ?)",
        )
        .run("E001", "2026-08-01", "{}", new Date().toISOString()),
    );
  } finally {
    closeDb();
  }
});

test("risk_tags is stored as parseable JSON", () => {
  const path = newDbPath();
  try {
    openDatabase(path);
    const db = getDb();
    const raw = db
      .prepare("SELECT risk_tags FROM elders WHERE elder_id = 'E001'")
      .get().risk_tags;
    const parsed = JSON.parse(raw);
    assert.ok(Array.isArray(parsed), "risk_tags must parse to an array");
  } finally {
    closeDb();
  }
});
