-- Buffalo Full stage 3B-1: explicit, single-connection authorization for
-- ORIGINAL interactive WebSocket Buffalo. LAB ONLY. Never a side-effect of
-- SOURCE_ATTESTED. No writer/API creates APPROVED grants in this change.
-- This schema is deliberately independent from the old offline echo tasks.
CREATE TABLE IF NOT EXISTS buffalo_full_live_grants (
  grant_id TEXT PRIMARY KEY,
  handoff_id TEXT NOT NULL REFERENCES buffalo_full_source_attestations(handoff_id),
  grant_schema TEXT NOT NULL CHECK(grant_schema='BUFFALO_ORIGINAL_LIVE_GRANT_V1'),
  agent TEXT NOT NULL CHECK(agent IN ('merlin','socrates','themis','athena_SFD')),
  provider TEXT NOT NULL CHECK(provider='cloudflare'),
  mode TEXT NOT NULL CHECK(mode='sfd'),
  commit_sha TEXT NOT NULL CHECK(length(commit_sha)=40),
  manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64),
  state TEXT NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','APPROVED','REVOKED')),
  consent_for_inference INTEGER NOT NULL DEFAULT 0 CHECK(consent_for_inference IN (0,1)),
  max_posts INTEGER NOT NULL DEFAULT 0 CHECK(max_posts BETWEEN 0 AND 50),
  max_neurons INTEGER NOT NULL DEFAULT 0 CHECK(max_neurons BETWEEN 0 AND 1000000),
  approval_actor TEXT,
  approval_receipt_sha256 TEXT CHECK(approval_receipt_sha256 IS NULL OR length(approval_receipt_sha256)=64),
  approved_at TEXT,
  expires_at TEXT,
  claimed_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(state!='APPROVED' OR
    (consent_for_inference=1 AND max_posts>0 AND max_neurons>0 AND
     approval_actor IS NOT NULL AND approval_receipt_sha256 IS NOT NULL AND
     approved_at IS NOT NULL AND expires_at IS NOT NULL)),
  CHECK(state!='PENDING' OR
    (consent_for_inference=0 AND max_posts=0 AND max_neurons=0 AND
     approval_actor IS NULL AND approval_receipt_sha256 IS NULL AND
     approved_at IS NULL AND claimed_at IS NULL)),
  CHECK(state!='REVOKED' OR revoked_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_buffalo_full_live_grants_handoff
 ON buffalo_full_live_grants(handoff_id,state);

-- No INSERT/UPDATE endpoint for grants here. Grant issuance/revocation must
-- later be bound to a separately authenticated user approval and audit event.
-- No existing SOURCE_ATTESTED or REGISTERED_UNVERIFIED row is modified.
