/** No provider inference, PySD, shell, or arbitrary GitHub workflow. */
import {acceptOfflineTask,assertTaskId,makeDispatchInputs} from '../../scripts/control-plane/contract.mjs';
function status(task){return task?{task_id:task.task_id,kind:task.kind,state:task.state,
 input_sha256:task.input_sha256,github_run_id:task.github_run_id??null,
 result_sha256:task.result_sha256??null,github_artifact_id:task.github_artifact_id??null}:null}
// Whitelist-only response classification; never expose upstream exception text.
function preflightReason(error){
 const message=typeof error?.message==='string'?error.message:'';
 if(/^GITHUB_PREFLIGHT_(WORKFLOW|MAIN)_(HTTP_[1-5][0-9]{2}|INVALID_JSON|PATH_DENIED|FETCH_ABORT|NETWORK_TYPE_ERROR|IDENTITY_INVALID|SHA_INVALID|UNKNOWN)$/.test(message))
  return message;
 if(/^GITHUB_(WORKFLOW_NOT_ALLOWLISTED|BAD_MAIN_SHA|INVALID_JSON)$/.test(message))
  return 'GITHUB_PREFLIGHT_'+message.slice(7);
 const status=/^GITHUB_HTTP_([1-5][0-9]{2})$/.exec(message);
 if(status)return 'GITHUB_PREFLIGHT_HTTP_'+status[1];
 return 'GITHUB_PREFLIGHT_UNKNOWN';
}
export class ControlPlaneService{
 constructor(store,github,clock=()=>new Date().toISOString()){this.store=store;this.github=github;this.clock=clock}
 async create(input){
  const task=acceptOfflineTask(input),r=await this.store.create(task);
  return {code:r.created?201:200,body:{created:r.created,...status(r.task)}}
 }
 async inspect(id){
  const task=await this.store.read(assertTaskId(id));
  return {code:task?200:404,body:task?status(task):{error:'NOT_FOUND'}}
 }
 /** GET-only diagnostic: no state changes, no dispatch, no model calls. */
 async diagnoseGithub(){
  try{
   await this.github.prepare();
   return {code:200,body:{preflight:'OK',read_only:true,dispatch_attempted:false}};
  }catch(error){
   return {code:502,body:{preflight:'FAILED',reason_code:preflightReason(error),
    read_only:true,dispatch_attempted:false}};
  }
 }
 async dispatch(id){
  const taskId=assertTaskId(id),task=await this.store.read(taskId);
  if(!task)return {code:404,body:{error:'NOT_FOUND'}};
  if(task.state!=='READY')return {code:409,body:{error:'NOT_READY',state:task.state}};
  // Reject absent workflow on main BEFORE claiming or sending anything.
  let pin;
  try { pin=await this.github.prepare(); }
  catch (error) {
   // Return only a bounded protocol code; NEVER expose GitHub response bodies,
   // headers, account details, tokens or stack traces.
   const reason=preflightReason(error);
   return {code:502,body:{error:'GITHUB_PREFLIGHT_FAILED',reason_code:reason,
     task_id:taskId,state:'READY',dispatch_attempted:false}};
  }
  if(!await this.store.claim(taskId,pin.head_sha,pin.workflow_id,this.clock()))
   return {code:409,body:{error:'ALREADY_CLAIMED'}};
  const claimed={...task,state:'DISPATCHING',paid:false,workflow:'buffalo-control-plane-offline.yml'};
  try{await this.github.dispatch(makeDispatchInputs(claimed))}
  catch{
   // GitHub may have received the POST; never issue a duplicate automatically.
   await this.store.transition(taskId,'DISPATCHING','DISPATCH_UNKNOWN','DISPATCH_OUTCOME_UNKNOWN');
   return {code:202,body:{task_id:taskId,state:'DISPATCH_UNKNOWN',retry_allowed:false}};
  }
  await this.store.transition(taskId,'DISPATCHING','SUBMITTED','GITHUB_DISPATCH_ACCEPTED');
  return {code:202,body:{task_id:taskId,state:'SUBMITTED',run_id:null}}
 }
 async reconcile(id){
  const taskId=assertTaskId(id);let task=await this.store.read(taskId);
  if(!task)return {code:404,body:{error:'NOT_FOUND'}};
  if(['READY','SUCCEEDED','FAILED'].includes(task.state))
   return {code:200,body:{...status(task),reconciled:false}};
  try{
   let run;
   if(task.github_run_id)run=await this.github.getRun(task.github_run_id);
   else{
    const matches=await this.github.findRuns(task);
    if(matches.length>1){
     if(task.state!=='DISPATCH_UNKNOWN')
      await this.store.transition(taskId,task.state,'DISPATCH_UNKNOWN','MULTIPLE_RUN_MATCHES');
     return {code:409,body:{error:'MULTIPLE_RUN_MATCHES',state:'DISPATCH_UNKNOWN'}}
    }
    if(matches.length===0)return {code:202,body:{...status(task),reconciled:false,reason:'RUN_NOT_YET_VISIBLE'}};
    run=await this.github.getRun(matches[0].id);
   }
   this.github.checkRun(task,run);
   if(!task.github_run_id)await this.store.linkRun(taskId,run.id);
   task=await this.store.read(taskId);
   if(task.state==='DISPATCHING'){
    await this.store.transition(taskId,'DISPATCHING','DISPATCH_UNKNOWN','RECONCILING_UNKNOWN_POST');
    task=await this.store.read(taskId);
   }
   if(run.status!=='completed'){
    if((task.state==='SUBMITTED'||task.state==='DISPATCH_UNKNOWN')&&run.status==='in_progress')
     await this.store.transition(taskId,task.state,'RUNNING','GITHUB_RUN_IN_PROGRESS',{run_id:run.id});
    return {code:202,body:{...(await this.inspect(taskId)).body,reconciled:true,run_status:run.status}}
   }
   if(run.conclusion!=='success'){
    await this.store.transition(taskId,task.state,'FAILED','GITHUB_RUN_NON_SUCCESS',{run_id:run.id});
    return {code:200,body:{...(await this.inspect(taskId)).body,reconciled:true,run_conclusion:run.conclusion}}
   }
   // Run success is insufficient: verify artifact ZIP digest and inner JSON.
   const verified=await this.github.getVerifiedResult(task,run);
   await this.store.transition(taskId,task.state,'SUCCEEDED','VERIFIED_OFFLINE_ARTIFACT',{
    run_id:run.id,artifact_id:verified.artifact_id,result_sha256:verified.result_sha256});
   return {code:200,body:{...(await this.inspect(taskId)).body,reconciled:true,verified:true}}
  }catch{
   // Malformed, missing or unverifiable evidence must never mark SUCCESS.
   if(task.state==='DISPATCH_UNKNOWN')
    return {code:409,body:{error:'RECONCILIATION_REQUIRES_REVIEW'}};
   if(['DISPATCHING','SUBMITTED','RUNNING'].includes(task.state))
    await this.store.transition(taskId,task.state,'DISPATCH_UNKNOWN','EVIDENCE_UNVERIFIED');
   return {code:409,body:{error:'EVIDENCE_UNVERIFIED',state:'DISPATCH_UNKNOWN'}}
  }
 }
}
