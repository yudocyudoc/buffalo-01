import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {comparisonHash,comparisonManifest,validatePairData,recordComparison,loadComparisonCache,invalidateComparison} from '../../../agent/tools/builtin/c1ParityComparison.js';
import {cacheModelHash} from '../../../agent/tools/builtin/c1ParityCache.js';
import {createGetVariableDataTool} from '../../../agent/tools/builtin/clientInteractionTools.js';
import {createDiscussModelAcrossRunsTool} from '../../../agent/tools/builtin/discussModelAcrossRuns.js';
import {LLMWrapper} from '../../../utilities/LLMWrapper.js';
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'c1-compare-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const settings={startTime:0,stopTime:1,dt:1,timeUnits:'Months',integrationMethod:'RK4'};
 const ids=[randomUUID(),randomUUID()],model={variables:[{name:'Inventory',type:'stock',equation:'110'}],relationships:[],specs:settings},baseline=structuredClone(model);baseline.variables[0].equation='100';
 const data={[ids[0]]:{time:[0,1],Inventory:[100,101]},[ids[1]]:{time:[0,1],Inventory:[110,111]}};
 const manifest={runs:[baseline,model].map((m,i)=>({run_id:ids[i],revision:i+1,model_sha256:String(i+1).repeat(64),run_sha256:String(i+3).repeat(64),simulator:{source:'server',name:'Simlin',version:'test',implementation_sha256:'a'.repeat(64)},settings:structuredClone(settings),execution:{dt:1,integrationMethod:'RK4'},model:structuredClone(m)})),variables:['Inventory'],detailed:false,behavior_sha256:comparisonHash(data)};
 const session={context:{c1Comparison:manifest},clientId:'controlled',agentName:'merlin'};
 const manager={getSession:()=>session,getClientModel:()=>model,getSessionTempDir:()=>dir};
 function seed(){writeFileSync(join(dir,'pair.json'),JSON.stringify(data));recordComparison(manager,'s',session,ids,cacheModelHash(manager,'s'),comparisonHash(manifest),'pair.json',data);}
 const load=(pair=ids,current=ids[1])=>loadComparisonCache(manager,'s',session,pair,current);
 return {dir,ids,model,manifest,data,session,manager,seed,load};
}
test('ordered pair preserves each historical model, exact payload and current ID',t=>{
 const f=fixture(t);assert.throws(f.load,/C1_COMPARE_EVIDENCE_MISSING/);f.seed();const e=f.load();
 assert.deepEqual(JSON.parse(e.behaviorContent),f.data);assert(e.backgroundKnowledge.includes(JSON.stringify(f.manifest)));
 assert.throws(()=>f.load([...f.ids].reverse()),/C1_COMPARE_ORDERED_PAIR_REQUIRED/);
 assert.throws(()=>f.load(f.ids,f.ids[0]),/C1_COMPARE_CURRENT_RUN_REQUIRED/);
 assert.throws(()=>f.load([f.ids[0],f.ids[0]]),/C1_COMPARE_ORDERED_PAIR_REQUIRED/);
});
test('reject incompatible settings, missing columns, divergent grid and modified payload',t=>{
 const f=fixture(t);f.manifest.runs[0].execution.dt=2;
 assert.throws(()=>comparisonManifest(f.manager,'s',f.session,f.ids),/C1_COMPARE_INCOMPATIBLE_RUNS/);f.manifest.runs[0].execution.dt=1;
 for(const [mutate,code] of [[d=>delete d[f.ids[0]].Inventory,'C1_COMPARE_COLUMNS_MISMATCH'],[d=>{d[f.ids[0]].time=[0,2]},'C1_COMPARE_GRID_MISMATCH'],[d=>{d[f.ids[0]].Inventory[0]=999},'C1_COMPARE_PAYLOAD_MISMATCH']]){
  const d=structuredClone(f.data);mutate(d);assert.throws(()=>validatePairData(d,f.manifest),new RegExp(code));
 }
 f.seed();writeFileSync(join(f.dir,'pair.json'),JSON.stringify({...f.data,[f.ids[0]]:{time:[0,1],Inventory:[999,101]}}));
 assert.throws(f.load,/C1_COMPARE_PAYLOAD_MISMATCH/);
});
test('model/context drift and invalidated receipt cannot be consumed',t=>{
 const f=fixture(t);f.seed();f.model.variables[0].equation='120';assert.throws(f.load,/C1_COMPARE_CURRENT_MODEL_MISMATCH/);
 f.model.variables[0].equation='110';f.manifest.runs[0].revision=9;assert.throws(f.load,/C1_COMPARE_CONTEXT_CHANGED/);
 f.manifest.runs[0].revision=1;invalidateComparison(f.session);assert.throws(f.load,/C1_COMPARE_EVIDENCE_MISSING/);
});
test('real comparison handler denies reversed pair or wrong current before engine or client',async t=>{
 const f=fixture(t);f.seed();const flags=['C1_PARITY_STRICT_CACHE','C1_PARITY_COMPARISON'],prev=flags.map(k=>process.env[k]),old=LLMWrapper.prototype.createChatCompletion;let calls=0,requests=0;
 try{for(const k of flags)process.env[k]='true';LLMWrapper.prototype.createChatCompletion=async()=>{calls++;throw Error('UNEXPECTED_ENGINE');};
 const tool=createDiscussModelAcrossRunsTool(f.manager,'s',()=>{requests++;throw Error('UNEXPECTED_CLIENT');},{provider:'google',toolModels:{nonBuild:{normal:'gemini-3.8-flash'}}});
 for(const [ids,current,code] of [[[...f.ids].reverse(),f.ids[0],'C1_COMPARE_ORDERED_PAIR_REQUIRED'],[f.ids,f.ids[0],'C1_COMPARE_CURRENT_RUN_REQUIRED']]){
 const r=await tool.handler({prompt:'Compare.',difficulty:'normal',runName:current,parameters:{runIds:ids}});assert.equal(r.isError,true);assert.match(r.content[0].text,new RegExp(code));}
 assert.equal(calls,0);assert.equal(requests,0);
 }finally{LLMWrapper.prototype.createChatCompletion=old;flags.forEach((k,i)=>{if(prev[i]===undefined)delete process.env[k];else process.env[k]=prev[i];});}
});

