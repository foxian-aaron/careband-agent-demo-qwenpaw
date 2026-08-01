-- backend/src/schema.sql
--
-- CareBand software v0.3 — Stage 3 core schema.
--
-- Creates exactly nine business tables. No v0.2 ALTER / normalization is
-- performed. Structured values are stored as TEXT (JSON); this stage defines
-- the tables only and exposes no business read/write APIs.
--
-- PRAGMA foreign_keys / journal_mode are applied by db.js (they must be set
-- outside a transaction), so this file contains pure DDL.

CREATE TABLE IF NOT EXISTS elders (
  elder_id      TEXT    PRIMARY KEY NOT NULL,
  name          TEXT    NOT NULL,
  age           INTEGER,
  room          TEXT,
  risk_tags     TEXT,                 -- JSON array of strings
  subject_kind  TEXT    NOT NULL,     -- "elder" | "team_test"
  created_at    TEXT    NOT NULL      -- ISO 8601 timestamp
);

CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  elder_id      TEXT    NOT NULL,
  snapshot_date TEXT    NOT NULL,      -- e.g. YYYY-MM-DD
  payload       TEXT,                  -- JSON: structured daily snapshot value
  created_at    TEXT    NOT NULL,
  FOREIGN KEY (elder_id) REFERENCES elders (elder_id)
);

-- Unique (elder_id, snapshot_date) index enables idempotent daily imports.
CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_elder_date
  ON snapshots (elder_id, snapshot_date);

CREATE TABLE IF NOT EXISTS events (
  event_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  elder_id    TEXT    NOT NULL,
  payload     TEXT,                    -- JSON: canonical event value
  created_at  TEXT    NOT NULL,
  FOREIGN KEY (elder_id) REFERENCES elders (elder_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  task_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  elder_id    TEXT    NOT NULL,
  payload     TEXT,                    -- JSON: task value
  created_at  TEXT    NOT NULL,
  FOREIGN KEY (elder_id) REFERENCES elders (elder_id)
);

CREATE TABLE IF NOT EXISTS agent_outputs (
  agent_output_id INTEGER PRIMARY KEY AUTOINCREMENT,
  elder_id        TEXT    NOT NULL,
  payload         TEXT,                -- JSON: agent summary output
  created_at      TEXT    NOT NULL,
  FOREIGN KEY (elder_id) REFERENCES elders (elder_id)
);

CREATE TABLE IF NOT EXISTS agent_runs (
  agent_run_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  elder_id      TEXT    NOT NULL,
  payload       TEXT,                  -- JSON: agent run / trace value
  created_at    TEXT    NOT NULL,
  FOREIGN KEY (elder_id) REFERENCES elders (elder_id)
);

CREATE TABLE IF NOT EXISTS import_runs (
  import_run_id INTEGER PRIMARY KEY AUTOINCREMENT,
  elder_id      TEXT,                  -- nullable: some imports are not per-elder
  payload       TEXT,                  -- JSON: import-run value
  created_at    TEXT    NOT NULL,
  FOREIGN KEY (elder_id) REFERENCES elders (elder_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  audit_log_id INTEGER PRIMARY KEY AUTOINCREMENT,
  elder_id     TEXT,                   -- nullable: some entries are system-level
  payload      TEXT,                   -- JSON: audit entry
  created_at   TEXT    NOT NULL,
  FOREIGN KEY (elder_id) REFERENCES elders (elder_id)
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_id TEXT    PRIMARY KEY NOT NULL,
  applied_at   TEXT    NOT NULL
);
