"""SQLite-only check for D1 migration syntax and conditional state audit events.
This is NOT a live Cloudflare D1 integration test.
"""
import pathlib
import sqlite3
root=pathlib.Path(__file__).resolve().parents[2]
db=sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
for filename in ('0001_tasks.sql','0002_dispatch_link.sql'):
    db.executescript((root/'migrations/control-plane'/filename).read_text())
ident='123e4567-e89b-42d3-a456-426614174000'
sha='a'*64
for _ in range(2):
    with db:
        db.execute('INSERT INTO buffalo_tasks (task_id,kind,input_sha256,state) VALUES (?,?,?,?) ON CONFLICT(task_id) DO NOTHING',(ident,'BUFFALO_OFFLINE_ECHO_V1',sha,'READY'))
        db.execute("INSERT INTO buffalo_task_events (task_id,actor,old_state,new_state,reason_code) SELECT ?,'WORKER_V1',NULL,'READY','TASK_ADMITTED' WHERE changes()=1",(ident,))
assert db.execute('SELECT COUNT(*) FROM buffalo_task_events').fetchone()[0]==1
for _ in range(2):
    with db:
        db.execute("UPDATE buffalo_tasks SET state='DISPATCHING',dispatch_head_sha=?,github_workflow_id=?,dispatch_started_at=?,updated_at=CURRENT_TIMESTAMP WHERE task_id=? AND state='READY'",('b'*40,22,'2026-11-21T20:00:00Z',ident))
        db.execute("INSERT INTO buffalo_task_events (task_id,actor,old_state,new_state,reason_code) SELECT ?,'WORKER_V1','READY','DISPATCHING','DISPATCH_CLAIMED' WHERE changes()=1",(ident,))
assert db.execute("SELECT COUNT(*) FROM buffalo_task_events WHERE reason_code='DISPATCH_CLAIMED'").fetchone()[0]==1
assert db.execute('SELECT state FROM buffalo_tasks WHERE task_id=?',(ident,)).fetchone()[0]=='DISPATCHING'
print('D1-compatible SQLite migrations and optimistic claim/event checks: PASS')
