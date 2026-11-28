import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {comparisonHash,recordComparison,comparisonManifest} from '../../../agent/tools/builtin/c1ParityComparison.js';
import {cacheLease,cacheModelHash} from '../../../agent/tools/builtin/c1ParityCache.js';
import {createDiscussModelAcrossRunsTool} from '../../../agent/tools/builtin/discussModelAcrossRuns.js';
import {LLMWrapper} from '../../../utilities/LLMWrapper.js';
import {validateComparativeFeedback,recoverComparativeFeedback} from '../../../agent/tools/builtin/c1ParityComparativeFeedback.js';
function fixture(){
 const runs=[1,2].map(i=>({run_id:randomUUID(),revision:i,run_sha256:String(i).repeat(64),model_sha256:String(i+2).repeat(64),simulator:{name:'pysimlin',version:'0.8.5'},settings:{startTime:0,stopTime:1}}));
 const feedbackContent=runs.map(r=>({valid:true,provenance:{run_id:r.run_id,revision:r.revision,run_sha256:r.run_sha256,model_sha256:r.model_sha256,engine:r.simulator.name,version:r.simulator.version},feedbackLoops:[{identifier:'P0/B1',partition:0,links:[{from:'x',to:'x'}],signedRelativeScores:[-1,-1]}],dominantLoopsByPeriod:[{partition:0,startTime:0,endTime:1,dominantLoops:['P0/B1']}],scoreTimes:[0,1],activitySamples:2,normalization:'sum of absolute native loop scores within each Simlin partition at the same time',dominanceRule:'pysimlin 0.8.5 Run.dominant_periods'}));
 const manifest={runs,feedback_sha256:feedbackContent.map(comparisonHash)};
 return {manifest,data:{runIds:runs.map(r=>r.run_id),feedbackContent}};
}
test('exact ordered native feedback documents remain separate even with identical loop IDs',()=>{
 const {manifest,data}=fixture();const result=validateComparativeFeedback(data,manifest);assert.deepEqual(result,data.feedbackContent);assert.notEqual(result,data.feedbackContent);assert.notEqual(result[0].provenance.run_id,result[1].provenance.run_id);
});
test('pair feedback rejects reversed or missing documents and every identity mismatch',()=>{
 const {manifest,data}=fixture();
 for(const d of [{...data,runIds:[...data.runIds].reverse()},{...data,feedbackContent:[data.feedbackContent[0]]}])assert.throws(()=>validateComparativeFeedback(d,manifest),/C1_PAIR_FEEDBACK_ORDER_MISMATCH/);
 assert.throws(()=>validateComparativeFeedback({...data,feedbackContent:[...data.feedbackContent].reverse()},manifest),/C1_PAIR_FEEDBACK_IDENTITY_MISMATCH/);
 for(const k of ['run_id','revision','run_sha256','model_sha256','engine','version']){const d=structuredClone(data);d.feedbackContent[0].provenance[k]='other';assert.throws(()=>validateComparativeFeedback(d,manifest),/C1_PAIR_FEEDBACK_IDENTITY_MISMATCH/);}
});
test('score mutation, dangling period, cross-partition reference and different grids fail',()=>{
 const {manifest,data}=fixture();
 for(const [mutate,code] of [[f=>{f.feedbackLoops[0].signedRelativeScores[0]=-.5},'PAYLOAD_MISMATCH'],[f=>{f.dominantLoopsByPeriod[0].dominantLoops=['missing']},'PERIOD_INVALID'],[f=>{f.dominantLoopsByPeriod[0].partition=1},'PERIOD_INVALID'],[f=>{f.scoreTimes=[0,.5]},'GRID_MISMATCH']]){
  const d=structuredClone(data),m=structuredClone(manifest);mutate(d.feedbackContent[0]);if(code==='GRID_MISMATCH')m.feedback_sha256[0]=comparisonHash(d.feedbackContent[0]);
  assert.throws(()=>validateComparativeFeedback(d,m),new RegExp('C1_PAIR_FEEDBACK_'+code));
 }
});

