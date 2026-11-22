-- Buffalo Full stage 2: isolated, non-executable handoff declaration.
-- Apply only after 0001 and 0002; CI does not deploy it to live D1.
-- The original buffalo_tasks CHECK(kind='BUFFALO_OFFLINE_ECHO_V1') is deliberately untouched.
CREATE TABLE IF NOT EXISTS buffalo_full_handoffs (
  handoff_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind='BUFFALO_FULL_HANDOFF_V1'),
  schema_version TEXT NOT NULL CHECK(schema_version='BUFFALO_FULL_HANDOFF_MANIFEST_V1'),
  state TEXT NOT NULL DEFAULT 'REGISTERED_UNVERIFIED'
    CHECK(state='REGISTERED_UNVERIFIED'),
  agent TEXT NOT NULL CHECK(agent IN ('merlin','socrates','themis','athena_SFD')),
  benchmark TEXT NOT NULL CHECK(benchmark='policyImplementation'),
  scenario_id TEXT NOT NULL,
  case_index INTEGER NOT NULL CHECK(case_index >= 0 AND case_index <= 999),
  mode TEXT NOT NULL CHECK(mode='sfd'),
  commit_sha TEXT NOT NULL CHECK(length(commit_sha)=40),
  source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
  agent_config_sha256 TEXT NOT NULL CHECK(length(agent_config_sha256)=64),
  prompt_sha256 TEXT NOT NULL CHECK(length(prompt_sha256)=64),
  initial_model_sha256 TEXT NOT NULL CHECK(length(initial_model_sha256)=64),
  parameters_sha256 TEXT NOT NULL CHECK(length(parameters_sha256)=64),
  manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64),
  execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK(execution_allowed=0),
  provenance_verified INTEGER NOT NULL DEFAULT 0 CHECK(provenance_verified=0),
  github_run_id INTEGER CHECK(github_run_id IS NULL),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_buffalo_full_handoffs_commit
  ON buffalo_full_handoffs(commit_sha,created_at);

CREATE TABLE IF NOT EXISTS buffalo_full_handoff_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  handoff_id TEXT NOT NULL REFERENCES buffalo_full_handoffs(handoff_id),
  actor TEXT NOT NULL CHECK(actor='WORKER_HANDOFF_V1'),
  event TEXT NOT NULL CHECK(event='DECLARATION_ADMITTED'),
  manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_buffalo_full_handoff_events
  ON buffalo_full_handoff_events(handoff_id,event_id);