test('manifest allowlist, byte cap, distinct revisions and both model schemas fail closed',t=>{
 const f=fixture(t),original=structuredClone(f.manifest);
 const check=(mutate,code)=>{f.session.context.c1Comparison=structuredClone(original);mutate(f.session.context.c1Comparison);assert.throws(()=>comparisonManifest(f.manager,'s',f.session,f.ids),new RegExp(code));};
 check(m=>{m.extra='not evidence'},'C1_COMPARE_MANIFEST_INVALID');
 check(m=>{m.runs[0].extra='not evidence'},'C1_COMPARE_MANIFEST_INVALID');
 check(m=>{m.runs[0].model={garbage:true}},'C1_COMPARE_PROVENANCE_INVALID');
 check(m=>{m.runs[0].model.title='x'.repeat(50000)},'C1_COMPARE_MANIFEST_TOO_LARGE');
 for(const key of ['revision','model_sha256','run_sha256'])check(m=>{m.runs[0][key]=m.runs[1][key]},'C1_COMPARE_DISTINCT_REVISIONS_REQUIRED');
 check(m=>{m.runs[0].model_sha256='bad'},'C1_COMPARE_PROVENANCE_INVALID');
 check(m=>{m.variables=['Not present']},'C1_COMPARE_MANIFEST_INVALID');
});
async function withComparison(fn){
 const flags=['C1_PARITY_STRICT_CACHE','C1_PARITY_COMPARISON'],prev=flags.map(k=>process.env[k]),old=LLMWrapper.prototype.createChatCompletion;
 try{for(const k of flags)process.env[k]='true';await fn();}finally{LLMWrapper.prototype.createChatCompletion=old;flags.forEach((k,i)=>{if(prev[i]===undefined)delete process.env[k];else process.env[k]=prev[i];});}
}
const profile={provider:'google',toolModels:{nonBuild:{normal:'gemini-3.8-flash'}}};
test('comparison acquisition rejects wrong variables or sampling before client request',async t=>{
 const f=fixture(t);await withComparison(async()=>{
 let calls=0;const tool=createGetVariableDataTool(f.manager,'s',()=>{calls++;throw Error('UNEXPECTED_CLIENT');});
 for(const [variableNames,detailed] of [[['Other'],false],[['Inventory'],true],[['Inventory'],undefined]]){
  const r=await tool.handler({runIds:f.ids,variableNames,detailed});assert.equal(r.isError,true);assert.match(r.content[0].text,/C1_COMPARE_REQUEST_MISMATCH/);
 }assert.equal(calls,0);
 });
});
test('real ILE handler ignores planted feedback and planner metadata, preserves literal dollar sequences and feedback-needed flag without retry',async t=>{
 const f=fixture(t);
 // Historical model metadata is JSON, not a JavaScript replacement template.
 f.manifest.runs[0].model.title="literal $& $$ $' $\u0060";
 f.seed();
 const planted={runIds:[f.ids[0]],feedbackContent:{feedbackLoops:[{identifier:'B1',name:'PLANTED_FEEDBACK_SENTINEL'}]}};
 writeFileSync(join(f.dir,'feedback.json'),JSON.stringify(planted));
 await withComparison(async()=>{
  let calls=0,requests=0;
  LLMWrapper.prototype.createChatCompletion=async(messages,_model,schema)=>{
   calls++;const wire=JSON.stringify(messages);assert(!wire.includes('PLANTED_FEEDBACK_SENTINEL'));assert(!wire.includes('PLANNER_SYSTEM_SENTINEL'));assert(!wire.includes('PLANNER_BACKGROUND_SENTINEL'));
   assert(messages.some(m=>m.role==='user'&&m.content.includes(JSON.stringify(f.manifest))));
   assert(messages.some(m=>m.role==='user'&&m.content.includes(JSON.stringify(f.data))));
   const parsed={response:'Feedback is needed.',feedbackInformationRequired:true};assert(schema.safeParse(parsed).success);return {parsed};
  };
  const tool=createDiscussModelAcrossRunsTool(f.manager,'s',()=>{requests++;throw Error('UNEXPECTED_CLIENT');},profile);
  const r=await tool.handler({prompt:'Compare.',difficulty:'normal',runName:f.ids[1],parameters:{runIds:f.ids,problemStatement:'PLANNER_SYSTEM_SENTINEL',backgroundKnowledge:'PLANNER_BACKGROUND_SENTINEL',feedbackContent:planted.feedbackContent}});
  assert.equal(r.isError,false,JSON.stringify(r));assert.equal(JSON.parse(r.content[0].text).feedbackInformationRequired,true);assert.equal(calls,1);assert.equal(requests,0);
 });
});
test('comparison lease holds during motor await; model drift discards one spent invocation',async t=>{
 const f=fixture(t);f.seed();await withComparison(async()=>{
  let enter,release,calls=0;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
  LLMWrapper.prototype.createChatCompletion=async()=>{calls++;enter();await gate;return {parsed:{response:'Controlled comparison.',feedbackInformationRequired:false}};};
  const tool=createDiscussModelAcrossRunsTool(f.manager,'s',()=>assert.fail('unexpected client'),profile);
  const invoke=()=>tool.handler({prompt:'Compare.',difficulty:'normal',runName:f.ids[1],parameters:{runIds:f.ids}});
  const first=invoke();await entered;
  try{const overlap=await invoke();assert.equal(overlap.isError,true);assert.match(overlap.content[0].text,/C1_CACHE_BUSY/);f.model.variables[0].equation='120';}
  finally{release();}
  const result=await first;assert.equal(result.isError,true);assert.match(result.content[0].text,/C1_CACHE_MODEL_CHANGED/);assert.equal(calls,1);
 });
});
