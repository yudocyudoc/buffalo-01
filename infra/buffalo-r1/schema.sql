-- Proposed only. Applying this migration is a distinct authorized operation.
-- No existing 3B-7 or live-grant tables are modified.
CREATE TABLE IF NOT EXISTS buffalo_stage3b8r1_receipts (
 probe_id TEXT PRIMARY KEY,
 run_id TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL,
 receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json))
);
