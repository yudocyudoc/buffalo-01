import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {handleOriginalWorkerBridge} from './original-ws-bridge-lab.mjs';

const ID='6bce82ee-d179-4a2e-9317-f7f4708c5be2';
const COMMIT='66bee2d96ec71692608fc0829486c2dc130ab7a0';
const secret='worker-lab-token-for-tests-only-1234567890';
const originAuth='original-buffalo-origin-auth-for-tests-1234567890';
const internalToken='lab-origin-internal-token-never-browser-123456789';
const model={variables:[],relationships:[],title:'offline local Buffalo'};
const modelSha=createHash('sha256').update(JSON.stringify(model)).digest('hex');
const validRow={
 handoff_id:ID,agent:'merlin',mode:'sfd',commit_sha:COMMIT,
 initial_model_sha256:modelSha,manifest_sha256:'a'.repeat(64),
 proof_status:'SOURCE_ATTESTED',proof_commit_sha:COMMIT,
 proof_manifest_sha256:'a'.repeat(64)
};
const request=(headers={})=>new Request('https://example.invalid/v1/lab/original-ws',{
 headers:{upgrade:'websocket',authorization:'Bearer '+secret,...headers}
});
const db=(row=validRow)=>{
 const queries=[];
 return {queries,prepare(sql){
  queries.push(sql);
  assert.match(sql,/^\s*SELECT/i);
  assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|REPLACE|PRAGMA)\b/i);
  return{bind(id){assert.equal(id,ID);return{first:async()=>row}}};
 }};
};
const env=(changes={})=>({
 DB:db(),BUFFALO_WS_LAB_BEARER:secret,
 BUFFALO_RUNTIME_COMMIT_SHA:COMMIT,
 BUFFALO_LAB_HANDOFF_ID:ID,
 BUFFALO_WS_LAB_MODE:'HANDSHAKE_ONLY_NO_AGENT_PROCESS',
 BUFFALO_ORIGIN_AUTH_KEY:originAuth,
 BUFFALO_ORIGIN_UPGRADE_TOKEN:internalToken,
 BUFFALO_ORIGIN:{fetch:async()=>({status:503})},
 ...changes
});
test('without bearer no D1 read or origin connection is possible',async()=>{
 let read=0,upstream=0;
 const e=env({DB:{prepare(){read++;throw Error('unexpected DB')}} ,
  BUFFALO_ORIGIN:{fetch(){upstream++;throw Error('unexpected origin')}}});
 const response=await handleOriginalWorkerBridge(new Request('https://test.invalid/v1/lab/original-ws',{
  headers:{upgrade:'websocket'}
 }),e);
 assert.equal(response.status,401);
 assert.equal(read,0);
 assert.equal(upstream,0);
 assert.equal((await response.json()).error,'UNAUTHORIZED');
});
test('reject method, query string, non-WebSocket and subprotocol requests',async()=>{
 const e=env();
 for(const [req,status] of [
  [new Request('https://test.invalid/other',{headers:{upgrade:'websocket'}}),404],
  [new Request('https://test.invalid/v1/lab/original-ws?backend=https://evil.invalid',
   {headers:{upgrade:'websocket'}}),404],
  [new Request('https://test.invalid/v1/lab/original-ws',{method:'POST'}),405],
  [new Request('https://test.invalid/v1/lab/original-ws'),426],
  [request({'sec-websocket-protocol':'evil'}),400]
 ]){
  const res=await handleOriginalWorkerBridge(req,e);
  assert.equal(res.status,status);
 }
 assert.equal(e.DB.queries.length,0);
});
test('must be configured for internal no-agent origin BEFORE reading D1',async()=>{
 for(const change of [
  {BUFFALO_ORIGIN:undefined},
  {BUFFALO_LAB_HANDOFF_ID:undefined},
  {BUFFALO_LAB_HANDOFF_ID:'6bce82ee-d179-4a2e-9317-f7f4708c5be2?x=1'},
  {BUFFALO_WS_LAB_MODE:'ALLOW_INFERENCE'},
  {BUFFALO_ORIGIN_AUTH_KEY:''},
  {BUFFALO_ORIGIN_UPGRADE_TOKEN:''},
  {BUFFALO_ORIGIN_UPGRADE_TOKEN:originAuth}
 ]){
  const e=env(change);
  const res=await handleOriginalWorkerBridge(request(),e);
  assert.equal(res.status,503);
  assert.equal((await res.json()).error,'NO_SAFE_ORIGIN_CONFIGURED');
  assert.equal(e.DB.queries.length,0);
 }
});
test('fail closed unless verified source matches original runtime commit and model hash',async()=>{
 const cases=[
  null,
  {...validRow,proof_status:'NOT_ATTESTED'},
  {...validRow,agent:'custom'},
  {...validRow,proof_commit_sha:'f'.repeat(40)},
  {...validRow,initial_model_sha256:'bad'},
  {...validRow,proof_manifest_sha256:'b'.repeat(64)}
 ];
 for(const row of cases){
  let touched=0;
  const e=env({DB:db(row),BUFFALO_ORIGIN:{fetch(){touched++;throw Error('SHOULD_NOT_CONNECT')}}});
  const res=await handleOriginalWorkerBridge(request(),e);
  assert.equal(res.status,403);
  assert.equal(touched,0);
  assert.equal((await res.json()).error,'ORIGINAL_SOURCE_NOT_ATTESTED_FOR_RUNTIME');
 }
});
test('source can be valid but NO origin can be used as a positive receipt',async()=>{
 const res=await handleOriginalWorkerBridge(request(),env());
 assert.equal(res.status,503);
 assert.equal((await res.json()).error,'ORIGIN_WEBSOCKET_UNAVAILABLE');
});
test('origin binding receives ONLY fixed internal /api/v1 request and no caller authentication',async()=>{
 let calls=0;
 const e=env({BUFFALO_ORIGIN:{async fetch(req){
  calls++;
  assert.equal(new URL(req.url).hostname,'buffalo-internal.invalid');
  assert.equal(new URL(req.url).pathname,'/api/v1');
  assert.equal(req.method,'GET');
  assert.equal(req.headers.get('upgrade'),'websocket');
  assert.equal(req.headers.get('authorization'),null);
  assert.equal(req.headers.get('x-buffalo-origin-token'),internalToken);
  return {status:503};
 }}});
 const res=await handleOriginalWorkerBridge(request({'x-backend':'https://evil.invalid'}),e);
 assert.equal(res.status,503);
 assert.equal(calls,1);
 assert.equal(e.DB.queries.length,1);
});

