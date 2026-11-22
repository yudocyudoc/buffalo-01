/**
 * One-shot live source-proof lab: original Worker router, verifier and D1 store.
 * No paid provider, agent, simulation, GitHub dispatch or production secrets.
 */
import {handle} from './index.mjs';
import {GitHubFullSourceProof} from './full-provenance-github.mjs';

export const LAB_ID='buffalo-full-source-real-44976002057-v1';
export const HANDOFF='6bce82ee-d179-4a2e-9317-f7f4708c5be2';
export const RUN_ID=44976002057;
const ARTIFACT_ID=14735612574;
const MANIFEST_SHA='462b4fbb820c5813ce9087af827b667a01855a63a0f2ab1498df4d3145650f05';
const ZIP_SHA='e881bb34dac811b06bc0f43c2119c412d8b9e94b129d85191eb9d339488c9157';
const CONTENT_SHA='9f200cdc0723ac39b8690453892b51801563133f39c4ee4f1d8a461987d75e7d';
const COMMIT='66bee2d96ec71692608fc0829486c2dc130ab7a0';
const EXPECTED_API='https://api.github.com';
const EXPECTED_PATHS=Object.freeze([
 '/repos/yudocyudoc/buffalo-01/actions/workflows/buffalo-full-source-proof.yml',
 '/repos/yudocyudoc/buffalo-01/actions/runs/'+RUN_ID,
 '/repos/yudocyudoc/buffalo-01/actions/runs/'+RUN_ID+'/artifacts?per_page=100',
 '/repos/yudocyudoc/buffalo-01/actions/artifacts/'+ARTIFACT_ID+'/zip'
]);
const fail=code=>{throw Error('SOURCE_REAL_LAB_'+code)};
export async function publicGitHubTransport(url,init){
 const parsed=new URL(url);
 if(parsed.origin!==EXPECTED_API||!EXPECTED_PATHS.includes(parsed.pathname+parsed.search)
    ||init?.method!=='GET'||init?.body)fail('GITHUB_URL_OR_METHOD_DENIED');
 // Discard Authorization from the original client. Public repository GET only.
 return fetch(parsed.href,{
  method:'GET',headers:{
   'accept':'application/vnd.github+json',
   'x-github-api-version':'2022-11-28',
   'user-agent':'buffalo-full-source-proof-lab'
  },redirect:'follow'
 });
}
const assert=(value,code)=>{if(!value)fail(code)};
const reasonCode=error=>{
 const message=String(error?.message??'');
 return /^SOURCE_REAL_LAB_[A-Z0-9_]{1,80}$/.test(message)?
  message:'SOURCE_REAL_LAB_RUNTIME_ERROR';
};
const eventCount=async db=>{
 const row=await db.prepare(
  "SELECT COUNT(*) AS n FROM buffalo_full_source_events WHERE handoff_id=? AND event='SOURCE_ATTESTED'"
 ).bind(HANDOFF).first();
 return Number(row?.n??-1);
};
const attestation=async db=>db.prepare(
 'SELECT * FROM buffalo_full_source_attestations WHERE handoff_id=?'
).bind(HANDOFF).first();

