import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildHandoff} from './prepare-handoff.mjs';
import {normalizeHandoff,digestHandoff,handoffReceipt,
 HANDOFF_SCHEMA,HANDOFF_KIND,HANDOFF_STATE} from './handoff-contract.mjs';
import {handle} from '../../workers/buffalo-control-plane/index.mjs';
import {D1FullHandoffStore} from '../../workers/buffalo-control-plane/full-handoff-store.mjs';
import {acceptOfflineTask,OFFLINE_KIND} from '../control-plane/contract.mjs';

const ID='123e4567-e89b-42d3-a456-426614174111';
const SHA='a'.repeat(64),COMMIT='b'.repeat(40);
const sh=v=>createHash('sha256').update(v).digest('hex');
const sourceManifest={
 status:'PASS',mode:'SOURCE_READ_ONLY',source_sha256:'c'.repeat(64),
 agents:[{id:'merlin',config:'agent/config/merlin.md'}],
 components:[{path:'agent/config/merlin.md',sha256:'d'.repeat(64)}]
};
const model={variables:[{name:'Customers',type:'stock',equation:'5'}],relationships:[]};
const params={mode:'sfd',problemStatement:'Reduce queue delay'};
const group={policyImplementation:['meetsGoal','intact','sensible'].map(criterion=>({
 prompt:'Improve service, keep outside factors unchanged',currentModel:model,
 additionalParameters:params,heldOut:false,
 expectations:{scenario:'coffeePeak',criterion}
}))};
const request={handoff_id:ID,agent:'merlin',case_index:0,commit_sha:COMMIT,sourceManifest,groups:group};
const candidate=()=>buildHandoff(request);

test('stage2 derives scenario and hashes from original benchmark descriptors, not synthetic success',async()=>{
 const r=await candidate();
 assert.equal(r.execution,'NOT_EXECUTED');
 assert.equal(r.provenance,'DECLARED_UNVERIFIED');
 assert.equal(r.manifest.scenario_id,'coffeePeak');
 assert.equal(r.manifest.schema_version,HANDOFF_SCHEMA);
 assert.equal(r.manifest.kind,HANDOFF_KIND);
 assert.equal(r.manifest.initial_model_sha256,sh(JSON.stringify(model)));
 assert.equal(r.manifest.prompt_sha256,sh(group.policyImplementation[0].prompt));
 assert.equal(r.manifest.agent_config_sha256,'d'.repeat(64));
 assert.equal(r.manifest.parameters_sha256,sh(JSON.stringify({...params,agentName:'merlin',mode:'sfd'})));
 assert.equal(r.manifest_sha256,await digestHandoff(r.manifest));
 assert.equal((await candidate()).manifest_sha256,r.manifest_sha256);
});

test('strict handoff schema rejects executable/paid fields, absent IDs and illegal source identities',async()=>{
 const {manifest}=await candidate();
 for(const change of [
  {workflow:'paid-agent-case.yml'},{paid:true},{execution_allowed:true},
  {provider:'cloudflare'},{prompt:'raw prompt exposed'},
  {github_run_id:123},{command:'bash -c curl'},
  {kind:'BUFFALO_OFFLINE_ECHO_V1'},{schema_version:'NEW_SCHEMA'},
  {agent:'evil'},{scenario_id:'../payload'},{case_index:-1},
  {commit_sha:'not-a-git-sha'},{initial_model_sha256:'short'}
 ]){
  assert.throws(()=>normalizeHandoff({...manifest,...change}),/FULL_HANDOFF_INVALID/);
 }
 assert.throws(()=>acceptOfflineTask({...manifest,kind:HANDOFF_KIND}),/CONTROL_PLANE_/);
 assert.equal(acceptOfflineTask({task_id:ID,kind:OFFLINE_KIND,input_sha256:SHA}).state,'READY');
});

test('manifest hash binds agent, scenario, case, commit, model and all source fingerprints',async()=>{
 const {manifest}=await candidate();
 const base=await digestHandoff(manifest);
 for(const changed of [
  {agent:'socrates'},{scenario_id:'nextCase'},{case_index:1},{commit_sha:'f'.repeat(40)},
  {agent_config_sha256:'e'.repeat(64)},{prompt_sha256:'e'.repeat(64)},
  {initial_model_sha256:'e'.repeat(64)},{parameters_sha256:'e'.repeat(64)},
  {source_sha256:'e'.repeat(64)}
 ]){
  assert.notEqual(await digestHandoff({...manifest,...changed}),base);
 }
 const canonical=normalizeHandoff(manifest);
 assert.deepEqual(Object.keys(canonical),Object.keys(manifest));
 assert.equal(await digestHandoff({...manifest,source_sha256:manifest.source_sha256.toUpperCase()}),base);
});

