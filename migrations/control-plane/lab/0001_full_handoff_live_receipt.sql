-- LAB ONLY. Do not apply to production control-plane D1.
-- One-shot remote Worker binding trial; durable fail-closed idempotency.
CREATE TABLE IF NOT EXISTS buffalo_full_handoff_lab_receipts (
 test_id TEXT PRIMARY KEY,
 status TEXT NOT NULL CHECK(status IN ('RUNNING','PASS','FAIL')),
 failure_stage TEXT,
 failure_code TEXT,
 detail_json TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 finished_at TEXT
);
