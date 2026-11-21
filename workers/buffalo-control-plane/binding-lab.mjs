/** Scheduled-only live binding validation. No HTTP handler capable of running tests.
 * Deploy to a dedicated Worker bound ONLY to the dedicated Buffalo race-lab D1.
 * Cron is an ephemeral trigger: remove after the first terminal receipt.
 */
import {D1TaskStore} from './store.mjs';
import {acceptOfflineTask,OFFLINE_KIND} from '../../scripts/control-plane/contract.mjs';

const TEST_ID='buffalo-binding-2026-11-21-v1';
const UUIDS=[
 '90000000-0000-4000-8000-000000000101',
 '90000000-0000-4000-8000-000000000102',
 '90000000-0000-4000-8000-000000000103',
];
const INPUT_SHA='a'.repeat(64);
const HEAD_SHA='b'.repeat(40);
const RESULT_SHA='c'.repeat(64);
const PIN_TIME='2026-11-21T22:40:00Z';
const PIN_WORKFLOW_ID=426288240;
const task=id=>acceptOfflineTask({task_id:id,kind:OFFLINE_KIND,input_sha256:INPUT_SHA});
const eventCount=async(db,id,reason)=>{
 const row=await db.prepare('SELECT COUNT(*) AS n FROM buffalo_task_events WHERE task_id=? AND reason_code=?')
  .bind(id,reason).first();
 return Number(row?.n);
};
const requireTrue=(condition,label)=>{if(!condition)throw Error('LAB_ASSERT_'+label)};

export async function runBindingLab(db){
 if(!db?.prepare||!db?.batch)throw Error('LAB_DB_MISSING');
 // Durable one-shot guard: subsequent scheduled invocations cannot rerun cases.
 const admitted=await db.prepare(
  "INSERT INTO buffalo_binding_lab_receipts(test_id,status) VALUES(?,'RUNNING') ON CONFLICT(test_id) DO NOTHING"
 ).bind(TEST_ID).run();
 if(admitted.meta?.changes!==1)return {already_started:true};
 const store=new D1TaskStore(db);
 let stage='START';
 const metrics={test_id:TEST_ID,backend:'CLOUDFLARE_WORKER_ENV_DB_BINDING',
  scenarios:{},http_dispatches:0,github_requests:0,inference_requests:0};
 try {
  stage='CONCURRENT_CREATE';
  const admittedResults=await Promise.all(Array.from({length:8},()=>store.create(task(UUIDS[0]))));
  const row=await store.read(UUIDS[0]);
  const admittedEvents=await eventCount(db,UUIDS[0],'TASK_ADMITTED');
  const winners=admittedResults.filter(x=>x.created).length;
  requireTrue(row?.state==='READY'&&winners===1&&admittedEvents===1,'CONCURRENT_CREATE');
  metrics.scenarios.concurrent_create={attempts:8,winners,admission_events:admittedEvents};
  
  stage='CONCURRENT_CLAIM';
  const claims=await Promise.all(Array.from({length:8},()=>
   store.claim(UUIDS[0],HEAD_SHA,PIN_WORKFLOW_ID,PIN_TIME)));
  const afterClaim=await store.read(UUIDS[0]);
  const claimEvents=await eventCount(db,UUIDS[0],'DISPATCH_CLAIMED');
  const claimsWon=claims.filter(Boolean).length;
  requireTrue(afterClaim?.state==='DISPATCHING'&&afterClaim.dispatch_head_sha===HEAD_SHA
   &&claimsWon===1&&claimEvents===1,'CONCURRENT_CLAIM');
  metrics.scenarios.concurrent_claim={attempts:8,winners:claimsWon,claim_events:claimEvents};
 
  stage='CONCURRENT_TERMINALS';
  await store.create(task(UUIDS[1]));
  requireTrue(await store.claim(UUIDS[1],HEAD_SHA,PIN_WORKFLOW_ID,PIN_TIME),'TERMINAL_PREP_CLAIM');
  requireTrue(await store.transition(UUIDS[1],'DISPATCHING','SUBMITTED','GITHUB_DISPATCH_ACCEPTED'),'TERMINAL_PREP_SUBMIT');
  const finals=await Promise.all([
   store.transition(UUIDS[1],'SUBMITTED','SUCCEEDED','VERIFIED_OFFLINE_ARTIFACT',
    {run_id:50001,artifact_id:60001,result_sha256:RESULT_SHA}),
   store.transition(UUIDS[1],'SUBMITTED','FAILED','GITHUB_RUN_NON_SUCCESS',{run_id:50001})
  ]);
  const finalRow=await store.read(UUIDS[1]);
  const okEvents=await eventCount(db,UUIDS[1],'VERIFIED_OFFLINE_ARTIFACT');
  const badEvents=await eventCount(db,UUIDS[1],'GITHUB_RUN_NON_SUCCESS');
  requireTrue(finals.filter(Boolean).length===1&&(finalRow.state==='SUCCEEDED'||finalRow.state==='FAILED')
   &&okEvents+badEvents===1,'CONCURRENT_TERMINALS');
  // One terminal transition only, no second write after a terminal commit.
  requireTrue(!(await store.transition(UUIDS[1],'SUBMITTED','FAILED',
   'GITHUB_RUN_NON_SUCCESS',{run_id:50001})),'TERMINAL_IMMUTABLE');
  metrics.scenarios.concurrent_terminals={attempts:2,winners:1,final_state:finalRow.state,
   terminal_events:okEvents+badEvents};
  
  stage='CONCURRENT_LINK_RUN';
  await store.create(task(UUIDS[2]));
  requireTrue(await store.claim(UUIDS[2],HEAD_SHA,PIN_WORKFLOW_ID,PIN_TIME),'LINK_PREP_CLAIM');
  requireTrue(await store.transition(UUIDS[2],'DISPATCHING','SUBMITTED',
   'GITHUB_DISPATCH_ACCEPTED'),'LINK_PREP_SUBMIT');
  const links=await Promise.allSettled([
   store.linkRun(UUIDS[2],70001),store.linkRun(UUIDS[2],70002)
  ]);
  const linkedRow=await store.read(UUIDS[2]);
  const linkEvents=await eventCount(db,UUIDS[2],'GITHUB_RUN_LINKED');
  const winnersLink=links.filter(x=>x.status==='fulfilled'&&x.value===true).length;
  requireTrue(winnersLink===1&&linkEvents===1&&[70001,70002].includes(linkedRow.github_run_id),
   'CONCURRENT_LINK_RUN');
  requireTrue(!(await store.linkRun(UUIDS[2],linkedRow.github_run_id)),'LINK_IDEMPOTENT');
  requireTrue(await eventCount(db,UUIDS[2],'GITHUB_RUN_LINKED')===1,'LINK_SINGLE_EVENT');
  metrics.scenarios.concurrent_link={attempts:2,winners:1,link_events:linkEvents,
   selected_run_id:linkedRow.github_run_id};
  stage='RECEIPT';
  const result=await db.prepare(
   "UPDATE buffalo_binding_lab_receipts SET status='PASS',detail_json=?,finished_at=CURRENT_TIMESTAMP WHERE test_id=? AND status='RUNNING'"
  ).bind(JSON.stringify(metrics),TEST_ID).run();
  requireTrue(result.meta?.changes===1,'RECEIPT_COMMIT');
  return metrics;
 }catch(error){
  const err=String(error?.message||'UNKNOWN');
  const marker=/^LAB_ASSERT_[A-Z0-9_]{1,60}$/.test(err)?err:'LAB_RUNTIME_ERROR';
  await db.prepare(
   "UPDATE buffalo_binding_lab_receipts SET status='FAIL',failure_stage=?,failure_code=?,detail_json=?,finished_at=CURRENT_TIMESTAMP WHERE test_id=? AND status='RUNNING'"
  ).bind(stage,marker,JSON.stringify(metrics),TEST_ID).run();
  throw error;
 }
}

