/** Buffalo offline control-plane contract: no paid tasks or arbitrary commands. */
export const OFFLINE_KIND='BUFFALO_OFFLINE_ECHO_V1';
export const OFFLINE_WORKFLOW='buffalo-control-plane-offline.yml';
export const STATES=Object.freeze(['READY','DISPATCHING','SUBMITTED','RUNNING','SUCCEEDED','FAILED','DISPATCH_UNKNOWN']);
const TRANSITIONS=Object.freeze({
READY:['DISPATCHING'],DISPATCHING:['SUBMITTED','DISPATCH_UNKNOWN'],
SUBMITTED:['RUNNING','SUCCEEDED','FAILED','DISPATCH_UNKNOWN'],
RUNNING:['SUCCEEDED','FAILED','DISPATCH_UNKNOWN'],
DISPATCH_UNKNOWN:['SUBMITTED','RUNNING','SUCCEEDED','FAILED'],
SUCCEEDED:[],FAILED:[]});
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE=/^[0-9a-f]{64}$/i;
export function assertTaskId(v){if(typeof v!=='string'||!UUID_RE.test(v))throw Error('CONTROL_PLANE_INVALID_TASK_ID');return v.toLowerCase()}
export function assertSha256(v){if(typeof v!=='string'||!SHA256_RE.test(v))throw Error('CONTROL_PLANE_INVALID_SHA256');return v.toLowerCase()}
export function acceptOfflineTask(v){
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error('CONTROL_PLANE_INVALID_TASK');
 if(Object.keys(v).some(k=>!['task_id','kind','input_sha256'].includes(k)))throw Error('CONTROL_PLANE_EXTRA_FIELD');
 if(v.kind!==OFFLINE_KIND)throw Error('CONTROL_PLANE_KIND_NOT_ALLOWED');
 return Object.freeze({task_id:assertTaskId(v.task_id),kind:OFFLINE_KIND,
  input_sha256:assertSha256(v.input_sha256),workflow:OFFLINE_WORKFLOW,state:'READY',paid:false});
}
export function assertTransition(from,to){
 if(!STATES.includes(from)||!STATES.includes(to)||!TRANSITIONS[from].includes(to))
  throw Error('CONTROL_PLANE_INVALID_TRANSITION');
 return {from,to};
}
export function makeDispatchInputs(task){
 if(!task||task.kind!==OFFLINE_KIND||task.workflow!==OFFLINE_WORKFLOW||task.paid!==false)
  throw Error('CONTROL_PLANE_DISPATCH_NOT_ALLOWED');
 assertTaskId(task.task_id);
 if(task.state!=='DISPATCHING')throw Error('CONTROL_PLANE_DISPATCH_NOT_CLAIMED');
 return Object.freeze({ref:'main',inputs:{task_id:task.task_id,input_sha256:assertSha256(task.input_sha256)}});
}
export function canAutoRedispatch(state){if(!STATES.includes(state))throw Error('CONTROL_PLANE_UNKNOWN_STATE');return false}
