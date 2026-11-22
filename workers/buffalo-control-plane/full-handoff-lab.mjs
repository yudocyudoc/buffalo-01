/**
 * Stage-2 isolated live smoke: exercises the exact Worker HTTP router and D1FullHandoffStore
 * through a real env.DB binding, without any GitHub calls, paid agent, or inference.
 *
 * MUST deploy to a dedicated Worker and lab D1 behind Cloudflare Access. NEVER to production.
 * External HTTP permits one fixed POST action and rejects all other routes.
 */
import {handle} from './index.mjs';
import {HANDOFF_KIND,HANDOFF_SCHEMA,digestHandoff} from '../../scripts/full-integration/handoff-contract.mjs';

const TEST_ID='buffalo-full-handoff-worker-binding-v1';
const ID='91000000-0000-4000-8000-000000000201';
const manifest=Object.freeze({
 schema_version:HANDOFF_SCHEMA,handoff_id:ID,kind:HANDOFF_KIND,agent:'merlin',
 benchmark:'policyImplementation',scenario_id:'syntheticHandoffLab',case_index:0,mode:'sfd',
 commit_sha:'b'.repeat(40),source_sha256:'a'.repeat(64),
 agent_config_sha256:'c'.repeat(64),prompt_sha256:'d'.repeat(64),
 initial_model_sha256:'e'.repeat(64),parameters_sha256:'f'.repeat(64)
});
const assert=(condition,reason)=>{if(!condition)throw Error('HANDOFF_LAB_ASSERT_'+reason)};
const reasonCode=error=>{
 const message=String(error?.message??'');
 return /^HANDOFF_LAB_ASSERT_[A-Z0-9_]{1,60}$/.test(message)?
  message:'HANDOFF_LAB_RUNTIME_ERROR';
};

