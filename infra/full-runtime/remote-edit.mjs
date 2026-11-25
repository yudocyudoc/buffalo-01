import {readSession,assertDemand} from './session-client.mjs';
export const ID='one-shot-buffalo-full-original-edit-v1';
export const PROJECT='buffalo-full-edit-v1';
export const LIMIT=6;
export const PASS='FULL_REMOTE_ORIGINAL_EDIT_PERSISTED';
const check=(ok,reason)=>{if(!ok)throw Error(reason)};
const table='buffalo_stage3b8r1_receipts';
const model0=()=>({variables:[{name:'Demand',type:'variable',equation:'3'}],relationships:[]});
export function validGrant(g,now=Date.now()){
 return g?.project===PROJECT&&g.max_calls===LIMIT&&/^[a-f0-9]{40}$/.test(g.source_commit)&&
 /^sha256:[a-f0-9]{64}$/.test(g.image_digest)&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(g.run_id)&&
 Number.isSafeInteger(g.expires)&&g.expires>now&&g.expires-now<=22*60000;
}
export async function runEdit(env){
 const g=JSON.parse(env.FULL_EDIT_GRANT??'null');
 if(!validGrant(g)||!env.APP_AUTH_KEY)return;
 const claim={probe_id:ID,run_id:g.run_id,status:'CLAIMED',approval:g,claimed_at:new Date().toISOString()};
 const ins=await env.DB.prepare('INSERT INTO '+table+' (probe_id,run_id,status,receipt_json) VALUES (?,?,?,?) ON CONFLICT(probe_id) DO NOTHING').bind(ID,g.run_id,'CLAIMED',JSON.stringify(claim)).run();
 if(ins.meta?.changes!==1)return;
 const evidence={...claim,status:'RUNTIME_FAILURE',tools:[],inferences:[],container_stopped:false};
 const deadline=Math.min(g.expires,Date.now()+180000);
 const req=(path,init={})=>{
  const headers=new Headers(init.headers);headers.set('x-buffalo-project',PROJECT);
  return env.FULL.fetch(new Request('http://buffalo.internal'+path,{...init,headers}));
 };
 let stage='INITIALIZE',etag,started=false;
 const stop=async()=>{const r=await env.FULL.stop(PROJECT);check(r?.container_stopped===true,'STOP_UNCONFIRMED');evidence.container_stopped=true};
 const receipts=async()=>{
  for(let i=1;i<=LIMIT;i++){
   const r=await req('/project/inference/'+i);
   if(r.status===404)break;
   check(r.ok,'RECEIPT_READ');evidence.inferences.push({attempt:i,...await r.json()});
  }
 };
 try{
  check(validGrant(g),'GRANT_EXPIRED');
  const create=await req('/project/model',{method:'PUT',headers:{'if-none-match':'*'},body:JSON.stringify(model0())});
  check(create.status===201,'PROJECT_NOT_FRESH');etag=create.headers.get('etag');check(etag==='"1"','INITIAL_REVISION');
  evidence.initial_model=model0();
  stage='REST';started=true;
  const status=await req('/status');check(status.ok,'APP_STATUS');await status.body?.cancel();
  const catalog=await req('/api/v1/engines');check(catalog.ok,'ENGINE_CATALOG');
  const data=await catalog.json();check(data.success&&data.engines.some(e=>e.name==='predprey'),'ENGINE_CATALOG');evidence.engines=data.engines.map(e=>e.name);
  stage='EDIT';
  const r=await req('/api/v1',{headers:{Upgrade:'websocket'}});
  check(r.status===101&&r.webSocket,'WS_UPGRADE');
  evidence.session=await readSession(r.webSocket,{mode:'sfd',key:env.APP_AUTH_KEY,model:model0(),agent:'merlin',edit:true,tools:evidence.tools,deadline,
   save:async model=>{const s=await req('/project/model',{method:'PUT',headers:{'if-match':etag},body:JSON.stringify(model)});
    check(s.status===204,'MODEL_SAVE');etag=s.headers.get('etag');}});
  stage='PERSISTENCE';
  const stale=await req('/project/model',{method:'PUT',headers:{'if-match':'"1"'},body:JSON.stringify(model0())});
  check(stale.status===412,'STALE_WRITE_ACCEPTED');evidence.stale_write_rejected=true;
  await stop();
  const recovered=await req('/project/model');check(recovered.ok&&recovered.headers.get('etag')===etag,'RECOVERY_REVISION');
  evidence.recovered_model=await recovered.json();assertDemand(evidence.recovered_model,'5');evidence.revision=etag;
  stage='REOPEN';evidence.container_stopped=false;
  const again=await req('/api/v1',{headers:{Upgrade:'websocket'}});
  check(again.status===101&&again.webSocket,'REOPEN_UPGRADE');
  const reopened=await readSession(again.webSocket,{mode:'sfd',key:env.APP_AUTH_KEY,model:evidence.recovered_model,agent:'merlin',deadline});
  check(reopened.session_id!==evidence.session.session_id,'REOPEN_SESSION_ID');evidence.reopened_session_id=reopened.session_id;
  await stop();
  stage='RECEIPTS';await receipts();
  check(evidence.inferences.length>=2&&evidence.inferences.length<=LIMIT&&evidence.inferences.every(r=>r.status==='OK')&&
    evidence.inferences.some(r=>r.finish_reason==='tool_calls')&&evidence.inferences.at(-1).finish_reason==='stop','INFERENCE_CONTRACT');
  evidence.status=PASS;
 }catch(e){
  evidence.failure_stage=stage;
  evidence.failure_code=/^[A-Z_]{1,80}$/.test(e?.message??'')?e.message:'REMOTE_EXECUTION_FAILURE';
 }finally{
  if(started&&!evidence.container_stopped){try{await stop()}catch{evidence.container_stopped=false;evidence.status='RUNTIME_FAILURE'}}
  if(!evidence.inferences.length)try{await receipts()}catch{}
  evidence.finished_at=new Date().toISOString();
  const updated=await env.DB.prepare('UPDATE '+table+' SET status=?,receipt_json=? WHERE probe_id=? AND run_id=? AND status=?')
   .bind(evidence.status,JSON.stringify(evidence),ID,g.run_id,'CLAIMED').run();
  check(updated.meta?.changes===1,'TERMINAL_RECEIPT_WRITE');
  console.log('FULL_REMOTE_EDIT_OUTCOME '+evidence.status);
 }
}
export default {fetch:()=>new Response(null,{status:404}),scheduled(_event,env){return runEdit(env)}};
