/**
 * Buffalo Full stage 2.5 source attestation, authenticated lab V2.
 *
 * Imports the actual router, GitHubFullSourceProof, and D1 evidence store.
 * New one-shot receipt ID; prior FAIL receipts remain unchanged.
 * Secret: dedicated GitHub fine-grained Actions:read token, ONLY in this Worker.
 */
import {handle} from './index.mjs';
import {GitHubFullSourceProof} from './full-provenance-github.mjs';
import {createSourceReadTransport,workflowReadPreflight,SOURCE_READ_SECRET}
 from './source-auth-transport.mjs';

export const LAB_ID='buffalo-full-source-auth-44976002057-v1';
const HANDOFF='6bce82ee-d179-4a2e-9317-f7f4708c5be2';
const RUN_ID=44976002057,ARTIFACT_ID=14735612574;
const MANIFEST_SHA='462b4fbb820c5813ce9087af827b667a01855a63a0f2ab1498df4d3145650f05';
const ZIP_SHA='e881bb34dac811b06bc0f43c2119c412d8b9e94b129d85191eb9d339488c9157';
const CONTENT_SHA='9f200cdc0723ac39b8690453892b51801563133f39c4ee4f1d8a461987d75e7d';
const COMMIT='66bee2d96ec71692608fc0829486c2dc130ab7a0';
const assert=(cond,code)=>{if(!cond)throw Error('SOURCE_AUTH_LAB_'+code)};
const categorize=e=>{
 const message=String(e?.message??'');
 return /^SOURCE_AUTH_LAB_[A-Z0-9_]{1,70}$/.test(message)?message:
  'SOURCE_AUTH_LAB_RUNTIME_ERROR';
};
/** Read all four GitHub endpoints and verify ZIP/digests BEFORE any D1 one-shot write.
 * Uses the original read-only verifier and never saves a source attestation. */
export async function sourceReadiness(db,secret,requestFn){
 const first=await workflowReadPreflight(secret,requestFn);
 if(!first.ready)return first;
 const checks=[...first.checks];
 try{
  assert(Boolean(db?.prepare),'D1_READ_BINDING_MISSING');
  const row=await db.prepare('SELECT * FROM buffalo_full_handoffs WHERE handoff_id=?')
   .bind(HANDOFF).first();
  assert(Boolean(row),'HANDOFF_NOT_FOUND');
  const transport=createSourceReadTransport(secret,requestFn,
   observation=>checks.push(observation));
  const github=new GitHubFullSourceProof('NON_SECRET_PLACEHOLDER_TOKEN',transport);
  const result=await github.verify(row,RUN_ID);
  assert(result.github_artifact_id===ARTIFACT_ID&&
   result.manifest_sha256===MANIFEST_SHA&&
   result.commit_sha===COMMIT&&result.artifact_sha256===ZIP_SHA&&
   result.result_sha256===CONTENT_SHA,'SOURCE_CONTENT_MISMATCH');
  return {ready:true,status:'READY_FULL_EVIDENCE',
   github_run_id:RUN_ID,checks};
 }catch(error){
  const msg=String(error?.message??'');
  const status=/^(SOURCE_AUTH_LAB_[A-Z0-9_]{1,70}|GITHUB_(?:ARTIFACT_)?HTTP_[1-5][0-9]{2}|SOURCE_PROOF_[A-Z0-9_]{1,70}|ZIP_[A-Z0-9_]{1,70})$/.test(msg)?
   msg:'SOURCE_PROOF_READINESS_FAILED';
  return {ready:false,status,checks};
 }
}
const getAttestation=db=>db.prepare(
 'SELECT * FROM buffalo_full_source_attestations WHERE handoff_id=?'
).bind(HANDOFF).first();
const getEventCount=async db=>{
 const row=await db.prepare(
  "SELECT COUNT(*) AS n FROM buffalo_full_source_events WHERE handoff_id=? AND event='SOURCE_ATTESTED'"
 ).bind(HANDOFF).first();
 return Number(row?.n??-1);
};
/** One-shot only. Must be called AFTER successful authenticated preflight.
 * All observable failures are bounded HTTP codes, never response bodies/secrets. */