export async function executeRealSourceLab(db,transport=publicGitHubTransport){
 assert(Boolean(db?.prepare&&db?.batch),'NO_D1_BINDING');
 // Single insert fence survives lost HTTP responses and concurrent invocations.
 const fence=await db.prepare(
  "INSERT INTO buffalo_full_source_lab_receipts(test_id,status) VALUES(?,'RUNNING') ON CONFLICT(test_id) DO NOTHING"
 ).bind(LAB_ID).run();
 if(fence.meta?.changes!==1)return {status:'ALREADY_STARTED',run_again:false,test_id:LAB_ID};
 const detail={test_id:LAB_ID,mode:'REAL_GITHUB_SOURCE_PROVENANCE_ONLY',
  handoff_id:HANDOFF,github_run_id:RUN_ID,lab_only:true,
  github_requests:0,github_post_requests:0,provider_requests:0,agent_requests:0,stages:[]};
 let stage='CHECK_BEFORE';
 try{
  const record=await db.prepare(
   'SELECT handoff_id,state,execution_allowed,provenance_verified,github_run_id,manifest_sha256,commit_sha FROM buffalo_full_handoffs WHERE handoff_id=?'
  ).bind(HANDOFF).first();
  assert(record?.state==='REGISTERED_UNVERIFIED'&&record.execution_allowed===0&&
   record.provenance_verified===0&&record.github_run_id===null&&
   record.manifest_sha256===MANIFEST_SHA&&record.commit_sha===COMMIT,
   'HANDOFF_NOT_ELIGIBLE');
  assert(!(await attestation(db)),'ATTESTATION_ALREADY_EXISTS');
  assert(await eventCount(db)===0,'SOURCE_EVENT_ALREADY_EXISTS');
  detail.stages.push({stage,result:'PASS'});
  stage='VERIFY_AND_PERSIST';
  // This temporary bearer only authorizes the nested in-memory HTTP call.
  const bearer=[...crypto.getRandomValues(new Uint8Array(32))]
   .map(b=>b.toString(16).padStart(2,'0')).join('');
  const env={DB:db,CONTROL_API_TOKEN:bearer,
   GITHUB_FINE_GRAINED_TOKEN:'DUMMY_NOT_A_REAL_GITHUB_TOKEN'};
  const countedTransport=async(url,options)=>{
   assert(options?.method==='GET','GITHUB_WRITE_ATTEMPT');
   detail.github_requests++;
   return transport(url,options);
  };
  const deps={store:Object.freeze({}),github:Object.freeze({}),
   fullSourceGithub:new GitHubFullSourceProof('DUMMY_NOT_A_REAL_GITHUB_TOKEN',
    countedTransport)};
  const call=id=>handle(
   new Request('https://lab.internal/v1/full/handoffs/'+HANDOFF+'/verify-source',{
    method:'POST',headers:{authorization:'Bearer '+bearer,'content-type':'application/json'},
    body:JSON.stringify({github_run_id:id})
   }),env,deps);
  const response=await call(RUN_ID);
  const receipt=await response.json();
  assert(response.status===201&&receipt?.attested===true&&
   receipt?.created===true,'FIRST_ATTESTATION_REJECTED');
  assert(detail.github_requests===4,'GITHUB_REQUEST_COUNT');
  const evidence=await attestation(db);
  assert(evidence?.proof_status==='SOURCE_ATTESTED'&&
   evidence.proof_schema==='BUFFALO_FULL_SOURCE_PROOF_V1'&&
   evidence.github_run_id===RUN_ID&&evidence.github_artifact_id===ARTIFACT_ID&&
   evidence.manifest_sha256===MANIFEST_SHA&&evidence.commit_sha===COMMIT&&
   evidence.artifact_sha256===ZIP_SHA&&evidence.result_sha256===CONTENT_SHA&&
   evidence.execution_allowed===0,'ATTESTATION_EVIDENCE_MISMATCH');
  assert(await eventCount(db)===1,'SOURCE_EVENT_COUNT');
  detail.stages.push({stage,result:'PASS',run_id:RUN_ID,artifact_id:ARTIFACT_ID,
   zip_sha256:ZIP_SHA,json_sha256:CONTENT_SHA,source_events:1});
  stage='IDEMPOTENCY_AND_HANDOFF_IMMUTABILITY';
  const repeated=await call(RUN_ID);
  assert(repeated.status===200&&(await repeated.json())?.created===false,
   'REPEAT_NOT_IDEMPOTENT');
  const wrong=await call(RUN_ID+1);
  assert(wrong.status===409&&
   (await wrong.json())?.error==='SOURCE_PROOF_ALREADY_BOUND',
   'WRONG_RUN_NOT_REJECTED');
  assert(detail.github_requests===4&&await eventCount(db)===1,
   'DUPLICATE_GITHUB_OR_EVENT');
  const unchanged=await db.prepare(
   'SELECT state,execution_allowed,provenance_verified,github_run_id FROM buffalo_full_handoffs WHERE handoff_id=?'
  ).bind(HANDOFF).first();
  assert(unchanged?.state==='REGISTERED_UNVERIFIED'&&
   unchanged.execution_allowed===0&&unchanged.provenance_verified===0&&
   unchanged.github_run_id===null,'HANDOFF_MUTATED');
  detail.stages.push({stage,result:'PASS',duplicate_events:0,
   declaration_state:'REGISTERED_UNVERIFIED',execution_allowed:false});
  stage='DURABLE_LAB_RECEIPT';
  const result=await db.prepare(
   "UPDATE buffalo_full_source_lab_receipts SET status='PASS',detail_json=?,finished_at=CURRENT_TIMESTAMP WHERE test_id=? AND status='RUNNING'"
  ).bind(JSON.stringify(detail),LAB_ID).run();
  assert(result.meta?.changes===1,'RECEIPT_WRITE_FAILED');
  return {status:'PASS',test_id:LAB_ID,github_run_id:RUN_ID,
   source_attestation:'SOURCE_ATTESTED',run_again:false,stages:detail.stages};
 }catch(error){
  const code=reasonCode(error);
  await db.prepare(
   "UPDATE buffalo_full_source_lab_receipts SET status='FAIL',failure_stage=?,failure_code=?,detail_json=?,finished_at=CURRENT_TIMESTAMP WHERE test_id=? AND status='RUNNING'"
  ).bind(stage,code,JSON.stringify(detail),LAB_ID).run();
  return {status:'FAIL',test_id:LAB_ID,failure_stage:stage,
   failure_code:code,run_again:false};
 }
}
export default {
 async fetch(request,env){
  if(request.method!=='POST'||new URL(request.url).pathname!=='/v1/lab/source/verify-once')
   return new Response('Not Found',{status:404});
  // Cloudflare Access must also gate this Worker at the edge.
  if(!request.headers.get('Cf-Access-Jwt-Assertion'))
   return Response.json({error:'CLOUDFLARE_ACCESS_REQUIRED'},{status:403});
  if(request.headers.get('content-type')?.split(';')[0]?.trim()!=='application/json')
   return Response.json({error:'CONTENT_TYPE_DENIED'},{status:415});
  if(Number(request.headers.get('content-length')??0)>128)
   return Response.json({error:'BODY_TOO_LARGE'},{status:413});
  let raw;
  try{raw=await request.text()}catch{return Response.json({error:'INVALID_BODY'},{status:400})}
  if(raw!=='{"action":"VERIFY_REAL_SOURCE_PROOF_V1"}')
   return Response.json({error:'INVALID_INPUT'},{status:400});
  try{
   const result=await executeRealSourceLab(env.DB);
   return Response.json(result,{status:result.status==='PASS'?200:
    result.status==='ALREADY_STARTED'?409:500,
    headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
  }catch{
   return Response.json({error:'LAB_FAILED_BEFORE_RECEIPT'},{status:500});
  }
 },
 async scheduled(){}
};