test('explicit new server-pinned handoff ID uses only its own attested D1 row',async()=>{
 const newerId='70000000-0000-4000-8000-000000000777';
 const newCommit='7'.repeat(40);
 const row={...validRow,handoff_id:newerId,commit_sha:newCommit,
  proof_commit_sha:newCommit};
 let bound;
 const database={prepare(sql){
  assert.match(sql,/^SELECT/);
  return {bind(id){bound=id;return {first:async()=>row}}};
 }};
 const e=env({DB:database,BUFFALO_LAB_HANDOFF_ID:newerId,
  BUFFALO_RUNTIME_COMMIT_SHA:newCommit});
 const res=await handleOriginalWorkerBridge(request(),e);
 assert.equal(res.status,503);
 assert.equal((await res.json()).error,'ORIGIN_WEBSOCKET_UNAVAILABLE');
 assert.equal(bound,newerId);
 const stale=await handleOriginalWorkerBridge(request(),env({
  DB:database,BUFFALO_LAB_HANDOFF_ID:ID,BUFFALO_RUNTIME_COMMIT_SHA:newCommit
 }));
 assert.equal(stale.status,403);
 assert.equal((await stale.json()).error,'ORIGINAL_SOURCE_NOT_ATTESTED_FOR_RUNTIME');
});
