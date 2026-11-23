#!/usr/bin/env python3
"""Offline-only SQLite proof for the isolated Stage 3B-7 audit migration."""
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[2]
SQL = (ROOT / "migrations/control-plane/lab/0003_stage3b7_observability.sql").read_text()
PROBE_ID = "one-shot-private-bridge-v1"

con = sqlite3.connect(":memory:")
con.executescript(SQL)
con.executescript(SQL)  # idempotent, no changes to source/hand-off tables
tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
assert "buffalo_stage3b7_private_bridge_receipts" in tables
assert "buffalo_stage3b7_private_bridge_events" in tables
assert "buffalo_full_live_grants" not in tables

for i in range(2):
    cur = con.execute(
        "INSERT INTO buffalo_stage3b7_private_bridge_events "
        "(probe_id,phase,code) VALUES (?,?,NULL) "
        "ON CONFLICT(probe_id,phase) DO NOTHING",
        (PROBE_ID, "SCHEDULED_ENTERED"),
    )
    assert cur.rowcount == (1 if i == 0 else 0), "entry admission is not one-shot"
for phase in ("CLAIM_READ_REQUESTED", "CLAIM_ABSENT", "PREFLIGHT_FAILED"):
    con.execute(
        "INSERT INTO buffalo_stage3b7_private_bridge_events "
        "(probe_id,phase,code) VALUES (?,?,?) "
        "ON CONFLICT(probe_id,phase) DO NOTHING",
        (PROBE_ID, phase, None),
    )
assert con.execute(
    "SELECT count(*) FROM buffalo_stage3b7_private_bridge_events WHERE probe_id=?",
    (PROBE_ID,),
).fetchone()[0] == 4
con.execute(
    "INSERT INTO buffalo_stage3b7_private_bridge_receipts "
    "(probe_id,handoff_id,commit_sha,status,receipt_json) VALUES (?,?,?,?,?) "
    "ON CONFLICT(probe_id) DO UPDATE SET status=excluded.status,receipt_json=excluded.receipt_json",
    (PROBE_ID, "test-handoff", "test-commit", "BRIDGE_PROBE_PREPARED", "{}"),
)
con.execute(
    "INSERT INTO buffalo_stage3b7_private_bridge_receipts "
    "(probe_id,handoff_id,commit_sha,status,receipt_json) VALUES (?,?,?,?,?) "
    "ON CONFLICT(probe_id) DO UPDATE SET status=excluded.status,receipt_json=excluded.receipt_json",
    (PROBE_ID, "test-handoff", "test-commit", "REAL_BRIDGE_HANDSHAKE_FAILED", "{}"),
)
assert con.execute(
    "SELECT status FROM buffalo_stage3b7_private_bridge_receipts WHERE probe_id=?",
    (PROBE_ID,),
).fetchone()[0] == "REAL_BRIDGE_HANDSHAKE_FAILED"
print("STAGE3B7_DIAGNOSTICS_SQLITE_SCHEMA_IDEMPOTENCY_PASS_OFFLINE")
