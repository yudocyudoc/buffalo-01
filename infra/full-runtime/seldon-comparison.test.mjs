import {test} from 'node:test';
import assert from 'node:assert/strict';
import {digest} from './provider-wire.mjs';
import {loadComparison,comparisonRequest,discussPersistedRuns} from './seldon-comparison.mjs';

const ids=['60efb506-f649-4b4a-955b-f1c210664bc1','d94baf4d-d379-4384-97f7-c7e6a083e441'];
async function fixture(){
 const settings={startTime:0,stopTime:4,dt:1,timeUnits:'Day',integrationMethod:'Euler'};
 const records=await Promise.all(ids.map(async(id,i)=>{
  const model={variables:[{name:'Demand',equation:String(5+i)}],relationships:[],specs:settings};
  const body=JSON.stringify(model);
  const hash=await digest(body);
  return {id,body,hash,model,record:{revision:i+1,model_sha256:hash,
   simulator:{name:'PySD',version:'3.14.0',source:'client',implementation_sha256:'b'.repeat(64)},
   settings:{...settings},execution:{integrationMethod:'Euler',dt:1},
   series:{time:[0,1,2,3,4],Inventory:i===0?[10,15,20,25,30]:[10,16,22,28,34]}}};
 }));
 let calls=0;
 const request=async(path,init)=>{
  if(path.startsWith('/api/')){calls++;return Response.json({success:true,output:{textContent:'<p>Fixture</p>',feedbackInformationRequired:false}});}
  const r=records.find(r=>path==='/project/runs/'+r.id);
  if(r)return Response.json(r.record);
  const m=records.find(r=>path==='/project/model/revisions/'+r.record.revision);
  if(m)return new Response(m.body,{headers:{etag:'"'+m.record.revision+'"','x-buffalo-model-sha256':m.hash}});
  return new Response(null,{status:404});
 };
 return {records,request,get calls(){return calls;}};
}
test('comparison preserves explicit order and supplies original model and both full series',async()=>{
 const f=await fixture(),runs=await loadComparison(f.request,[...ids].reverse());
 assert.deepEqual(runs.map(r=>r.id),[...ids].reverse());
 const p=comparisonRequest('seldon-ile-user','Compare.',runs);
 assert.deepEqual(p.currentModel,f.records[0].model);
 assert.equal(p.currentRunName,ids[0]);
 assert.deepEqual(JSON.parse(p.behaviorContent)[ids[1]].Inventory,[10,16,22,28,34]);
 assert(p.backgroundKnowledge.includes(f.records[1].hash));
 assert(!Object.hasOwn(p,'feedbackContent'));
 assert(!p.backgroundKnowledge.includes('"unitWarnings":'));
 assert(!p.backgroundKnowledge.includes('"errors":'));
});
test('different metadata key order permits discussion of the same simulation contract',async()=>{
 const f=await fixture();
 const record=f.records[1].record;
 for(const group of ['settings','execution','simulator']){
  record[group]=Object.fromEntries(Object.entries(record[group]).reverse());
 }
 const result=await discussPersistedRuns(f.request,'seldon','Compare.',ids,'fixture');
 assert.deepEqual(result.runIds,ids);
 assert.equal(f.calls,1);
});
test('different time units on a valid revision fail before inference',async()=>{
 const f=await fixture();
 const other=f.records[1];
 other.record.settings.timeUnits='Year';
 other.model.specs={...other.model.specs,timeUnits:'Year'};
 other.body=JSON.stringify(other.model);
 other.hash=await digest(other.body);
 other.record.model_sha256=other.hash;
 await assert.rejects(discussPersistedRuns(f.request,'seldon','Compare.',ids,'fixture'),/INCOMPARABLE_RUNS/);
 assert.equal(f.calls,0);
});
test('missing or tampered revision and incompatible run grids fail before inference',async()=>{
 for(const corrupt of [
  f=>{f.records[0].record.model_sha256='0'.repeat(64);},
  f=>{f.records[0].body+=' ';},
  f=>{f.records[1].record.series.time=[0,.5,2,3,4];},
  f=>{f.records[1].record.series.Demand=[6,6,6,6,6];},
  f=>{f.records[1].record.execution.dt=0.5;},
  f=>{f.records[1].record.simulator.version='different';},
  f=>{f.records[1].record.settings.dt=2;}
 ]){
  const f=await fixture();corrupt(f);
  await assert.rejects(discussPersistedRuns(f.request,'seldon','Compare.',ids,'fixture'));
  assert.equal(f.calls,0);
 }
});
test('unavailable or duplicate IDs and unsupported engines fail closed',async()=>{
 const f=await fixture();
 for(const pair of [[ids[0],ids[0]],[ids[0],'bad'],[ids[0],'58532b8a-b25e-4b67-a90b-10db57da263b']])
  await assert.rejects(discussPersistedRuns(f.request,'seldon','Compare.',pair,'fixture'));
 await assert.rejects(discussPersistedRuns(f.request,'quantitative','Compare.',ids,'fixture'),/UNSUPPORTED_DISCUSSION_ENGINE/);
 assert.equal(f.calls,0);
});
test('adapter preserves missing-feedback response and does not retry',async()=>{
 const f=await fixture();let calls=0;
 const request=(path,init)=>path.startsWith('/api/')?(calls++,Promise.resolve(Response.json({success:true,output:{textContent:'Need feedback.',feedbackInformationRequired:true}}))):f.request(path,init);
 const result=await discussPersistedRuns(request,'seldon','Why?',ids,'fixture');
 assert.equal(calls,1);assert.deepEqual(result.output,{textContent:'Need feedback.',feedbackInformationRequired:true});
});