export default {
 async fetch(request,env){
  // The dedicated Worker MUST be protected by Cloudflare Access at the edge.
  // No route except the literal, audited one-shot POST; no arbitrary input.
  const url=new URL(request.url);
  if(url.pathname!=='/v1/lab/run-once'||request.method!=='POST')
   return new Response('Not Found',{status:404});
  if(!request.headers.get('Cf-Access-Jwt-Assertion'))
   return Response.json({error:'ACCESS_ASSERTION_REQUIRED'},{status:403});
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')
   return Response.json({error:'INVALID_CONTENT_TYPE'},{status:415});
  if(Number(request.headers.get('content-length')??0)>256)
   return Response.json({error:'BODY_TOO_LARGE'},{status:413});
  let body;
  try{body=await request.text()}catch{return Response.json({error:'BAD_BODY'},{status:400})}
  if(body.length>256||body!=='{"action":"RUN_BINDING_LAB_V1"}')
   return Response.json({error:'INVALID_INPUT'},{status:400});
  try{
   const result=await runBindingLab(env.DB);
   return Response.json(result.already_started?
    {status:'ALREADY_STARTED',run_again:false}:
    {status:'PASS',scenarios:result.scenarios,run_again:false},
    {status:result.already_started?409:200,headers:{'cache-control':'no-store'}});
  }catch{
   return Response.json({status:'FAILED',reason:'READ_D1_RECEIPT',run_again:false},
    {status:500,headers:{'cache-control':'no-store'}});
  }
 },
 async scheduled(){ /* Cron is permanently disabled: manual Access-only invocation. */ }
};
