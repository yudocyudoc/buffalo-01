-- Buffalo 3B-7 observability-only schema, isolated D1 lab, not a grant.
-- MANUAL MIGRATION BEFORE A NEW MANUAL PROBE. Never auto-apply from PR/CI.
-- Preserve source attestation, handoff and live-grant rows.
CREATE TABLE IF NOT EXISTS buffalo_stage3b7_private_bridge_receipts (
 probe_id TEXT PRIMARY KEY,
 handoff_id TEXT NOT NULL,
 commit_sha TEXT NOT NULL,
 status TEXT NOT NULL,
 receipt_json TEXT NOT NULL,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Append-only phase markers. SCHEDULED_ENTERED is an atomic, one-shot D1
-- admission gate: one cron entry per probe_id; subsequent crons do nothing.
CREATE TABLE IF NOT EXISTS buffalo_stage3b7_private_bridge_events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 probe_id TEXT NOT NULL,
 phase TEXT NOT NULL,
 code TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(probe_id,phase)
);