export async function executeAuthenticatedSourceLab(db,secret,requestFn){
 assert(Boolean(db?.prepare&&db?.batch),'D1_BINDING_MISSING');
 // Do not burn the one-shot receipt without configured dedicated secret.
 assert(typeof secret==='string'&&secret.trim().length>=20,'SOURCE_READ_SECRET_MISSING');
 const fence=await db.prepare(
  "INSERT INTO buffalo_full_source_lab_receipts (test_id,status) VALUES (?,'RUNNING') ON CONFLICT(test_id) DO NOTHING"
 ).bind(LAB_ID).run();
 if(fence.meta?.changes!==1)return{status:'ALREADY_STARTED',test_id:LAB_ID,run_again:false};
 const detail={test_id:LAB_ID,subject:'REAL_GITHUB_SOURCE_PROOF_NO_AGENTS',
  handoff_id:HANDOFF,github_run_id:RUN_ID,
  source:'DEDICATED_GITHUB_ACTIONS_READ_SECRET',
  stages:[],github_observations:[],outbound_write_requests:0,
  provider_requests:0,agent_requests:0};
 let stage='PRECHECK_HANDOFF';
 try{
  const handoff=await db.prepare(
   'SELECT state,execution_allowed,provenance_verified,github_run_id,manifest_sha256,commit_sha FROM buffalo_full_handoffs WHERE handoff_id=?'
  ).bind(HANDOFF).first();
  assert(handoff?.state==='REGISTERED_UNVERIFIED'&&handoff.execution_allowed===0&&
   handoff.provenance_verified===0&&handoff.github_run_id===null&&
   handoff.manifest_sha256===MANIFEST_SHA&&handoff.commit_sha===COMMIT,
   'HANDOFF_INELIGIBLE');
  assert(!(await getAttestation(db))&&await getEventCount(db)===0,
   'POSITIVE_RECEIPT_ALREADY_EXISTS');
  detail.stages.push({stage,status:'PASS'});
  stage='VERIFY_AND_PERSIST';
  const ephemeral=[...crypto.getRandomValues(new Uint8Array(32))]
   .map(n=>n.toString(16).padStart(2,'0')).join('');
  const env={DB:db,CONTROL_API_TOKEN:ephemeral,
   GITHUB_FINE_GRAINED_TOKEN:'DO_NOT_USE_PRODUCTION_GITHUB_TOKEN'};
  const transport=createSourceReadTransport(secret,requestFn,
   observation=>detail.github_observations.push(observation));
  const github=new GitHubFullSourceProof('NON_SECRET_PLACEHOLDER_TOKEN',transport);
  const deps={store:Object.freeze({}),github:Object.freeze({}),fullSourceGithub:github};
  const invoke=runId=>handle(new Request(
   'https://source-lab.internal/v1/full/handoffs/'+HANDOFF+'/verify-source',{
    method:'POST',headers:{authorization:'Bearer '+ephemeral,'content-type':'application/json'},
    body:JSON.stringify({github_run_id:runId})
   }),env,deps);
  const response=await invoke(RUN_ID);
  const body=await response.json();
  assert(response.status===201&&body?.attested===true&&body.created===true,
   'FIRST_ATTESTATION_REJECTED');
  assert(detail.github_observations.filter(x=>x.stage.startsWith('REPO_')).length===4,
   'GITHUB_GET_CARDINALITY');
  const evidence=await getAttestation(db);
  assert(evidence?.proof_schema==='BUFFALO_FULL_SOURCE_PROOF_V1'&&
   evidence.proof_status==='SOURCE_ATTESTED'&&
   evidence.github_run_id===RUN_ID&&evidence.github_artifact_id===ARTIFACT_ID&&
   evidence.manifest_sha256===MANIFEST_SHA&&evidence.commit_sha===COMMIT&&
   evidence.artifact_sha256===ZIP_SHA&&evidence.result_sha256===CONTENT_SHA&&
   evidence.execution_allowed===0,'ATTESTATION_D1_MISMATCH');
  assert(await getEventCount(db)===1,'SOURCE_EVENT_COUNT');
  detail.stages.push({stage,status:'PASS',github_run_id:RUN_ID,
   github_artifact_id:ARTIFACT_ID,events:1});
  stage='IDEMPOTENCY_AND_IMMUTABILITY';
  const again=await invoke(RUN_ID);
  assert(again.status===200&&(await again.json())?.created===false,
   'DUPLICATE_NOT_IDEMPOTENT');
  const conflict=await invoke(RUN_ID+1);
  assert(conflict.status===409&&(await conflict.json())?.error==='SOURCE_PROOF_ALREADY_BOUND',
   'DIFFERENT_RUN_NOT_REJECTED');
  assert(await getEventCount(db)===1&&
   detail.github_observations.filter(x=>x.stage.startsWith('REPO_')).length===4,
   'IDEMPOTENCY_BROKEN');
  const unchanged=await db.prepare(
   'SELECT state,execution_allowed,provenance_verified,github_run_id FROM buffalo_full_handoffs WHERE handoff_id=?'
  ).bind(HANDOFF).first();
  assert(unchanged?.state==='REGISTERED_UNVERIFIED'&&unchanged.execution_allowed===0&&
   unchanged.provenance_verified===0&&unchanged.github_run_id===null,
   'ORIGINAL_HANDOFF_MUTATED');
  detail.stages.push({stage,status:'PASS',declaration:'REGISTERED_UNVERIFIED',
   execution_allowed:false,events:1});
  stage='DURABLE_RECEIPT';
  const saved=await db.prepare(
   "UPDATE buffalo_full_source_lab_receipts SET status='PASS',detail_json=?,finished_at=CURRENT_TIMESTAMP WHERE test_id=? AND status='RUNNING'"
  ).bind(JSON.stringify(detail),LAB_ID).run();
  assert(saved.meta?.changes===1,'RECEIPT_COMMIT_FAILED');
  return{status:'PASS',test_id:LAB_ID,github_run_id:RUN_ID,
   source_attestation:'SOURCE_ATTESTED',execution_allowed:false,run_again:false,
   stages:detail.stages};
 }catch(error){
  const code=categorize(error);
  const saved=await db.prepare(
   "UPDATE buffalo_full_source_lab_receipts SET status='FAIL',failure_stage=?,failure_code=?,detail_json=?,finished_at=CURRENT_TIMESTAMP WHERE test_id=? AND status='RUNNING'"
  ).bind(stage,code,JSON.stringify(detail),LAB_ID).run();
  if(saved.meta?.changes!==1)throw Error('SOURCE_AUTH_LAB_FAILURE_RECEIPT_UNAVAILABLE');
  return{status:'FAIL',test_id:LAB_ID,failure_stage:stage,
   failure_code:code,checks:detail.github_observations,run_again:false};
 }
}
const fixedBody='{"action":"VERIFY_AUTHENTICATED_SOURCE_PROOF_V1"}';
export default {
 async fetch(request,env){
  const pathname=new URL(request.url).pathname;
  if(pathname==='/v1/lab/source/preflight'&&request.method==='GET'){
   if(!request.headers.get('Cf-Access-Jwt-Assertion'))
    return Response.json({error:'ACCESS_REQUIRED'},{status:403});
   const proof=await sourceReadiness(env.DB,env[SOURCE_READ_SECRET]);
   return Response.json(proof,{status:proof.ready?200:503,
    headers:{'cache-control':'no-store'}});
  }
  if(pathname!=='/v1/lab/source/verify-once'||request.method!=='POST')
   return new Response('Not Found',{status:404});
  if(!request.headers.get('Cf-Access-Jwt-Assertion'))
   return Response.json({error:'ACCESS_REQUIRED'},{status:403});
  if(request.headers.get('content-type')?.split(';')[0]?.trim()!=='application/json')
   return Response.json({error:'CONTENT_TYPE_DENIED'},{status:415});
  if(Number(request.headers.get('content-length')??0)>128)
   return Response.json({error:'BODY_TOO_LARGE'},{status:413});
  let body;
  try{body=await request.text()}catch{return Response.json({error:'INVALID_BODY'},{status:400})}
  if(body!==fixedBody)return Response.json({error:'INVALID_INPUT'},{status:400});
  // Guard: do not consume durable one-shot while token/access to GitHub is not ready.
  const preflight=await sourceReadiness(env.DB,env[SOURCE_READ_SECRET]);
  if(!preflight.ready)return Response.json({status:'PRECHECK_BLOCKED',
   code:preflight.status,checks:preflight.checks,run_again:false},
   {status:503,headers:{'cache-control':'no-store'}});
  try{
   const result=await executeAuthenticatedSourceLab(env.DB,env[SOURCE_READ_SECRET]);
   return Response.json(result,{status:result.status==='PASS'?200:
    result.status==='ALREADY_STARTED'?409:500,
    headers:{'cache-control':'no-store'}});
  }catch{
   return Response.json({error:'LAB_FAILED_BEFORE_RECEIPT'},{status:500});
  }
 },
 async scheduled(){} // Not a cron workflow.
};
