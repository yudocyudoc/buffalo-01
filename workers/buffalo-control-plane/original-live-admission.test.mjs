import test from 'node:test';
import assert from 'node:assert/strict';
import {OriginalLiveAdmission,LIVE_GRANT_SCHEMA} from './original-live-admission.mjs';
import {handle} from './index.mjs';

const GRANT='123e4567-e89b-42d3-a456-426614174111';
const HANDOFF='6bce82ee-d179-4a2e-9317-f7f4708c5be2';
const COMMIT='66bee2d96ec71692608fc0829486c2dc130ab7a0';
const MANIFEST='462b4fbb820c5813ce9087af827b667a01855a63a0f2ab1498df4d3145650f05';
const now=()=>new Date('2026-11-22T05:00:00Z');
const approved=()=>({
 grant_id:GRANT,handoff_id:HANDOFF,grant_schema:LIVE_GRANT_SCHEMA,
 agent:'merlin',provider:'cloudflare',mode:'sfd',commit_sha:COMMIT,
 manifest_sha256:MANIFEST,state:'APPROVED',consent_for_inference:1,
 max_posts:3,max_neurons:50000,approval_actor:'LAB_TEST_ACTOR_NOT_REAL',
 approval_receipt_sha256:'a'.repeat(64),
 approved_at:'2026-11-22 03:00:00',expires_at:'2026-11-22 06:00:00',
 claimed_at:null,revoked_at:null,
 proof_status:'SOURCE_ATTESTED',proof_commit_sha:COMMIT,
 proof_manifest_sha256:MANIFEST,
 original_agent:'merlin',original_mode:'sfd',
 original_commit_sha:COMMIT,original_manifest_sha256:MANIFEST
});
const mockDb=(row)=>{
 let reads=0,writes=0;
 const db={prepare(sql){
  if(!/^\s*SELECT\s/i.test(sql)||/\b(INSERT|UPDATE|DELETE|REPLACE|PRAGMA)\b/i.test(sql)){
   writes++;throw Error('ADMISSION_WRITES_ARE_FORBIDDEN');
  }
  assert.match(sql,/buffalo_full_source_attestations/);
  assert.match(sql,/buffalo_full_handoffs/);
  return {bind(id){
   assert.equal(id,GRANT);
   return {first:async()=>{reads++;return row}};
  }};
 }};
 return {db,counts:()=>({reads,writes})};
};
const check=async(row,opts={})=>{
 const {db,counts}=mockDb(row);
 const result=await new OriginalLiveAdmission(db,{
  now,runtimeCommit:opts.runtimeCommit??COMMIT
 }).preflight(GRANT);
 assert.equal(counts().writes,0);
 return result;
};
test('read-only gate cannot open a session: even approved provenance does not mean backend has executed',async()=>{
 const r=await check(approved());
 assert.equal(r.code,200);
 assert.equal(r.body.preflight,'PASS_READ_ONLY');
 assert.equal(r.body.reason_code,'ADMISSION_CONDITIONS_MET_RUNTIME_NOT_INVOKED');
 assert.equal(r.body.agent,'merlin');
 assert.equal(r.body.provider,'cloudflare');
 assert.equal(r.body.max_posts,3);
 assert.equal(r.body.websocket_gateway_implemented,false);
 assert.equal(r.body.runtime_budget_enforcement_verified,false);
 assert.equal(r.body.execution_started,false);
 assert.equal(r.body.websocket_connected,false);
 assert.equal(r.body.provider_post_count,0);
});
test('existing SOURCE_ATTESTED without a separately issued live grant cannot authorize inference',async()=>{
 const result=await check(null);
 assert.equal(result.code,404);
 assert.equal(result.body.reason_code,'LIVE_GRANT_NOT_FOUND');
 assert.equal(result.body.execution_started,false);
});
test('PENDING without paid consent is DENIED even when source proof is valid',async()=>{
 const row={...approved(),state:'PENDING',consent_for_inference:0,
  max_posts:0,max_neurons:0,approval_actor:null,approval_receipt_sha256:null,
  approved_at:null,expires_at:null};
 const r=await check(row);
 assert.equal(r.code,403);
 assert.equal(r.body.reason_code,'LIVE_INFERENCE_NOT_AUTHORIZED');
});
test('wrong source commit, manifest, or original agent rejects the session',async()=>{
 const variants=[
  {proof_status:null},{proof_commit_sha:'b'.repeat(40)},
  {original_commit_sha:'c'.repeat(40)},
  {proof_manifest_sha256:'b'.repeat(64)},
  {original_manifest_sha256:'c'.repeat(64)},
  {original_agent:'themis'},{agent:'custom'},
  {provider:'openrouter'},{mode:'cld'},
 ];
 for(const variant of variants){
  const r=await check({...approved(),...variant});
  assert.equal(r.code,409,JSON.stringify(variant));
  assert.equal(r.body.reason_code,'LIVE_SOURCE_IDENTITY_MISMATCH');
 }
});
test('missing approval receipts, expired, revoked or already claimed are all fail-closed',async()=>{
 const variants=[
  [{approval_actor:null},'LIVE_APPROVAL_INVALID'],
  [{approval_receipt_sha256:null},'LIVE_APPROVAL_INVALID'],
  [{max_posts:0},'LIVE_APPROVAL_INVALID'],
  [{max_neurons:0},'LIVE_APPROVAL_INVALID'],
  [{expires_at:'2026-11-22 04:59:59'},'LIVE_GRANT_EXPIRED'],
  [{state:'REVOKED',revoked_at:'2026-11-22 04:00:00'},'LIVE_GRANT_REVOKED'],
  [{claimed_at:'2026-11-22 04:00:00'},'LIVE_GRANT_ALREADY_CLAIMED']
 ];
 for(const [variant,code] of variants){
  const r=await check({...approved(),...variant});
  assert.equal(r.body.reason_code,code,JSON.stringify(variant));
  assert.notEqual(r.code,200);
 }
});
test('runtime must be pinned to the same original commit before even admission may pass',async()=>{
 const {db}=mockDb(approved());
 for(const runtimeCommit of [null,'f'.repeat(40)]){
  const r=await new OriginalLiveAdmission(db,{now,runtimeCommit}).preflight(GRANT);
  assert.equal(r.code,503);
  assert.equal(r.body.reason_code,'LIVE_RUNTIME_COMMIT_NOT_VERIFIED');
 }
});
test('invalid id never touches D1',async()=>{
 const db={prepare(){throw Error('SHOULD_NOT_TOUCH_DATABASE')}};
 const a=new OriginalLiveAdmission(db,{now});
 const r=await a.preflight('https://unsafe.invalid');
 assert.equal(r.code,400);
 assert.equal(r.body.execution_started,false);
});

