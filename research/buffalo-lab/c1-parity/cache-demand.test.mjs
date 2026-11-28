import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cacheLease,cacheModelHash,recordCache,loadBoundCache} from '../../../agent/tools/builtin/c1ParityCache.js';
import {recoverBoundFeedback} from '../../../agent/tools/builtin/c1ParityDemand.js';
import {createDiscussModelWithSeldonTool} from '../../../agent/tools/builtin/discussModelWithSeldon.js';
import {LLMWrapper} from '../../../utilities/LLMWrapper.js';
const id='s',ids=['A'];
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'c1-demand-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const session={clientId:'controlled',agentName:'merlin'};
 const data=JSON.parse(readFileSync(new URL('../../../evals/categories/feedbackExplanationData/inventoryWorkforce.json',import.meta.url)));
 const model=data.model;
 const feedback={runIds:ids,feedbackContent:{...data.feedback,provenance:{run_id:'A',run_sha256:'a'.repeat(64),model_sha256:'b'.repeat(64),revision:1}}};
 const behavior={A:{time:[0,1],Inventory:[10,11]}};
 const manager={getSession:()=>session,getClientModel:()=>model,getSessionTempDir:()=>dir,writeDataToDisk(_id,name,value){writeFileSync(join(dir,name),JSON.stringify(value));return {filePath:join(dir,name)};}};
 const modelHash=cacheModelHash(manager,id);
 manager.writeDataToDisk(id,'v.json',behavior);recordCache(manager,id,session,'behavior','A',modelHash,'v.json',behavior);
 const load=()=>loadBoundCache(manager,id,session,ids);
 const recover=(send,timeoutMs=1000)=>recoverBoundFeedback(manager,id,session,ids,modelHash,send,{timeoutMs});
 const reply=(msg,value=feedback)=>{assert.deepEqual(msg.runIds,ids);const entry=session.pendingFeedbackRequests.get(msg.requestId);assert(entry);entry.resolve(value);session.pendingFeedbackRequests.delete(msg.requestId);};
 return {dir,session,model,manager,feedback,behavior,load,recover,reply};
}
test('synchronous reply is correlated, recorded and not retried on a cache hit',async t=>{
 const f=fixture(t),release=cacheLease(f.session);
 try{const got=await f.recover(m=>f.reply(m));assert.deepEqual(got.feedbackContent,f.feedback.feedbackContent);assert.deepEqual(f.load(),got);assert.equal(f.session.pendingFeedbackRequests.size,0);
 await assert.rejects(f.recover(()=>assert.fail()),/C1_DEMAND_NOT_MISSING/);}finally{release();}
});
test('wrong run, model change, send failure and timeout leave no registered feedback',async t=>{
 for(const kind of ['wrong','drift','send','timeout','stalled-send']){
  const f=fixture(t),release=cacheLease(f.session);
  try{
   const send=m=>{if(kind==='wrong')f.reply(m,{...f.feedback,runIds:['B']});else if(kind==='drift'){f.model.variables[0].equation='changed';f.reply(m);}else if(kind==='send')throw Error('SEND_FAILED');else if(kind==='stalled-send'){f.reply(m);return new Promise(()=>{});}};
   await assert.rejects(f.recover(send,25),/C1_CACHE_FEEDBACK_RUN_MISMATCH|C1_CACHE_MODEL_CHANGED|SEND_FAILED|C1_DEMAND_TIMEOUT/);
   assert.equal(f.session.pendingFeedbackRequests.size,0);
   assert.throws(f.load,/C1_CACHE_EVIDENCE_MISSING/);
  }finally{release();}
 }
});
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
test('real Seldon handler holds lease across engine await and bounded feedback recovery',async t=>{
 const f=fixture(t),entered=deferred(),gate=deferred();
 const flags=['C1_PARITY_STRICT_CACHE','C1_PARITY_FEEDBACK_DEMAND'],prev=flags.map(k=>process.env[k]);
 const old=LLMWrapper.prototype.createChatCompletion;let calls=0,requests=0;
 for(const k of flags)process.env[k]='true';
 try{
  LLMWrapper.prototype.createChatCompletion=async function(messages,model,schema){
   calls++;
   if(calls===1){entered.resolve();await gate.promise;}
   const has=messages.some(m=>m.content.includes(JSON.stringify(f.feedback.feedbackContent,null,2)));
   assert.equal(has,calls===2);
   const parsed={response:'controlled',feedbackInformationRequired:calls===1};
   assert(schema.safeParse(parsed).success);return {parsed};
  };
  const tool=createDiscussModelWithSeldonTool(f.manager,id,m=>{requests++;f.reply(m);},{provider:'google',toolModels:{nonBuild:{normal:'gemini-3.8-flash'}}});
  const invoke=()=>tool.handler({prompt:'Explain Inventory.',difficulty:'normal',parameters:{runIds:ids}});
  const first=invoke();await entered.promise;
  try{const overlap=await invoke();assert.equal(overlap.isError,true);assert.match(overlap.content[0].text,/C1_CACHE_BUSY/);assert.equal(calls,1);}
  finally{gate.resolve();}
  const result=await first;assert.equal(result.isError,false,JSON.stringify(result));assert.equal(calls,2);assert.equal(requests,1);assert.deepEqual(f.load().feedbackContent,f.feedback.feedbackContent);cacheLease(f.session)();
 }finally{gate.resolve();LLMWrapper.prototype.createChatCompletion=old;flags.forEach((k,i)=>{if(prev[i]===undefined)delete process.env[k];else process.env[k]=prev[i];});}
});
test('model edit during first engine call consumes one controlled call but discards output and does not recover',async t=>{
 const f=fixture(t),entered=deferred(),gate=deferred();
 const flags=['C1_PARITY_STRICT_CACHE','C1_PARITY_FEEDBACK_DEMAND'],prev=flags.map(k=>process.env[k]);
 const old=LLMWrapper.prototype.createChatCompletion;let calls=0,requests=0;
 for(const k of flags)process.env[k]='true';
 try{
  LLMWrapper.prototype.createChatCompletion=async()=>{calls++;entered.resolve();await gate.promise;return {parsed:{response:'controlled',feedbackInformationRequired:true}};};
  const tool=createDiscussModelWithSeldonTool(f.manager,id,()=>{requests++;throw Error('UNEXPECTED_CLIENT');},{provider:'google',toolModels:{nonBuild:{normal:'gemini-3.8-flash'}}});
  const first=tool.handler({prompt:'Explain Inventory.',difficulty:'normal',parameters:{runIds:ids}});await entered.promise;
  f.model.variables[0].equation='changed';gate.resolve();const result=await first;
  assert.equal(result.isError,true);assert.match(result.content[0].text,/C1_CACHE_MODEL_CHANGED/);assert.equal(calls,1);assert.equal(requests,0);
 }finally{gate.resolve();LLMWrapper.prototype.createChatCompletion=old;flags.forEach((k,i)=>{if(prev[i]===undefined)delete process.env[k];else process.env[k]=prev[i];});}
});
