import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cacheLease,cacheModelHash,recordCache,loadBoundCache,invalidateCacheSlot} from '../../../agent/tools/builtin/c1ParityCache.js';
import {createDiscussModelWithSeldonTool} from '../../../agent/tools/builtin/discussModelWithSeldon.js';
import {createGenerateLtmNarrativeTool} from '../../../agent/tools/builtin/generateLtmNarrative.js';
import {LLMWrapper} from '../../../utilities/LLMWrapper.js';
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'c1-bound-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const session={clientId:'controlled',agentName:'merlin'},model={variables:[{name:'Inventory',type:'stock',equation:'10'}]};
 const manager={getSession:()=>session,getClientModel:()=>model,getSessionTempDir:()=>dir};
 const feedback={runIds:['A'],feedbackContent:{provenance:{run_id:'A',run_sha256:'a'.repeat(64),model_sha256:'b'.repeat(64),revision:1},feedbackLoops:[]}};
 const behavior={A:{time:[0,1],Inventory:[10,11]}};
 function add(kind,data,filename){writeFileSync(join(dir,filename),JSON.stringify(data));recordCache(manager,'s',session,kind,'A',cacheModelHash(manager,'s'),filename,data);}
 const seed=()=>{add('feedback',feedback,'feedback.json');add('behavior',behavior,'variable_data_1.json');};
 const load=(ids=['A'])=>loadBoundCache(manager,'s',session,ids);
 return {dir,session,model,manager,feedback,behavior,add,seed,load};
}
test('bound cache uses registered file, not lexically latest file',t=>{
 const f=fixture(t);f.seed();writeFileSync(join(f.dir,'variable_data_999.json'),JSON.stringify({B:{time:[0,1],Inventory:[0,0]}}));
 assert.deepEqual(f.load(),{feedbackContent:f.feedback.feedbackContent,behaviorContent:JSON.stringify(f.behavior.A)});
 for(const ids of [undefined,[],['A','B']])assert.throws(()=>loadBoundCache(f.manager,'s',f.session,ids),/C1_CACHE_EXPLICIT_SINGLE_RUN_REQUIRED/);
 assert.throws(()=>f.load(['B']),/C1_CACHE_FEEDBACK_RUN_MISMATCH/);
});
test('unregistered, invalidated, changed model or modified file fails closed',t=>{
 const f=fixture(t);assert.throws(()=>f.load(),/C1_CACHE_EVIDENCE_MISSING/);
 f.seed();f.model.variables[0].equation='11';assert.throws(()=>f.load(),/C1_CACHE_MODEL_CHANGED/);
 f.model.variables[0].equation='10';writeFileSync(join(f.dir,'feedback.json'),JSON.stringify({...f.feedback,extra:true}));
 assert.throws(()=>f.load(),/C1_CACHE_PAYLOAD_CHANGED/);
 f.seed();invalidateCacheSlot(f.session,'behavior');assert.throws(()=>f.load(),/C1_CACHE_EVIDENCE_MISSING/);
});
test('bad provenance, wrong behavior run, invalid grid and invalid columns cannot register',t=>{
 const f=fixture(t);
 assert.throws(()=>f.add('feedback',{...f.feedback,feedbackContent:{provenance:{...f.feedback.feedbackContent.provenance,run_id:'B'}}},'feedback.json'),/C1_CACHE_FEEDBACK_PROVENANCE_INVALID/);
 assert.throws(()=>f.add('behavior',{B:f.behavior.A},'v.json'),/C1_CACHE_BEHAVIOR_RUN_MISMATCH/);
 assert.throws(()=>f.add('behavior',{A:{time:[0,0],Inventory:[1,2]}},'v.json'),/C1_CACHE_GRID_INVALID/);
 assert.throws(()=>f.add('behavior',{A:{time:[0,1],Inventory:[1]}},'v.json'),/C1_CACHE_COLUMNS_INVALID/);
 assert.throws(()=>f.load(),/C1_CACHE_EVIDENCE_MISSING/);
});
test('lease rejects overlap and releases after exit',t=>{
 const f=fixture(t);const release=cacheLease(f.session);assert.throws(()=>cacheLease(f.session),/C1_CACHE_BUSY/);release();cacheLease(f.session)();
});
test('both actual handlers reject mismatched or missing cache before any engine call',async t=>{
 const f=fixture(t),oldFlag=process.env.C1_PARITY_STRICT_CACHE,old=LLMWrapper.prototype.createChatCompletion;
 let calls=0,clientCalls=0;
 process.env.C1_PARITY_STRICT_CACHE='true';LLMWrapper.prototype.createChatCompletion=async()=>{calls++;throw Error('UNEXPECTED_ENGINE');};
 try{
  const profile={provider:'google',toolModels:{nonBuild:{normal:'gemini-3.8-flash'}}};
  const send=()=>{clientCalls++;throw Error('UNEXPECTED_CLIENT');};
  const handlers=[createDiscussModelWithSeldonTool(f.manager,'s',send,profile),createGenerateLtmNarrativeTool(f.manager,'s',send,profile)];
  const invoke=(h,ids)=>h.handler({prompt:'Explain inventory.',difficulty:'normal',parameters:{runIds:ids}});
  for(const h of handlers){let r=await invoke(h,['A']);assert.equal(r.isError,true);assert.match(r.content[0].text,/C1_CACHE_EVIDENCE_MISSING/);}
  f.seed();
  for(const h of handlers){for(const ids of [['B'],[]]){
   const r=await invoke(h,ids);assert.equal(r.isError,true);assert.match(r.content[0].text,/C1_CACHE_(FEEDBACK_RUN_MISMATCH|EXPLICIT_SINGLE_RUN_REQUIRED)/);
  }}
  assert.equal(calls,0);assert.equal(clientCalls,0);
 }finally{LLMWrapper.prototype.createChatCompletion=old;if(oldFlag===undefined)delete process.env.C1_PARITY_STRICT_CACHE;else process.env.C1_PARITY_STRICT_CACHE=oldFlag;}
});