test('real Worker route uses existing bearer auth and never starts GitHub or the Buffalo runtime',async()=>{
 let lookups=0;
 const db={batch:async()=>{throw Error('D1_WRITES_DENIED')},prepare(sql){
  assert.match(sql,/^\s*SELECT\s/i);
  lookups++;
  return{bind(){return{first:async()=>null}}};
 }};
 const secret='a'.repeat(48);
 const env={DB:db,CONTROL_API_TOKEN:secret,GITHUB_FINE_GRAINED_TOKEN:'TEST_NEVER_USED'};
 const url='https://worker.invalid/v1/full/live/grants/'+GRANT+'/preflight';
 const denied=await handle(new Request(url),env,{store:{},github:{}});
 assert.equal(denied.status,401);
 assert.equal(lookups,0);
 const good=await handle(new Request(url,{headers:{authorization:'Bearer '+secret}}),
  env,{store:{},github:{}});
 assert.equal(good.status,404);
 assert.equal((await good.json()).reason_code,'LIVE_GRANT_NOT_FOUND');
 assert.equal(lookups,1);
 const post=await handle(new Request(url,{method:'POST',headers:{
  authorization:'Bearer '+secret
 }}),env,{store:{},github:{}});
 assert.equal(post.status,405);
 assert.equal(lookups,1);
});
