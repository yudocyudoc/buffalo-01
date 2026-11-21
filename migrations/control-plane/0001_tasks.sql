-- Offline-first control plane. Apply to an explicitly created D1 database ONLY.
-- This migration is not deployed by CI or GitHub Actions.
CREATE TABLE IF NOT EXISTS buffalo_tasks (
  task_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind = 'BUFFALO_OFFLINE_ECHO_V1'),
  input_sha256 TEXT NOT NULL CHECK(length(input_sha256) = 64),
  state TEXT NOT NULL CHECK(state IN (
    'READY', 'DISPATCHING', 'SUBMITTED', 'RUNNING',
    'SUCCEEDED', 'FAILED', 'DISPATCH_UNKNOWN'
  )),
  github_run_id INTEGER UNIQUE,
  result_sha256 TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_buffalo_tasks_state ON buffalo_tasks(state, created_at);

-- Audit entries are appended, not overwritten. Code must enforce actor identity,
-- claim semantics and transition constraints; SQL alone does not prove provenance.
CREATE TABLE IF NOT EXISTS buffalo_task_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES buffalo_tasks(task_id),
  actor TEXT NOT NULL,
  old_state TEXT,
  new_state TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  evidence_sha256 TEXT,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_buffalo_events_task ON buffalo_task_events(task_id, event_id);
