"""SQLite-only regression for separate source attestation, source-bound receipts and immutability.
Not a live GitHub API or D1 Worker integration test.
"""
import pathlib
import sqlite3

root=pathlib.Path(__file__).resolve().parents[2]
db=sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
for name in ('0001_tasks.sql','0002_dispatch_link.sql','0003_full_handoffs.sql',
             '0004_full_source_attestations.sql'):
 db.executescript((root/'migrations/control-plane'/name).read_text())
ID='123e4567-e89b-42d3-a456-426614174601'
SHA='a'*64
HEAD='b'*40
manifest=(ID,'BUFFALO_FULL_HANDOFF_V1','BUFFALO_FULL_HANDOFF_MANIFEST_V1',
 'merlin','policyImplementation','dialysisClinic',0,'sfd',HEAD,
 SHA,SHA,SHA,SHA,SHA,SHA)
db.execute(
 'INSERT INTO buffalo_full_handoffs (handoff_id,kind,schema_version,state,agent,'
 'benchmark,scenario_id,case_index,mode,commit_sha,source_sha256,'
 'agent_config_sha256,prompt_sha256,initial_model_sha256,parameters_sha256,'
 'manifest_sha256,execution_allowed,provenance_verified,github_run_id) '
 "VALUES (?,?,?,'REGISTERED_UNVERIFIED',?,?,?,?,?,?,?,?,?,?,?,?,0,0,NULL)",manifest)
sql=(
 'INSERT INTO buffalo_full_source_attestations (handoff_id,proof_schema,'
 'proof_status,repo,workflow,workflow_id,github_run_id,github_artifact_id,'
 'commit_sha,manifest_sha256,artifact_sha256,result_sha256,execution_allowed) '
 "SELECT ?,'BUFFALO_FULL_SOURCE_PROOF_V1','SOURCE_ATTESTED',"
 "'yudocyudoc/buffalo-01','buffalo-full-source-proof.yml',"
 '?,?,?,?,?,?,?,0 FROM buffalo_full_handoffs '
 "WHERE handoff_id=? AND state='REGISTERED_UNVERIFIED' AND "
 'commit_sha=? AND manifest_sha256=? '
 'ON CONFLICT(handoff_id) DO NOTHING'
)
args=(ID,95,100,300,HEAD,SHA,'c'*64,'d'*64,ID,HEAD,SHA)
event=(
 'INSERT INTO buffalo_full_source_events (handoff_id,actor,event,evidence_sha256) '
 "SELECT ?,'WORKER_GITHUB_SOURCE_V1','SOURCE_ATTESTED',? WHERE changes()=1"
)
for _ in range(8):
 with db:
  db.execute(sql,args)
  db.execute(event,(ID,'d'*64))
assert db.execute('SELECT COUNT(*) FROM buffalo_full_source_attestations').fetchone()[0]==1
assert db.execute('SELECT COUNT(*) FROM buffalo_full_source_events').fetchone()[0]==1
assert db.execute('SELECT state,execution_allowed,provenance_verified,github_run_id'
 ' FROM buffalo_full_handoffs WHERE handoff_id=?',(ID,)).fetchone()==(
 'REGISTERED_UNVERIFIED',0,0,None)
assert db.execute('SELECT proof_status,execution_allowed FROM buffalo_full_source_attestations'
 ' WHERE handoff_id=?',(ID,)).fetchone()==('SOURCE_ATTESTED',0)

def rejects(query,parameters=()):
 try:
  with db:
   db.execute(query,parameters)
  raise AssertionError('Expected SQL rejection')
 except sqlite3.IntegrityError:
  pass

# Preserve evidence against overwrites/deletes and duplicated run or artifact IDs.
rejects('UPDATE buffalo_full_source_attestations SET github_run_id=200 WHERE handoff_id=?',(ID,))
rejects('DELETE FROM buffalo_full_source_attestations WHERE handoff_id=?',(ID,))
rejects('UPDATE buffalo_full_source_events SET evidence_sha256=? WHERE handoff_id=?',('f'*64,ID))
rejects('DELETE FROM buffalo_full_source_events WHERE handoff_id=?',(ID,))
rejects("UPDATE buffalo_full_handoffs SET provenance_verified=1 WHERE handoff_id=?",(ID,))
rejects("UPDATE buffalo_full_handoffs SET execution_allowed=1 WHERE handoff_id=?",(ID,))
rejects("UPDATE buffalo_full_handoffs SET state='SUCCEEDED' WHERE handoff_id=?",(ID,))
# Forged non-existent handoff must insert nothing, no orphan event.
wrong='123e4567-e89b-42d3-a456-426614174999'
with db:
 r=db.execute(sql,(wrong,95,101,301,HEAD,SHA,'c'*64,'e'*64,wrong,HEAD,SHA))
 assert r.rowcount==0
 r=db.execute(event,(wrong,'e'*64))
 assert r.rowcount==0

print('PASS stage2.5: source attestation is separate, idempotent, source-bound,'
 ' execution-disabled, audit-immutable; SQLite only.')