test('preparer rejects held-out, missing grader, sibling drift, absent source agent',async()=>{
 await assert.rejects(()=>buildHandoff({...request,case_index:4}),/CASE_INDEX_OUT_OF_BOUNDS/);
 await assert.rejects(()=>buildHandoff({...request,agent:'themis'}),/AGENT_NOT_IN_SOURCE_GATE/);
 await assert.rejects(()=>buildHandoff({...request,sourceManifest:{...sourceManifest,status:'FAIL'}}),/SOURCE_GATE_NOT_PASSED/);
 await assert.rejects(()=>buildHandoff({...request,groups:{policyImplementation:group.policyImplementation.map(x=>({...x,heldOut:true}))}}),/HELD_OUT_NOT_ALLOWED/);
 await assert.rejects(()=>buildHandoff({...request,groups:{policyImplementation:group.policyImplementation.slice(0,2)}}),/CRITERIA_MISSING/);
 await assert.rejects(()=>buildHandoff({...request,groups:{policyImplementation:[...group.policyImplementation.slice(0,2),{...group.policyImplementation[2],prompt:'tampered'}]}}),/SIBLING_BASELINE_DRIFT/);
});

test('D1 store rejects absent DB binding and receipt is strictly non-executable',()=>{
 assert.throws(()=>new D1FullHandoffStore(null),/D1_BINDING_REQUIRED/);
 const r=handoffReceipt({...normalizeHandoff({
  schema_version:HANDOFF_SCHEMA,handoff_id:ID,kind:HANDOFF_KIND,agent:'merlin',
  benchmark:'policyImplementation',scenario_id:'coffeePeak',case_index:0,
  mode:'sfd',commit_sha:COMMIT,source_sha256:SHA,agent_config_sha256:SHA,
  prompt_sha256:SHA,initial_model_sha256:SHA,parameters_sha256:SHA
 }),state:HANDOFF_STATE,manifest_sha256:SHA,execution_allowed:0,provenance_verified:0,github_run_id:null});
 assert.equal(r.execution_allowed,false);
 assert.equal(r.provenance_verified,false);
 assert.equal(r.github_run_id,null);
 assert.equal(r.state,HANDOFF_STATE);
});

test('authenticated handoff POST/GET is isolated from original dispatch and rejects collisions',async()=>{
 const normalized=(await candidate()).manifest;
 const token='a'.repeat(44);
 const auth={authorization:'Bearer '+token};
 const store={
  row:null,events:[],
  async create(m){
   const digest=await digestHandoff(m);
   if(this.row&&this.row.manifest_sha256!==digest)throw Error('FULL_HANDOFF_ID_CONFLICT');
   const created=!this.row;
   if(created){this.row={...m,state:HANDOFF_STATE,manifest_sha256:digest,
    execution_allowed:0,provenance_verified:0,github_run_id:null};
    this.events.push('DECLARATION_ADMITTED');}
   return {created,row:this.row}
  },
  async read(id){return this.row?.handoff_id===id?this.row:null}
 };
 const env={DB:{},GITHUB_FINE_GRAINED_TOKEN:'MOCK_NOT_USED',CONTROL_API_TOKEN:token};
 const create=(body,headers=auth)=>handle(new Request('https://worker.invalid/v1/full/handoffs',{
  method:'POST',headers,body:JSON.stringify(body)
 }),env,{fullHandoffStore:store,store:{}});
 assert.equal((await create(normalized,{})).status,401);
 const admitted=await create(normalized);
 assert.equal(admitted.status,201);
 const created=await admitted.json();
 assert.equal(created.created,true);
 assert.equal(created.state,HANDOFF_STATE);
 assert.equal(created.execution_allowed,false);
 assert.equal(created.provenance_verified,false);
 assert.equal(created.github_run_id,null);
 assert.equal((await create(normalized)).status,200);
 assert.equal(store.events.length,1);
 const read=await handle(new Request('https://worker.invalid/v1/full/handoffs/'+ID,{headers:auth}),env,{fullHandoffStore:store,store:{}});
 assert.equal((await read.json()).manifest_sha256,await digestHandoff(normalized));
 assert.equal((await create({...normalized,prompt_sha256:'f'.repeat(64)})).status,409);
 const denyPaid=await handle(new Request('https://worker.invalid/v1/full/handoffs/'+ID+'/dispatch',{method:'POST',headers:auth}),env,{fullHandoffStore:store,store:{}});
 assert.equal(denyPaid.status,404);
 const wrongV1=await handle(new Request('https://worker.invalid/v1/tasks',{method:'POST',headers:auth,
  body:JSON.stringify(normalized)}),env,{fullHandoffStore:store,store:{}});
 assert.equal(wrongV1.status,400);
});
