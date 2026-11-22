-- Stage 2.5: independently verified GitHub source provenance only.
-- Never modify buffalo_tasks or buffalo_full_handoffs; provenance is a separate,
-- immutable evidence lane (not agent execution and not a cryptographic signature).
CREATE TABLE IF NOT EXISTS buffalo_full_source_attestations (
  handoff_id TEXT PRIMARY KEY REFERENCES buffalo_full_handoffs(handoff_id),
  proof_schema TEXT NOT NULL CHECK(proof_schema='BUFFALO_FULL_SOURCE_PROOF_V1'),
  proof_status TEXT NOT NULL CHECK(proof_status='SOURCE_ATTESTED'),
  repo TEXT NOT NULL CHECK(repo='yudocyudoc/buffalo-01'),
  workflow TEXT NOT NULL CHECK(workflow='buffalo-full-source-proof.yml'),
  workflow_id INTEGER NOT NULL CHECK(workflow_id>0),
  github_run_id INTEGER NOT NULL UNIQUE CHECK(github_run_id>0),
  github_artifact_id INTEGER NOT NULL UNIQUE CHECK(github_artifact_id>0),
  commit_sha TEXT NOT NULL CHECK(length(commit_sha)=40),
  manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64),
  artifact_sha256 TEXT NOT NULL CHECK(length(artifact_sha256)=64),
  result_sha256 TEXT NOT NULL CHECK(length(result_sha256)=64),
  execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK(execution_allowed=0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS buffalo_full_source_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  handoff_id TEXT NOT NULL REFERENCES buffalo_full_source_attestations(handoff_id),
  actor TEXT NOT NULL CHECK(actor='WORKER_GITHUB_SOURCE_V1'),
  event TEXT NOT NULL CHECK(event='SOURCE_ATTESTED'),
  evidence_sha256 TEXT NOT NULL CHECK(length(evidence_sha256)=64),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_buffalo_full_source_events
 ON buffalo_full_source_events(handoff_id,event_id);
