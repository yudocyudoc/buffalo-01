#!/usr/bin/env python3
"""Stage 3B-1: prove D1 schema does not confer inference on attested sources."""
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
con = sqlite3.connect(":memory:")
con.execute("PRAGMA foreign_keys=ON")
for name in ("0003_full_handoffs.sql", "0004_full_source_attestations.sql",
             "0005_full_live_grants_lab.sql"):
    con.executescript((ROOT / "migrations" / "control-plane" / name).read_text())

id_h = "6bce82ee-d179-4a2e-9317-f7f4708c5be2"
id_g = "123e4567-e89b-42d3-a456-426614174111"
commit = "66bee2d96ec71692608fc0829486c2dc130ab7a0"
sha = "a" * 64
manifest = "462b4fbb820c5813ce9087af827b667a01855a63a0f2ab1498df4d3145650f05"
con.execute("""
INSERT INTO buffalo_full_handoffs (
 handoff_id, kind, schema_version, agent, benchmark, scenario_id,
 case_index, mode, commit_sha, source_sha256, agent_config_sha256,
 prompt_sha256, initial_model_sha256, parameters_sha256, manifest_sha256
) VALUES (?, 'BUFFALO_FULL_HANDOFF_V1', 'BUFFALO_FULL_HANDOFF_MANIFEST_V1',
 'merlin', 'policyImplementation', 'dialysisClinic', 0, 'sfd',
 ?, ?, ?, ?, ?, ?, ?)
""", (id_h, commit, sha, sha, sha, sha, sha, manifest))
con.execute("""
INSERT INTO buffalo_full_source_attestations (
 handoff_id, proof_schema, proof_status, repo, workflow, workflow_id,
 github_run_id, github_artifact_id, commit_sha, manifest_sha256,
 artifact_sha256, result_sha256
) VALUES (?, 'BUFFALO_FULL_SOURCE_PROOF_V1', 'SOURCE_ATTESTED',
 'yudocyudoc/buffalo-01', 'buffalo-full-source-proof.yml', 426442743,
 44976002057, 14735612574, ?, ?, ?, ?)
""", (id_h, commit, manifest, sha, sha))

# SOURCE_ATTESTED itself is not a grant, and the original handoff is immutable.
assert con.execute("SELECT COUNT(*) FROM buffalo_full_live_grants").fetchone()[0] == 0
assert con.execute("SELECT execution_allowed FROM buffalo_full_handoffs").fetchone()[0] == 0
assert con.execute("SELECT execution_allowed FROM buffalo_full_source_attestations").fetchone()[0] == 0

# Insert an explicitly non-executable PENDING record (fixture only, in-memory).
con.execute("""
INSERT INTO buffalo_full_live_grants (
 grant_id, handoff_id, grant_schema, agent, provider, mode,
 commit_sha, manifest_sha256
) VALUES (?, ?, 'BUFFALO_ORIGINAL_LIVE_GRANT_V1', 'merlin', 'cloudflare',
 'sfd', ?, ?)
""", (id_g, id_h, commit, manifest))
pending = con.execute("""
 SELECT state,consent_for_inference,max_posts,max_neurons,approved_at
 FROM buffalo_full_live_grants WHERE grant_id=?
""", (id_g,)).fetchone()
assert pending == ("PENDING", 0, 0, 0, None)

# A partial/forged approval without required evidence must be rejected.
for attempted in (
 "UPDATE buffalo_full_live_grants SET state='APPROVED' WHERE grant_id=?",
 "UPDATE buffalo_full_live_grants SET max_posts=2 WHERE grant_id=?",
 "UPDATE buffalo_full_live_grants SET consent_for_inference=1 WHERE grant_id=?",
):
    try:
        con.execute(attempted, (id_g,))
        raise AssertionError("invalid approval was accepted")
    except sqlite3.IntegrityError:
        pass

# Even a fully populated fixture represents an approval in THIS test DB only.
# This operation is deliberately not exposed as a Worker endpoint.
con.execute("""
UPDATE buffalo_full_live_grants
 SET state='APPROVED', consent_for_inference=1, max_posts=3, max_neurons=50000,
 approval_actor='SYNTHETIC_SQL_TEST', approval_receipt_sha256=?,
 approved_at='2026-11-22 03:00:00', expires_at='2026-11-22 06:00:00'
 WHERE grant_id=?
""", (sha, id_g))
assert con.execute("SELECT state FROM buffalo_full_live_grants").fetchone()[0] == "APPROVED"

# No existing proof or declaration is mutated by the independent grant table.
assert con.execute("SELECT execution_allowed FROM buffalo_full_handoffs").fetchone()[0] == 0
assert con.execute("SELECT execution_allowed FROM buffalo_full_source_attestations").fetchone()[0] == 0
print("PASS stage3B-1 D1: attestation != approval, pending grants have no consent, no production mutations")
