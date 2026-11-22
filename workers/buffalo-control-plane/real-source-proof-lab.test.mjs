import test from 'node:test';
import assert from 'node:assert/strict';
import lab,{publicGitHubTransport,executeRealSourceLab,
 HANDOFF,RUN_ID,LAB_ID} from './real-source-proof-lab.mjs';

const path='https://lab.invalid/v1/lab/source/verify-once';
const body='{"action":"VERIFY_REAL_SOURCE_PROOF_V1"}';
test('lab only permits one fixed Access-gated POST and refuses all other invocations',async()=>{
 const trials=[
  [new Request(path,{method:'GET'}),404],
  [new Request('https://lab.invalid/v1/tasks',{method:'POST',body}),404],
  [new Request(path,{method:'POST',headers:{'content-type':'application/json'},body}),403],
  [new Request(path,{method:'POST',headers:{'cf-access-jwt-assertion':'test','content-type':'text/plain'},body}),415],
  [new Request(path,{method:'POST',headers:{'cf-access-jwt-assertion':'test','content-type':'application/json'},body:'{"action":"RUN_AGENT"}'}),400],
  [new Request(path,{method:'POST',headers:{'cf-access-jwt-assertion':'test','content-type':'application/json'},body:JSON.stringify({action:'VERIFY_REAL_SOURCE_PROOF_V1',paid:true})}),400]
 ];
 for(const [req,expected] of trials){
  assert.equal((await lab.fetch(req,{})).status,expected);
 }
 await lab.scheduled(); // No timer/cron execution.
});
test('public GitHub transport refuses POST, unexpected endpoint and external network',async()=>{
 const allowed='https://api.github.com/repos/yudocyudoc/buffalo-01/actions/runs/'+RUN_ID;
 for(const [url,init] of [
  [allowed,{method:'POST'}],
  ['https://github.com/yudocyudoc/buffalo-01',{method:'GET'}],
  ['https://api.github.com/repos/stranger/repo/actions/runs/'+RUN_ID,{method:'GET'}],
  ['https://api.github.com/repos/yudocyudoc/buffalo-01/actions/workflows/paid-agent-case.yml',{method:'GET'}],
  [allowed,{method:'GET',body:'any'}]
 ])await assert.rejects(()=>publicGitHubTransport(url,init),
  /SOURCE_REAL_LAB_GITHUB_URL_OR_METHOD_DENIED/);
});
test('one-shot D1 fence rejects repeated requests before any GitHub reads',async()=>{
 const db={prepare(sql){
  assert.match(sql,/INSERT INTO buffalo_full_source_lab_receipts/);
  return {bind(id){
   assert.equal(id,LAB_ID);
   return {run:async()=>({meta:{changes:0}})};
  }};
 }};
 assert.deepEqual(await executeRealSourceLab(db),{
  status:'ALREADY_STARTED',run_again:false,test_id:LAB_ID
 });
 await assert.rejects(()=>executeRealSourceLab(null),
  /SOURCE_REAL_LAB_NO_D1_BINDING/);
 assert.match(HANDOFF,/^[0-9a-f-]{36}$/);
});
