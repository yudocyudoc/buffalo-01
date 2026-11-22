-- Laboratory only: durable one-shot receipt for source attestation through real Worker env.DB.
-- Never migrate into the production control-plane database.
CREATE TABLE IF NOT EXISTS buffalo_full_source_lab_receipts (
  test_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('RUNNING','PASS','FAIL')),
  failure_stage TEXT,
  failure_code TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);
