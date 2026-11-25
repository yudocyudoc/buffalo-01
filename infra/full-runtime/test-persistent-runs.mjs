import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createSimulationClient} from './simulation-client.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const parse=async(r,status=200)=>{assert.equal(r.status,status);return r.json();};
const assertStatus=async(p,status)=>{const r=await p;assert.equal(r.status,status);return r;};
const hashHeader='x-buffalo-model-sha256';
const source=new URL('./evidence/quantitative-45551954016/remote-receipt.json',import.meta.url);
const implSha=sha(Buffer.concat([
 readFileSync(new URL('../../utilities/SDJsonToXMILE.js',import.meta.url)),
 readFileSync(new URL('../../evals/utilities/simulator/PySDSimulator.js',import.meta.url)),
 readFileSync(new URL('../../third-party/PySD-simulator/simulator.py',import.meta.url))
]));
const write=(request,id,body)=>request('/project/runs/'+id,{method:'PUT',body:JSON.stringify(body)});
async function historical(request,revision){
 const r=await assertStatus(request('/project/model/revisions/'+revision),200);
 const body=await r.text();
 assert.equal(r.headers.get('etag'),'"'+revision+'"');
 assert.equal(r.headers.get(hashHeader),sha(body));
 return {revision,model_sha256:sha(body),model:JSON.parse(body)};
}
async function save(request,model,etag){
 const body=JSON.stringify(model);
 const r=await assertStatus(request('/project/model',{method:'PUT',headers:{'if-match':etag},body}),204);
 assert.equal(r.headers.get(hashHeader),sha(body));
 return Number(JSON.parse(r.headers.get('etag')));
}
async function run(input){
 const client=createSimulationClient();
 const model=structuredClone(input.model);
 const outcome=await client.request({type:'run_model'},model);
 assert.equal(outcome.simulated,true,outcome.error);
 const series=client.runs.get(outcome.runId).data;
 assert.deepEqual(model,input.model);
 const {startTime,stopTime,dt,timeUnits,integrationMethod}=model.specs;
 // This acceptance case is Euler with the original pinned PySD backend;
 // do not report an unobserved units check or errors check as an empty array.
 assert.equal(integrationMethod,'Euler');
 return {revision:input.revision,model_sha256:input.model_sha256,
  simulator:{name:'PySD',version:'3.14.0',source:'client',implementation_sha256:implSha},
  settings:{startTime,stopTime,dt,timeUnits,integrationMethod},
  execution:{integrationMethod:'Euler',dt},series};
}
export async function storePersistentRuns(request,other){
 const before=await assertStatus(request('/project/model'),200);
 const oldTag=before.headers.get('etag');
 const first=await historical(request,1);
 assert.equal(first.model.variables.find(v=>v.name==='Demand').equation,'3');
 assert.deepEqual(await parse(await request('/project/runs')),{runs:[],next_after:null});
 const bytes=readFileSync(source);
 assert.equal(sha(bytes),'5da8e835794921082d9fa5560f3be135772d2153349c2533b45a3e2ea37b0696');
 const original=JSON.parse(bytes).model;
 const rev1=await save(request,original,oldTag);
 const input1=await historical(request,rev1);
 // Capture the input before the next edit. Completion order deliberately
 // differs from revision order, without requiring a running container.
 const id1=randomUUID(),id2=randomUUID();
 const model2=structuredClone(input1.model);
 model2.variables.find(v=>v.name==='Demand').equation='6';
 const rev2=await save(request,model2,'"'+rev1+'"');
 const input2=await historical(request,rev2);
 assert.equal(rev2,rev1+1);
 await assertStatus(request('/project/model',{method:'PUT',headers:{'if-match':'"'+rev1+'"'},body:JSON.stringify(original)}),412);
 await assertStatus(request('/project/model/revisions/'+rev1,{method:'PUT',body:'{}'}),405);
 const second=await run(input2);
 assert.deepEqual(second.series.Inventory,[10,16,22,28,34]);
 const duplicates=await Promise.all([write(request,id2,second),write(request,id2,second)]);
 assert.deepEqual(duplicates.map(r=>r.status).sort(),[201,204]);
 const firstRun=await run(input1);
 assert.deepEqual(firstRun.series.Inventory,[10,15,20,25,30]);
 await assertStatus(write(request,id1,firstRun),201);
 await assertStatus(write(request,id1,firstRun),204);
 // Distinct valid completion bytes for the same operation must conflict.
 await assertStatus(write(request,id1,{...firstRun,unitWarnings:[]}),409);
 await assertStatus(write(request,randomUUID(),{...firstRun,model_sha256:'0'.repeat(64)}),409);
 await assertStatus(write(request,randomUUID(),{...firstRun,revision:rev2+1}),404);
 await assertStatus(write(request,randomUUID(),{...firstRun,settings:{...firstRun.settings,dt:2}}),422);
 await assertStatus(write(request,randomUUID(),{...firstRun,series:{...firstRun.series,Inventory:[10]}}),422);
 await assertStatus(write(request,randomUUID(),{...firstRun,series:{...firstRun.series,Inventory:[10,15,20,25,null]}}),422);
 await assertStatus(request('/project/runs/'+randomUUID(),{method:'PUT',body:' '.repeat(512*1024+1)}),413);
 await assertStatus(request('/project/runs/not-an-id'),404);
 await assertStatus(request('/project/runs?after=-1'),400);
 // The trusted client chooses the authorized project, not an incoming
 // x-buffalo-project header. Other storage has no access to these IDs.
 await assertStatus(other('/project/model/revisions/'+rev1),404);
 await assertStatus(other('/project/runs/'+id1),404);
 await assertStatus(write(other,id1,firstRun),404);
 assert.deepEqual(await parse(await other('/project/runs')),{runs:[],next_after:null});
 const list=await parse(await request('/project/runs'));
 assert.deepEqual(list.runs.map(r=>r.run_id),[id2,id1]);
 assert.deepEqual(list.runs.map(r=>r.revision),[rev2,rev1]);
 assert.deepEqual((await parse(await request('/project/runs?after='+list.runs[0].seq))).runs.map(r=>r.run_id),[id1]);
 assert.equal(list.next_after,null);
 console.log('FULL_PERSISTENT_RUNS_WRITTEN_OUT_OF_ORDER_AND_DUPLICATE_SAFE');
 return {id1,id2,rev1,rev2,firstRun,second,input1,input2};
}
export async function recoverPersistentRuns(request,other,state){
 const {id1,id2,rev1,rev2,firstRun,second,input1,input2}=state;
 assert.deepEqual(await historical(request,rev1),input1);
 assert.deepEqual(await historical(request,rev2),input2);
 const restored1=await parse(await request('/project/runs/'+id1));
 const restored2=await parse(await request('/project/runs/'+id2));
 assert.deepEqual(restored1,firstRun);assert.deepEqual(restored2,second);
 assert.equal(Object.hasOwn(restored1,'unitWarnings'),false);
 assert.equal(Object.hasOwn(restored1,'errors'),false);
 await assertStatus(write(request,id1,firstRun),204);
 await assertStatus(write(request,id1,{...firstRun,errors:[]}),409);
 await assertStatus(other('/project/runs/'+id2),404);
 await assertStatus(other('/project/model/revisions/'+rev2),404);
 assert.equal((await parse(await request('/project/runs'))).runs.length,2);
 console.log('FULL_PERSISTENT_RUNS_REOPENED_WITHOUT_RESIMULATION '+JSON.stringify({
  revisions:[rev1,rev2],hashes:[input1.model_sha256,input2.model_sha256],
  run_ids:[id1,id2],Inventory:[restored1.series.Inventory,restored2.series.Inventory]
 }));
}
