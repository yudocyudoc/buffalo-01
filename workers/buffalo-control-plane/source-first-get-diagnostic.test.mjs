import test from 'node:test';
import assert from 'node:assert/strict';
import diag,{probeWorkflow,DIAGNOSTIC_ID,WORKFLOW_URL}
 from './source-first-get-diagnostic.mjs';

function fakeDb(){
 const calls=[];
 return {
  calls,
  prepare(sql){
   return {bind(...params){
    return {run:async()=>{
     calls.push({sql,params});
     return {meta:{changes:1}};
    }};
   }};
  }
 };
}
test('first GET diagnostic stores bounded HTTP 403 without fabricating attestation',async()=>{
 const db=fakeDb();
 const outcome=await probeWorkflow(db,async(url,opts)=>{
  assert.equal(url,WORKFLOW_URL);
  assert.equal(opts.method,'GET');
  assert.equal(opts.headers.authorization,undefined);
  return {status:403};
 });
 assert.equal(outcome.status,'FAIL');
 assert.equal(outcome.http_status,403);
 assert.equal(outcome.code,'HTTP_403');
 assert.equal(outcome.request_count,1);
 assert.equal(db.calls.length,2);
 assert(db.calls.every(x=>x.sql.includes('buffalo_full_source_lab_receipts')));
});
test('real identity only counts as success after matching workflow ID and path',async()=>{
 for(const [payload,code] of [
  [{id:426442743,path:'.github/workflows/buffalo-full-source-proof.yml'},'GITHUB_WORKFLOW_OK'],
  [{id:88,path:'.github/workflows/buffalo-full-source-proof.yml'},'GITHUB_WORKFLOW_IDENTITY_MISMATCH']
 ]){
  const outcome=await probeWorkflow(fakeDb(),async()=>({status:200,json:async()=>payload}));
  assert.equal(outcome.code,code);
  assert.equal(outcome.status,code==='GITHUB_WORKFLOW_OK'?'PASS':'FAIL');
 }
});
test('network transport error has a safe classification',async()=>{
 const outcome=await probeWorkflow(fakeDb(),async()=>{throw new TypeError('private error')});
 assert.equal(outcome.status,'FAIL');
 assert.equal(outcome.code,'NETWORK_TYPE_ERROR');
 assert(!JSON.stringify(outcome).includes('private error'));
});
test('closed one-shot receipt refuses repeats and performs no network call',async()=>{
 let attempted=0;
 const db={prepare(sql){return{bind(id){assert.equal(id,DIAGNOSTIC_ID);return{
  run:async()=>({meta:{changes:0}})
 }}}}};
 const r=await probeWorkflow(db,async()=>{attempted++;throw Error('should-not-call')});
 assert.equal(r.status,'ALREADY_STARTED');
 assert.equal(attempted,0);
});
test('no public routes besides access-gated fixed diagnostic',async()=>{
 const path='https://lab.invalid/v1/lab/github-first-get';
 for(const [request,expected] of [
  [new Request(path,{method:'GET'}),404],
  [new Request(path,{method:'POST',headers:{'content-type':'application/json'},body:'{"action":"DIAGNOSE_GITHUB_WORKFLOW_GET_V1"}'}),403],
  [new Request(path,{method:'POST',headers:{'cf-access-jwt-assertion':'dummy','content-type':'application/json'},body:'{"action":"BAD"}'}),400],
  [new Request('https://lab.invalid/v1/tasks',{method:'POST'}),404]
 ]) assert.equal((await diag.fetch(request,{})).status,expected);
 await diag.scheduled();
});