export async function runFullHandoffLab(db){
 assert(Boolean(db?.prepare&&db?.batch),'DB_REQUIRED');
 // Durable one-shot fence: concurrent/repeated POSTs cannot execute another run.
 const inserted=await db.prepare(
  "INSERT INTO buffalo_full_handoff_lab_receipts(test_id,status) VALUES(?,'RUNNING') ON CONFLICT(test_id) DO NOTHING"
 ).bind(TEST_ID).run();
 if(inserted.meta?.changes!==1)return {status:'ALREADY_STARTED',run_again:false};
 const info={backend:'CLOUDFLARE_WORKER_ENV_DB',test_id:TEST_ID,
  subject:'SYNTHETIC_DECLARATION_ONLY',stages:[],provider_requests:0,
  github_requests:0,simulation_requests:0,agent_requests:0};
 let stage='START';
 try{
  stage='ROUTER';
  // An ephemeral secret is used only for the nested in-process call to the
  // ORIGINAL router. It is not a user credential or stored anywhere.
  const privateBearer=Array.from(crypto.getRandomValues(new Uint8Array(32)))
   .map(x=>x.toString(16).padStart(2,'0')).join('');
  const env={DB:db,CONTROL_API_TOKEN:privateBearer,
   GITHUB_FINE_GRAINED_TOKEN:'LAB_DISABLED_NO_GITHUB'};
  // Fake dependencies prevent the offline task store/provider from running
  // while exercising the REAL /v1/full/handoffs router and real D1FullHandoffStore.
  const deps={store:Object.freeze({}),github:Object.freeze({})};
  const base='https://lab.invalid';
  const req=(path,method,body)=>new Request(base+path,{
   method,headers:{authorization:'Bearer '+privateBearer,'content-type':'application/json'},
   ...(body?{body:JSON.stringify(body)}:{})
  });
  const post=body=>handle(req('/v1/full/handoffs','POST',body),env,deps);
  const read=()=>handle(req('/v1/full/handoffs/'+ID,'GET'),env,deps);
  stage='PARALLEL_ADMISSION';
  const attempts=await Promise.all(Array.from({length:8},()=>post(manifest)));
  const statuses=attempts.map(x=>x.status);
  const bodies=await Promise.all(attempts.map(x=>x.json()));
  const wins=statuses.filter(x=>x===201).length;
  assert(wins===1&&statuses.filter(x=>x===200).length===7,'ADMISSION_CARDINALITY');
  assert(bodies.every(x=>x.state==='REGISTERED_UNVERIFIED'&&
   x.execution_allowed===false&&x.provenance_verified===false&&
   x.github_run_id===null),'ADMISSION_STATE');
  const digest=await digestHandoff(manifest);
  assert(bodies.every(x=>x.manifest_sha256===digest),'ADMISSION_DIGEST');
  const row=await db.prepare('SELECT * FROM buffalo_full_handoffs WHERE handoff_id=?')
   .bind(ID).first();
  const events=await db.prepare(
   "SELECT COUNT(*) AS n FROM buffalo_full_handoff_events WHERE handoff_id=? AND event='DECLARATION_ADMITTED'"
  ).bind(ID).first();
  assert(row?.manifest_sha256===digest&&row?.state==='REGISTERED_UNVERIFIED'&&
   Number(events?.n)===1&&row.execution_allowed===0&&
   row.provenance_verified===0&&row.github_run_id===null,'D1_PERSISTENCE');
  info.stages.push({name:stage,attempts:8,created:1,duplicates:7,events:1});
  stage='READ_AND_CONFLICT';
  const fetched=await read();
  assert(fetched.status===200&&(await fetched.json()).manifest_sha256===digest,
   'READ_BACK');
  const collision=await post({...manifest,prompt_sha256:'0'.repeat(64)});
  assert(collision.status===409&&(await collision.json()).error==='HANDOFF_ID_CONFLICT',
   'COLLISION_REJECTED');
  info.stages.push({name:stage,read:200,collision:409});
  stage='ROUTE_SEPARATION';
  const paid=await post({...manifest,paid:true});
  assert(paid.status===400,'PAID_FIELD_REJECTED');
  const dispatch=await handle(req('/v1/full/handoffs/'+ID+'/dispatch','POST',{}),env,deps);
  assert(dispatch.status===404,'DISPATCH_ROUTE_BLOCKED');
  const v1=await handle(req('/v1/tasks','POST',manifest),env,deps);
  assert(v1.status===400,'OFFLINE_V1_SEPARATION');
  info.stages.push({name:stage,paid_field:400,dispatch_route:404,v1_task_route:400});
  stage='SQL_IMMUTABILITY';
  for(const [name,statement] of [
   ['SUCCEEDED',"UPDATE buffalo_full_handoffs SET state='SUCCEEDED' WHERE handoff_id=?"],
   ['EXECUTION',"UPDATE buffalo_full_handoffs SET execution_allowed=1 WHERE handoff_id=?"],
   ['PROVENANCE',"UPDATE buffalo_full_handoffs SET provenance_verified=1 WHERE handoff_id=?"],
   ['GITHUB_RUN',"UPDATE buffalo_full_handoffs SET github_run_id=123 WHERE handoff_id=?"]
  ]){
   let rejected=false;
   try{await db.prepare(statement).bind(ID).run()}catch{rejected=true}
   assert(rejected,'CONSTRAINT_'+name);
  }
  const unchanged=await db.prepare(
   'SELECT state,execution_allowed,provenance_verified,github_run_id FROM buffalo_full_handoffs WHERE handoff_id=?'
  ).bind(ID).first();
  assert(unchanged?.state==='REGISTERED_UNVERIFIED'&&unchanged.execution_allowed===0&&
   unchanged.provenance_verified===0&&unchanged.github_run_id===null,'IMMUTABLE_RECEIPT');
  info.stages.push({name:stage,rejected_writes:4});
  stage='RECEIPT';
  const saved=await db.prepare(
   "UPDATE buffalo_full_handoff_lab_receipts SET status='PASS',detail_json=?,finished_at=CURRENT_TIMESTAMP WHERE test_id=? AND status='RUNNING'"
  ).bind(JSON.stringify(info),TEST_ID).run();
  assert(saved.meta?.changes===1,'RECEIPT_NOT_COMMITTED');
  return {status:'PASS',test_id:TEST_ID,stages:info.stages,run_again:false};
 }catch(error){
  const marker=reasonCode(error);
  await db.prepare(
   "UPDATE buffalo_full_handoff_lab_receipts SET status='FAIL',failure_stage=?,failure_code=?,detail_json=?,finished_at=CURRENT_TIMESTAMP WHERE test_id=? AND status='RUNNING'"
  ).bind(stage,marker,JSON.stringify(info),TEST_ID).run();
  return {status:'FAIL',test_id:TEST_ID,failure_stage:stage,failure_code:marker,
   run_again:false};
 }
}

export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(request.method!=='POST'||url.pathname!=='/v1/lab/full-handoff/run-once')
   return new Response('Not Found',{status:404});
  // This is defense in depth only: Cloudflare Access policy MUST protect the
  // destination worker before its workers.dev hostname is enabled.
  if(!request.headers.get('Cf-Access-Jwt-Assertion'))
   return Response.json({error:'ACCESS_REQUIRED'},{status:403});
  if(request.headers.get('content-type')?.split(';')[0]?.trim()!=='application/json')
   return Response.json({error:'CONTENT_TYPE_DENIED'},{status:415});
  if(Number(request.headers.get('content-length')??0)>128)
   return Response.json({error:'BODY_TOO_LARGE'},{status:413});
  let body;
  try{body=await request.text()}catch{return Response.json({error:'INVALID_INPUT'},{status:400})}
  if(body!=='{"action":"RUN_FULL_HANDOFF_LAB_V1"}')
   return Response.json({error:'INVALID_INPUT'},{status:400});
  const result=await runFullHandoffLab(env.DB);
  return Response.json(result,{status:result.status==='PASS'?200:result.status==='ALREADY_STARTED'?409:500,
   headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
 },
 async scheduled(){} // No Cron Trigger; manual one-shot only.
};
