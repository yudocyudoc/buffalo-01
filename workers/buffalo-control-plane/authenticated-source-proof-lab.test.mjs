import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceReadTransport,workflowReadPreflight}
 from './source-auth-transport.mjs';
import lab,{LAB_ID,executeAuthenticatedSourceLab}
 from './authenticated-source-proof-lab.mjs';

const TOKEN='github_pat_TEST_TOKEN_FOR_UNIT_TEST_ONLY_12345678';
const API='https://api.github.com';
const workflow=API+'/repos/yudocyudoc/buffalo-01/actions/workflows/buffalo-full-source-proof.yml';
const run=API+'/repos/yudocyudoc/buffalo-01/actions/runs/44976002057';
const zip=API+'/repos/yudocyudoc/buffalo-01/actions/artifacts/14735612574/zip';

test('read-only signed GitHub request attaches dedicated secret ONLY to exact api.github.com GET',async()=>{
 const calls=[],observed=[];
 const transport=createSourceReadTransport(TOKEN,async(url,options)=>{
  calls.push({url,options});
  return new Response(JSON.stringify({id:426442743,path:'.github/workflows/buffalo-full-source-proof.yml'}),{
   status:200,headers:{'content-type':'application/json','x-ratelimit-remaining':'4999'}
  });
 },x=>observed.push(x));
 const r=await transport(workflow,{method:'GET',
  headers:{authorization:'Bearer PRODUCTIVE_TOKEN_SHOULD_BE_DROPPED'}});
 assert.equal(r.status,200);
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,workflow);
 assert.equal(calls[0].options.method,'GET');
 assert.equal(calls[0].options.redirect,'manual');
 assert.equal(calls[0].options.headers.authorization,'Bearer '+TOKEN);
 assert.equal(JSON.stringify(observed).includes(TOKEN),false);
 assert.deepEqual(observed.map(x=>x.stage),['REPO_WORKFLOW']);
 assert.equal(observed[0].rate_remaining,4999);
});
test('transport rejects arbitrary APIs, repo paths, POST and request bodies before network access',async()=>{
 let called=0;
 const transport=createSourceReadTransport(TOKEN,async()=>{called++;throw Error('network unexpectedly used')});
 for(const [url,init] of [
  ['https://github.com/yudocyudoc/buffalo-01',{method:'GET'}],
  [API+'/repos/yudocyudoc/buffalo-01/actions/workflows/paid-agent-case.yml',{method:'GET'}],
  [API+'/repos/another/repo/actions/runs/44976002057',{method:'GET'}],
  [API+'/repos/yudocyudoc/buffalo-01/actions/runs/44976002058',{method:'GET'}],
  [workflow,{method:'POST'}],
  [workflow,{method:'GET',body:'{"paid":true}'}],
  ['http://api.github.com/repos/yudocyudoc/buffalo-01/actions/workflows/buffalo-full-source-proof.yml',{method:'GET'}],
  ['https://api.github.com.evil.test/repos/yudocyudoc/buffalo-01/actions/workflows/buffalo-full-source-proof.yml',{method:'GET'}]
 ])await assert.rejects(()=>transport(url,init),/SOURCE_AUTH_LAB_/);
 assert.equal(called,0);
 assert.throws(()=>createSourceReadTransport(''),/SOURCE_AUTH_LAB_SOURCE_READ_SECRET_MISSING/);
});
test('artifact 302 follows trusted signed URL without leaking Authorization to archive host',async()=>{
 const target='https://productionresultssa0.blob.core.windows.net/artifacts/abc?sig=fake';
 const calls=[],observed=[];
 const transport=createSourceReadTransport(TOKEN,async(url,init)=>{
  calls.push({url,init});
  if(url===zip)return new Response(null,{status:302,headers:{location:target}});
  assert.equal(url,target);
  assert.equal(init.headers.authorization,undefined);
  assert.equal(init.redirect,'manual');
  return new Response(new Uint8Array([0x50,0x4b,0x03,0x04]),{status:200});
 },x=>observed.push(x));
 const r=await transport(zip,{method:'GET'});
 assert.equal(r.status,200);
 assert.equal(calls.length,2);
 assert.equal(calls[0].init.headers.authorization,'Bearer '+TOKEN);
 assert.equal(calls[1].init.headers.authorization,undefined);
 assert.deepEqual(observed.map(x=>x.stage),['REPO_ZIP','SIGNED_ZIP_DOWNLOAD']);
 assert.equal(JSON.stringify(observed).includes('sig=fake'),false);
});
test('untrusted or multi-hop archive redirects are rejected with no secret exposure',async()=>{
 for(const target of [
  'https://attacker.invalid/steal?x=1',
  'http://productionresultssa0.blob.core.windows.net/archive',
  'https://productionresultssa0.blob.core.windows.net.evil.test/archive',
  'https://user:password@productionresultssa0.blob.core.windows.net/archive',
  'https://api.github.com/repos/yudocyudoc/buffalo-01/actions/runs/44976002057'
 ]){
  let calls=0;
  const transport=createSourceReadTransport(TOKEN,async()=>{
   calls++;return new Response(null,{status:302,headers:{location:target}});
  });
  await assert.rejects(()=>transport(zip,{method:'GET'}),/SOURCE_AUTH_LAB_ARCHIVE_REDIRECT_DENIED/);
  assert.equal(calls,1);
 }
 const transport=createSourceReadTransport(TOKEN,async(url)=>{
  if(url===zip)return new Response(null,{status:302,headers:{location:
   'https://pipelines.actions.githubusercontent.com/archive'}});
  return new Response(null,{status:302,headers:{location:'https://evil.test/archive'}});
 });
 await assert.rejects(()=>transport(zip,{method:'GET'}),/SOURCE_AUTH_LAB_SECOND_REDIRECT_DENIED/);
});
test('authenticated preflight only succeeds on exact workflow identity',async()=>{
 const network=async()=>new Response(JSON.stringify({
  id:426442743,path:'.github/workflows/buffalo-full-source-proof.yml'
 }),{status:200,headers:{'content-type':'application/json'}});
 const result=await workflowReadPreflight(TOKEN,network);
 assert.equal(result.ready,true);
 assert.equal(result.status,'READY');
 const deny=await workflowReadPreflight(TOKEN,async()=>new Response('{}',{status:403}));
 assert.equal(deny.ready,false);
 assert.equal(deny.status,'HTTP_403');
 assert.equal(deny.checks.length,1);
 assert(!JSON.stringify(deny).includes(TOKEN));
 const wrong=await workflowReadPreflight(TOKEN,async()=>Response.json({
  id:9,path:'.github/workflows/paid-agent-case.yml'
 }));
 assert.equal(wrong.ready,false);
 assert.equal(wrong.status,'WORKFLOW_IDENTITY_MISMATCH');
});
test('dedicated lab refuses unauthorized and malformed external requests',async()=>{
 const root='https://lab.invalid';
 const requests=[
  [new Request(root+'/v1/tasks',{method:'POST'}),404],
  [new Request(root+'/v1/lab/source/preflight'),403],
  [new Request(root+'/v1/lab/source/verify-once',{method:'GET'}),404],
  [new Request(root+'/v1/lab/source/verify-once',{method:'POST',
    headers:{'content-type':'application/json'},body:'{"action":"VERIFY_AUTHENTICATED_SOURCE_PROOF_V1"}'}),403],
  [new Request(root+'/v1/lab/source/verify-once',{method:'POST',
    headers:{'cf-access-jwt-assertion':'dummy','content-type':'text/plain'},
    body:'{"action":"VERIFY_AUTHENTICATED_SOURCE_PROOF_V1"}'}),415],
  [new Request(root+'/v1/lab/source/verify-once',{method:'POST',
    headers:{'cf-access-jwt-assertion':'dummy','content-type':'application/json'},
    body:'{"action":"PAID_AGENT_RUN"}'}),400]
 ];
 for(const [req,code] of requests)assert.equal((await lab.fetch(req,{})).status,code);
 await lab.scheduled();
});
test('missing secret blocks auth preflight without creating a D1 one-shot receipt',async()=>{
 const resp=await lab.fetch(new Request('https://lab.invalid/v1/lab/source/verify-once',{
  method:'POST',headers:{'cf-access-jwt-assertion':'dummy',
   'content-type':'application/json'},body:'{"action":"VERIFY_AUTHENTICATED_SOURCE_PROOF_V1"}'
 }),{DB:{prepare(){throw Error('DB must never be accessed without token')}}});
 assert.equal(resp.status,503);
 const b=await resp.json();
 assert.equal(b.status,'PRECHECK_BLOCKED');
 assert.equal(b.code,'SOURCE_AUTH_LAB_SOURCE_READ_SECRET_MISSING');
});
test('durable one-shot replay guard stops all verification and GitHub calls',async()=>{
 const db={batch:async()=>[],prepare(sql){
  assert.match(sql,/INSERT INTO buffalo_full_source_lab_receipts/);
  return {bind(id){
   assert.equal(id,LAB_ID);
   return{run:async()=>({meta:{changes:0}})};
  }};
 }};
 let calls=0;
 const actual=await executeAuthenticatedSourceLab(db,TOKEN,async()=>{
  calls++;throw Error('network should not be reached');
 });
 assert.deepEqual(actual,{status:'ALREADY_STARTED',test_id:LAB_ID,run_again:false});
 assert.equal(calls,0);
 await assert.rejects(()=>executeAuthenticatedSourceLab(null,TOKEN),
  /SOURCE_AUTH_LAB_D1_BINDING_MISSING/);
});
