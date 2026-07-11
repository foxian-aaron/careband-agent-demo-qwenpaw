CREATE TABLE IF NOT EXISTS elders (
  elder_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  age INTEGER NOT NULL,
  room TEXT NOT NULL,
  risk_tags TEXT NOT NULL,
  subject_kind TEXT NOT NULL DEFAULT 'elder',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_id TEXT PRIMARY KEY,
  elder_id TEXT NOT NULL,
  date TEXT NOT NULL,
  data_source TEXT NOT NULL,
  heart_rate_avg REAL,
  resting_heart_rate REAL,
  steps INTEGER,
  active_minutes REAL,
  sleep_duration REAL,
  wear_time_hours REAL,
  data_quality REAL NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (elder_id) REFERENCES elders(elder_id)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_elder_date
  ON snapshots (elder_id, date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  elder_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  source TEXT NOT NULL,
  raw_text TEXT,
  payload TEXT NOT NULL,
  received_at TEXT,
  severity_hint TEXT NOT NULL DEFAULT 'info',
  data_quality TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  resolved_at TEXT,
  resolved_by TEXT,
  linked_task_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (elder_id) REFERENCES elders(elder_id)
);

CREATE INDEX IF NOT EXISTS idx_events_elder_time
  ON events (elder_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT PRIMARY KEY,
  elder_id TEXT NOT NULL,
  source_event_id TEXT,
  priority TEXT NOT NULL,
  task_title TEXT NOT NULL,
  task_reason TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  status TEXT NOT NULL,
  handled_by TEXT,
  handled_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (elder_id) REFERENCES elders(elder_id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_elder_status
  ON tasks (elder_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_outputs (
  output_id TEXT PRIMARY KEY,
  elder_id TEXT NOT NULL,
  source_event_id TEXT,
  status_level TEXT NOT NULL,
  risk_score REAL NOT NULL,
  caregiver_summary TEXT NOT NULL,
  family_summary TEXT NOT NULL,
  institution_summary TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  safety_disclaimer TEXT NOT NULL,
  key_reasons TEXT NOT NULL,
  agent_source TEXT NOT NULL DEFAULT 'mock',
  warning TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (elder_id) REFERENCES elders(elder_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_outputs_elder_time
  ON agent_outputs (elder_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_runs (
  run_id TEXT PRIMARY KEY,
  elder_id TEXT NOT NULL,
  source_event_id TEXT,
  provider TEXT NOT NULL,
  model TEXT,
  started_at TEXT NOT NULL,
  duration_ms INTEGER,
  validation_status TEXT NOT NULL,
  fallback_used INTEGER NOT NULL DEFAULT 0,
  error_reason TEXT,
  input_summary TEXT NOT NULL DEFAULT '{}',
  raw_response_excerpt TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (elder_id) REFERENCES elders(elder_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_elder_time
  ON agent_runs (elder_id, created_at DESC);

CREATE TABLE IF NOT EXISTS import_runs (
  import_id TEXT PRIMARY KEY,
  elder_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  file_name TEXT,
  status TEXT NOT NULL,
  snapshot_count INTEGER NOT NULL DEFAULT 0,
  date_start TEXT,
  date_end TEXT,
  quality_summary TEXT NOT NULL DEFAULT '{}',
  warnings TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  FOREIGN KEY (elder_id) REFERENCES elders(elder_id)
);

CREATE INDEX IF NOT EXISTS idx_import_runs_elder_time
  ON import_runs (elder_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  audit_id TEXT PRIMARY KEY,
  elder_id TEXT,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_elder_time
  ON audit_logs (elder_id, created_at DESC);

CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
