"""Stage-2 SQLite smoke: exact migration and conditional INSERT/event semantics.
Offline only; does NOT prove the deployed Workers binding or GitHub provenance.
"""
import pathlib
import sqlite3

root = pathlib.Path(__file__).resolve().parents[2]
con = sqlite3.connect(':memory:')
con.execute('PRAGMA foreign_keys=ON')
for name in ('0001_tasks.sql','0002_dispatch_link.sql','0003_full_handoffs.sql'):
    con.executescript((root/'migrations/control-plane'/name).read_text())

HID='123e4567-e89b-42d3-a456-426614174111'
SHA='a'*64
COMMIT='b'*40
params=(HID,'BUFFALO_FULL_HANDOFF_V1','BUFFALO_FULL_HANDOFF_MANIFEST_V1',
        'merlin','policyImplementation','coffeePeak',0,'sfd',COMMIT,
        SHA,SHA,SHA,SHA,SHA,SHA)
insert=("INSERT INTO buffalo_full_handoffs ("
  "handoff_id,kind,schema_version,state,agent,benchmark,scenario_id,case_index,mode,"
  "commit_sha,source_sha256,agent_config_sha256,prompt_sha256,initial_model_sha256,"
  "parameters_sha256,manifest_sha256,execution_allowed,provenance_verified,github_run_id) "
  "VALUES (?,?,?,'REGISTERED_UNVERIFIED',?,?,?,?,?,?,?,?,?,?,?,?,0,0,NULL) "
  "ON CONFLICT(handoff_id) DO NOTHING")
event=("INSERT INTO buffalo_full_handoff_events (handoff_id,actor,event,manifest_sha256)"
       " SELECT ?,'WORKER_HANDOFF_V1','DECLARATION_ADMITTED',? WHERE changes()=1")
for attempt in range(8):
    with con:
        con.execute(insert,params)
        con.execute(event,(HID,SHA))
assert con.execute('SELECT COUNT(*) FROM buffalo_full_handoffs').fetchone()[0]==1
assert con.execute('SELECT COUNT(*) FROM buffalo_full_handoff_events').fetchone()[0]==1
row=con.execute('SELECT state,execution_allowed,provenance_verified,github_run_id'
  ' FROM buffalo_full_handoffs WHERE handoff_id=?',(HID,)).fetchone()
assert row==('REGISTERED_UNVERIFIED',0,0,None),row

def rejected(query,params=()):
    try:
        with con:con.execute(query,params)
        raise AssertionError('Expected a constrained write to fail')
    except sqlite3.IntegrityError:
        return

rejected("UPDATE buffalo_full_handoffs SET execution_allowed=1 WHERE handoff_id=?",(HID,))
rejected("UPDATE buffalo_full_handoffs SET provenance_verified=1 WHERE handoff_id=?",(HID,))
rejected("UPDATE buffalo_full_handoffs SET state='SUCCEEDED' WHERE handoff_id=?",(HID,))
rejected("UPDATE buffalo_full_handoffs SET github_run_id=999 WHERE handoff_id=?",(HID,))
rejected("INSERT INTO buffalo_tasks(task_id,kind,input_sha256,state)"
         " VALUES (?,?,?,'READY')",('123e4567-e89b-42d3-a456-426614174222',
         'BUFFALO_FULL_HANDOFF_V1',SHA))
rejected("INSERT INTO buffalo_full_handoff_events(handoff_id,actor,event,manifest_sha256)"
         " VALUES (?,'WORKER_HANDOFF_V1','DECLARATION_ADMITTED',?)",
         ('123e4567-e89b-42d3-a456-426614174999',SHA))

# A malformed batch's second statement must roll back its preceding insert.
new_id='123e4567-e89b-42d3-a456-426614174333'
try:
    with con:
        con.execute(insert,(new_id,)+params[1:])
        con.execute(event,('123e4567-e89b-42d3-a456-426614174999',SHA))
    raise AssertionError('bad foreign key did not fail')
except sqlite3.IntegrityError:
    pass
assert con.execute('SELECT COUNT(*) FROM buffalo_full_handoffs WHERE handoff_id=?',
                   (new_id,)).fetchone()[0]==0
assert con.execute('SELECT COUNT(*) FROM buffalo_tasks').fetchone()[0]==0
print('PASS stage2 separate handoff tables: 8 idempotent inserts, 1 audit event, '
      'immutable non-executable status, FK and rollback. SQLite only.')