test('invalid valid flag, oversized document, duplicate loop, out-of-range period and score are rejected even with refreshed client hashes',()=>{
 const {manifest,data}=fixture();
 for(const [mutate,code] of [
  [f=>{f.valid=false},'SHAPE_INVALID'],
  [f=>{f.extra='x'.repeat(66000)},'TOO_LARGE'],
  [f=>{f.feedbackLoops.push(structuredClone(f.feedbackLoops[0]))},'LOOP_INVALID'],
  [f=>{f.dominantLoopsByPeriod[0].endTime=2},'PERIOD_INVALID'],
  [f=>{f.feedbackLoops[0].signedRelativeScores[0]=-1.1},'LOOP_INVALID']
 ]){
  const d=structuredClone(data),m=structuredClone(manifest);mutate(d.feedbackContent[0]);m.feedback_sha256[0]=comparisonHash(d.feedbackContent[0]);
  assert.throws(()=>validateComparativeFeedback(d,m),new RegExp('C1_PAIR_FEEDBACK_'+code));
 }
});
function sessionFixture(t){
 const {manifest,data}=fixture(),ids=data.runIds;
 const dir=mkdtempSync(join(tmpdir(),'c1-pair-feedback-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const settings={startTime:0,stopTime:1,dt:1,timeUnits:'Months',integrationMethod:'RK4'};
 const model={variables:[{name:'Inventory',type:'stock',equation:'110'}],relationships:[],specs:structuredClone(settings)};
 const baseline=structuredClone(model);baseline.variables[0].equation='100';
 for(const [i,r] of manifest.runs.entries()){
  r.settings=structuredClone(settings);r.execution={dt:1,integrationMethod:'RK4'};
  r.simulator={...r.simulator,source:'server',implementation_sha256:'a'.repeat(64)};
  r.model=structuredClone(i===0?baseline:model);
 }
 const behavior={[ids[0]]:{time:[0,1],Inventory:[100,101]},[ids[1]]:{time:[0,1],Inventory:[110,111]}};
 Object.assign(manifest,{variables:['Inventory'],detailed:false,behavior_sha256:comparisonHash(behavior)});
 const session={context:{c1Comparison:manifest},clientId:'controlled',agentName:'merlin'};
 const manager={getSession:()=>session,getClientModel:()=>model,getSessionTempDir:()=>dir};
 const seed=()=>{writeFileSync(join(dir,'pair.json'),JSON.stringify(behavior));recordComparison(manager,'s',session,ids,cacheModelHash(manager,'s'),comparisonHash(manifest),'pair.json',behavior);};
 const reply=(msg,value=data)=>{assert.deepEqual(msg.runIds,ids);const p=session.pendingFeedbackRequests.get(msg.requestId);assert(p,'resolver registered before send');p.resolve(value);session.pendingFeedbackRequests.delete(msg.requestId);};
 const recover=(send,timeoutMs=500)=>recoverComparativeFeedback(manager,'s',session,ids,ids[1],cacheModelHash(manager,'s'),send,{timeoutMs});
 return {manifest,data,ids,model,behavior,session,manager,seed,reply,recover,dir};
}
async function withPairFeedback(fn){
 const flags=['C1_PARITY_STRICT_CACHE','C1_PARITY_COMPARISON','C1_PARITY_COMPARATIVE_FEEDBACK'],prev=flags.map(k=>process.env[k]),old=LLMWrapper.prototype.createChatCompletion;
 try{for(const k of flags)process.env[k]='true';await fn();}
 finally{LLMWrapper.prototype.createChatCompletion=old;flags.forEach((k,i)=>{if(prev[i]===undefined)delete process.env[k];else process.env[k]=prev[i];});}
}
const profile={provider:'google',toolModels:{nonBuild:{normal:'gemini-3.8-flash'}}};
function handler(f,send){const tool=createDiscussModelAcrossRunsTool(f.manager,'s',send,profile);return ()=>tool.handler({prompt:'Compare.',difficulty:'normal',runName:f.ids[1],parameters:{runIds:f.ids}});}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
const response=needed=>({parsed:{response:'Controlled comparison.',feedbackInformationRequired:needed}});
const assertReleased=f=>cacheLease(f.session)();
const pendingCount=f=>f.session.pendingFeedbackRequests?.size??0;
test('comparative manifest must pin two document digests',async t=>{
 await withPairFeedback(async()=>{
  const f=sessionFixture(t);
  for(const hashes of [undefined,[],['a'.repeat(64),'invalid']]){
   f.manifest.feedback_sha256=hashes;
   assert.throws(()=>comparisonManifest(f.manager,'s',f.session,f.ids),/C1_COMPARE_FEEDBACK_MANIFEST_INVALID/);
  }
 });
});
test('real ILE does not recover when unnecessary; at most one recovery and two engine calls per invocation', {timeout:3000},async t=>{
 await withPairFeedback(async()=>{
  for(const needs of [false,true]){
   const f=sessionFixture(t);f.seed();const wires=[],requests=[];
   LLMWrapper.prototype.createChatCompletion=async messages=>{wires.push(structuredClone(messages));return response(needs);};
   const invoke=handler(f,m=>{requests.push(m);f.reply(m);});
   const r=await invoke();assert.equal(r.isError,false,JSON.stringify(r));
   assert.equal(JSON.parse(r.content[0].text).feedbackInformationRequired,needs);
   assert.equal(wires.length,needs?2:1);assert.equal(requests.length,needs?1:0);assert.equal(pendingCount(f),0);
   assert(!JSON.stringify(wires[0]).includes('"feedbackLoops"'));
   if(needs){
    const exact=JSON.stringify(f.data.feedbackContent,null,2);
    assert.equal(wires[1].filter(m=>m.content.includes(exact)).length,1);
    for(const value of [JSON.stringify(f.manifest),JSON.stringify(f.behavior)])for(const wire of wires)assert(wire.some(m=>m.content.includes(value)));
   }
   assertReleased(f);
  }
 });
});
test('bounded recovery handles timeout, stalled send after reply, send failure, client rejection and late reply', {timeout:3000},async t=>{
 await withPairFeedback(async()=>{
  for(const kind of ['timeout','stalled-send','send-error','client-error']){
   const f=sessionFixture(t);f.seed();const release=cacheLease(f.session);let message;
   try{
    const send=m=>{
     message=m;
     if(kind==='send-error')throw Error('SEND_FAILED');
     if(kind==='client-error'){f.session.pendingFeedbackRequests.get(m.requestId).reject(Error('CLIENT_FAILED'));return;}
     if(kind==='stalled-send'){f.reply(m);return new Promise(()=>{});}
    };
    await assert.rejects(f.recover(send,25),kind==='send-error'?/SEND_FAILED/:kind==='client-error'?/CLIENT_FAILED/:/C1_PAIR_FEEDBACK_TIMEOUT/);
    assert(message);assert.equal(pendingCount(f),0);assert.equal(f.session.pendingFeedbackRequests.get(message.requestId),undefined);
    // Mirrors the real resolver's no-entry path for a tardy response.
    assert.equal(f.session.pendingFeedbackRequests.has(message.requestId),false);
   }finally{release();}
   assertReleased(f);
  }
 });
});
test('real handler rejects wrong order, copied identity and payload with zero retry and clears pending', {timeout:3000},async t=>{
 await withPairFeedback(async()=>{
  for(const [mutate,code] of [
   [d=>{d.runIds.reverse()},'ORDER_MISMATCH'],
   [d=>{d.feedbackContent[0]=structuredClone(d.feedbackContent[1])},'IDENTITY_MISMATCH'],
   [d=>{d.feedbackContent[0].feedbackLoops[0].signedRelativeScores[0]=-.7},'PAYLOAD_MISMATCH']
  ]){
   const f=sessionFixture(t);f.seed();let calls=0,requests=0;
   LLMWrapper.prototype.createChatCompletion=async()=>{calls++;return response(true);};
   const result=await handler(f,m=>{requests++;const d=structuredClone(f.data);mutate(d);f.reply(m,d);})();
   assert.equal(result.isError,true);assert.match(result.content[0].text,new RegExp('C1_PAIR_FEEDBACK_'+code));
   assert.equal(calls,1);assert.equal(requests,1);assert.equal(pendingCount(f),0);assertReleased(f);
  }
 });
});
test('real handler holds lease during feedback wait and rejects model or context drift without retry', {timeout:3000},async t=>{
 await withPairFeedback(async()=>{
  for(const kind of ['none','model','context']){
   const f=sessionFixture(t);f.seed();const sent=deferred();let calls=0,requests=0,msg,first;
   LLMWrapper.prototype.createChatCompletion=async()=>{calls++;return response(calls===1);};
   const invoke=handler(f,m=>{requests++;msg=m;sent.resolve();});
   first=invoke();
   try{
    await Promise.race([sent.promise,first.then(()=>{throw Error('handler completed before feedback request');})]);
    const overlap=await invoke();assert.equal(overlap.isError,true);assert.match(overlap.content[0].text,/C1_CACHE_BUSY/);
    if(kind==='model')f.model.variables[0].equation='120';
    if(kind==='context')f.manifest.runs[0].revision=9;
   }finally{if(msg&&f.session.pendingFeedbackRequests.has(msg.requestId))f.reply(msg);await first;}
   const r=await first;
   if(kind==='none'){assert.equal(r.isError,false,JSON.stringify(r));assert.equal(calls,2);}
   else{assert.equal(r.isError,true);assert.match(r.content[0].text,kind==='model'?/C1_CACHE_MODEL_CHANGED/:/C1_COMPARE_CONTEXT_CHANGED/);assert.equal(calls,1);}
   assert.equal(requests,1);assert.equal(pendingCount(f),0);assertReleased(f);
  }
 });
});
test('model and context drift during second engine call discards output without additional acquisition', {timeout:3000},async t=>{
 await withPairFeedback(async()=>{
  for(const kind of ['model','context']){
   const f=sessionFixture(t);f.seed();const entered=deferred(),gate=deferred();let calls=0,requests=0;
   LLMWrapper.prototype.createChatCompletion=async()=>{calls++;if(calls===1)return response(true);if(calls===2){entered.resolve();await gate.promise;}return response(true);};
   const invoke=handler(f,m=>{requests++;f.reply(m);}),first=invoke();
   try{
    await Promise.race([entered.promise,first.then(()=>{throw Error('handler completed before retry');})]);
    if(kind==='model')f.model.variables[0].equation='120';else f.manifest.runs[0].revision=9;
   }finally{gate.resolve();}
   const r=await first;assert.equal(r.isError,true);assert.match(r.content[0].text,kind==='model'?/C1_CACHE_MODEL_CHANGED/:/C1_COMPARE_CONTEXT_CHANGED/);
   assert.equal(calls,2);assert.equal(requests,1);assert.equal(pendingCount(f),0);assertReleased(f);
  }
 });
});
