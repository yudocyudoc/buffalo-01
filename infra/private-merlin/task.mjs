import {MODEL,PROJECT,checkInput,checkTaskKey,grant,requireThat,elapsedLimit,verifyClaim} from './protocol.mjs';
import {readTurn} from './socket.mjs';

function publicTask(task){
  if(!task)return null;
  const {sd_json,...view}=task;
  return view;
}

export async function readTask(storage,key){
  checkTaskKey(key);
  const task=await storage.get('task');
  return task?.task_id===key.task_id && task.phase===key.phase?publicTask(task):null;
}

export async function enqueue(storage,env,input){
  await checkInput(input);
  return storage.transaction(async tx=>{
    const previous=await tx.get('task');
    if(previous){
      requireThat(previous.task_id===input.task_id && previous.project_id===input.project_id &&
        previous.phase===input.phase && previous.sd_json===input.sd_json,'TASK_ID_CONFLICT');
      return publicTask(previous);
    }
    const g=grant(env,input.phase);
    requireThat(input.task_id===g.task_id,'TASK_NOT_GRANTED');
    const task={project_id:PROJECT,task_id:g.task_id,phase:g.phase,model_sha256:MODEL,
      sd_json:input.sd_json,source_commit:g.source_commit,image_digest:g.image_digest,
      approval:g,status:'QUEUED',created_at:Date.now()};
    await tx.put('task',task);
    await tx.setAlarm(Date.now());
    return publicTask(task);
  });
}

export async function runTask(storage,env){
  const {task,start}=await storage.transaction(async tx=>{
    const task=await tx.get('task');
    if(task?.status!=='QUEUED')return {task,start:false};
    task.status='RUNNING';
    await tx.put('task',task);
    // A restarted bridge may reconcile the existing receipt, never resubmit work.
    await tx.setAlarm(Date.now()+elapsedLimit+15000);
    return {task,start:true};
  });
  if(task?.status!=='RUNNING')return;
  const router=env.ROUTER;
  let receipt, error;
  if(start){
    let opened=false, transcript=null;
    try{
      const g=grant(env,task.phase);
      verifyClaim(g,task.approval);
      const {deadline}=await router.open(task);
      opened=true;
      const response=await router.fetch('https://router/'+task.phase,{
        headers:{Upgrade:'websocket','x-task-id':task.task_id}});
      requireThat(response.status===101 && response.webSocket,'WS_UPGRADE_FAILED');
      transcript=await readTurn(response.webSocket,task.phase,JSON.parse(task.sd_json),deadline);
    }catch(e){error=String(e.message).match(/^[A-Z_]{3,64}$/)?.[0]??'PRIVATE_ROUTE_FAILED';}
    if(opened)receipt=await router.finish(task.phase,transcript);
  }
  receipt??=await router.result(task.phase);
  if(receipt?.task_id===task.task_id && receipt.status==='RUNNING'){
    await storage.setAlarm(Date.now()+10000);
    return;
  }
  const own=receipt?.task_id===task.task_id && receipt.source_commit===task.source_commit &&
    receipt.image_digest===task.image_digest;
  await storage.transaction(async tx=>{
    const s=await tx.get('task');
    if(s.status!=='RUNNING')return;
    await tx.put('task',{...s,status:own?receipt.status:'RUNTIME_FAILURE',
      receipt:own?receipt:null,error:error??null,finished_at:Date.now()});
    await tx.deleteAlarm();
  });
}
