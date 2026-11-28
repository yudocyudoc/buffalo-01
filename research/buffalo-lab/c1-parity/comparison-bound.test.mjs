import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {comparisonHash,comparisonManifest,validatePairData,recordComparison,loadComparisonCache,invalidateComparison} from '../../../agent/tools/builtin/c1ParityComparison.js';
import {cacheModelHash} from '../../../agent/tools/builtin/c1ParityCache.js';
import {createDiscussModelAcrossRunsTool} from '../../../agent/tools/builtin/discussModelAcrossRuns.js';
import {LLMWrapper} from '../../../utilities/LLMWrapper.js';
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'c1-compare-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const ids=[randomUUID(),randomUUID()],model={variables:[{name:'Inventory',type:'stock',equation:'110'}],relationships:[]},baseline=structuredClone(model);baseline.variables[0].equation='100';
 const data={[ids[0]]:{time:[0,1],Inventory:[100,101]},[ids[1]]:{time:[0,1],Inventory:[110,111]}};
 const manifest={runs:[baseline,model].map((m,i)=>({run_id:ids[i],revision:i+1,model_sha256:String(i+1).repeat(64),run_sha256:String(i+3).repeat(64),simulator:{source:'server'},settings:{dt:1},execution:{dt:1},model:structuredClone(m)})),variables:['Inventory'],detailed:false,behavior_sha256:comparisonHash(data)};
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
 const f=fixture(t);f.manifest.runs[0].settings.dt=2;
 assert.throws(()=>comparisonManifest(f.manager,'s',f.session,f.ids),/C1_COMPARE_INCOMPATIBLE_RUNS/);f.manifest.runs[0].settings.dt=1;
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
