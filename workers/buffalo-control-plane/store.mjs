/** D1 persistence: conditional UPDATE and audit event in one D1.batch transaction. */
import {acceptOfflineTask,assertTaskId,assertTransition,assertSha256} from '../../scripts/control-plane/contract.mjs';
const inserted=r=>r?.meta?.changes===1;
export class D1TaskStore{
 constructor(db){if(!db?.prepare||!db?.batch)throw Error('D1_BINDING_REQUIRED');this.db=db}
 async read(id){return this.db.prepare('SELECT * FROM buffalo_tasks WHERE task_id = ?').bind(assertTaskId(id)).first()}
 async create(value){
  const task=acceptOfflineTask(value);
  const insert=this.db.prepare(`INSERT INTO buffalo_tasks (task_id,kind,input_sha256,state)
   VALUES (?,?,?,'READY') ON CONFLICT(task_id) DO NOTHING`).bind(task.task_id,task.kind,task.input_sha256);
  const event=this.db.prepare(`INSERT INTO buffalo_task_events (task_id,actor,old_state,new_state,reason_code)
   SELECT ?,'WORKER_V1',NULL,'READY','TASK_ADMITTED' WHERE changes()=1`).bind(task.task_id);
  const [write]=await this.db.batch([insert,event]);const actual=await this.read(task.task_id);
  if(!actual||actual.kind!==task.kind||actual.input_sha256!==task.input_sha256)
   throw Error('CONTROL_PLANE_TASK_ID_CONFLICT');
  return {task:actual,created:inserted(write)}
 }
 async claim(id,headSha,workflowId,date){
  const taskId=assertTaskId(id);
  if(!/^[0-9a-f]{40}$/.test(headSha)||!Number.isSafeInteger(workflowId)||workflowId<1||
     !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(date))throw Error('CONTROL_PLANE_BAD_DISPATCH_PIN');
  const first=this.db.prepare(`UPDATE buffalo_tasks SET state='DISPATCHING',
   dispatch_head_sha=?,github_workflow_id=?,dispatch_started_at=?,updated_at=CURRENT_TIMESTAMP
   WHERE task_id=? AND state='READY'`).bind(headSha,workflowId,date,taskId);
  const event=this.db.prepare(`INSERT INTO buffalo_task_events(task_id,actor,old_state,new_state,reason_code)
   SELECT ?,'WORKER_V1','READY','DISPATCHING','DISPATCH_CLAIMED' WHERE changes()=1`).bind(taskId);
  const [r]=await this.db.batch([first,event]);return inserted(r)
 }
 async transition(id,from,to,reason,extra={}){
  const taskId=assertTaskId(id);assertTransition(from,to);
  if(!/^[A-Z][A-Z0-9_]{2,64}$/.test(reason))throw Error('CONTROL_PLANE_BAD_REASON');
  const runId=extra.run_id??null,artifactId=extra.artifact_id??null,resultSha=extra.result_sha256??null;
  if(runId!==null&&(!Number.isSafeInteger(runId)||runId<1))throw Error('CONTROL_PLANE_BAD_RUN_ID');
  if(artifactId!==null&&(!Number.isSafeInteger(artifactId)||artifactId<1))throw Error('CONTROL_PLANE_BAD_ARTIFACT_ID');
  if(resultSha!==null)assertSha256(resultSha);
  const first=this.db.prepare(`UPDATE buffalo_tasks SET state=?,
   github_run_id=COALESCE(github_run_id,?),github_artifact_id=COALESCE(github_artifact_id,?),
   result_sha256=COALESCE(result_sha256,?),updated_at=CURRENT_TIMESTAMP
   WHERE task_id=? AND state=? AND (? IS NULL OR github_run_id IS NULL OR github_run_id=?)
   AND (? IS NULL OR github_artifact_id IS NULL OR github_artifact_id=?)`).bind(
   to,runId,artifactId,resultSha,taskId,from,runId,runId,artifactId,artifactId);
  const event=this.db.prepare(`INSERT INTO buffalo_task_events
   (task_id,actor,old_state,new_state,reason_code,evidence_sha256)
   SELECT ?,'WORKER_V1',?,?,?,? WHERE changes()=1`).bind(taskId,from,to,reason,resultSha);
  const [r]=await this.db.batch([first,event]);return inserted(r)
 }
 async linkRun(id,runId){
  const taskId=assertTaskId(id);
  if(!Number.isSafeInteger(runId)||runId<1)throw Error('CONTROL_PLANE_BAD_RUN_ID');
  const first=this.db.prepare(`UPDATE buffalo_tasks SET github_run_id=?,updated_at=CURRENT_TIMESTAMP
    WHERE task_id=? AND github_run_id IS NULL AND state IN
    ('DISPATCHING','SUBMITTED','RUNNING','DISPATCH_UNKNOWN')`).bind(runId,taskId);
  const event=this.db.prepare(`INSERT INTO buffalo_task_events(task_id,actor,old_state,new_state,reason_code)
    SELECT ?,'WORKER_V1',state,state,'GITHUB_RUN_LINKED'
    FROM buffalo_tasks WHERE task_id=? AND changes()=1`).bind(taskId,taskId);
  const [r]=await this.db.batch([first,event]);const task=await this.read(taskId);
  if(!task||task.github_run_id!==runId)throw Error('CONTROL_PLANE_RUN_LINK_CONFLICT');
  return inserted(r)
 }
}
