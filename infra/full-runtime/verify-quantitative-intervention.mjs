// Re-evaluate archived real synthetic evidence, then intervene on a clone only.
// This is an offline, post-hoc scientific test, not a provider invocation.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {verifyQuantitative} from './verify-remote-quantitative.mjs';
import {createSimulationClient} from './simulation-client.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const modelHash=m=>sha(JSON.stringify(m));
const root=new URL('./evidence/quantitative-45551954016/',import.meta.url);
const bytes=readFileSync(new URL('remote-receipt.json',root));
const cleanup=readFileSync(new URL('cleanup.json',root));
assert.equal(sha(bytes),'5da8e835794921082d9fa5560f3be135772d2153349c2533b45a3e2ea37b0696','ORIGINAL_RECEIPT_BYTES');
assert.equal(sha(cleanup),'13ad37de7af1a621217cf3e959f5eddcda4e26a719c99fefe1a2ef27f02d2170','ORIGINAL_CLEANUP_BYTES');
assert.equal(JSON.parse(cleanup).status,'ZERO_ACTIVE_AND_DISABLED_NO_AI_OR_SECRETS');
const receipt=JSON.parse(bytes);
assert.equal(receipt.fixture_only,undefined);
assert.equal(receipt.approval.source_commit,'381e22050e04918289ae9371fc7c17d5b1a89ee5');
assert.equal(receipt.approval.max_calls,1);
assert.equal(receipt.run_id,receipt.approval.run_id);
const base=receipt.model;
const parent=modelHash(base);
assert.equal(parent,'dfd7dc6e99848d67268d4ff5ebcc7898c9a7c909ba30aa1c14220ef1707ab2c4','ORIGINAL_MODEL_HASH');
const baseline=await verifyQuantitative(receipt);
assert.equal(baseline.evidence_source,'remote-receipt');

function edit(model,name,equation){
 const clone=structuredClone(model);
 const variable=clone.variables.find(v=>v.name===name);
 assert(variable);const before=variable.equation;variable.equation=equation;
 return {model:clone,change:{variable:name,field:'equation',before,after:equation}};
}
async function simulate(model){
 const before=modelHash(model);
 const client=createSimulationClient();
 const run=await client.request({type:'run_model'},model);
 assert.equal(run.simulated,true,run.error);
 const data=client.runs.get(run.runId).data;
 const {time,Inventory,Demand,Inflow}=data;
 assert.equal(modelHash(model),before,'MODEL_MUTATED');
 return {time,Inventory,Demand,Inflow};
}
function requireIntervention(series){
 assert.deepEqual(series.time,[0,1,2,3,4],'TIME');
 assert.deepEqual(series.Demand,[6,6,6,6,6],'DEMAND_RESPONSE');
 assert.deepEqual(series.Inflow,[6,6,6,6,6],'INFLOW_RESPONSE');
 assert.deepEqual(series.Inventory,[10,16,22,28,34],'INVENTORY_RESPONSE');
}
const derived=edit(base,'Demand','6');
const derivedHash=modelHash(derived.model);
assert.notEqual(derivedHash,parent);
const series=await simulate(derived.model);
requireIntervention(series);
const negative=edit(derived.model,'Inflow','5');
const negativeHash=modelHash(negative.model);
assert.notEqual(negativeHash,derivedHash);
const control=await simulate(negative.model);
// Ensure the negative control is an executable model, not a simulation error.
assert.deepEqual(control.time,[0,1,2,3,4]);
assert.deepEqual(control.Demand,[6,6,6,6,6]);
assert.deepEqual(control.Inflow,[5,5,5,5,5]);
assert.deepEqual(control.Inventory,[10,15,20,25,30]);
assert.throws(()=>requireIntervention(control),/INFLOW_RESPONSE/);
assert.equal(modelHash(base),parent,'PARENT_MUTATED');
assert.equal(sha(readFileSync(new URL('remote-receipt.json',root))),sha(bytes),'ARCHIVE_MUTATED');
console.log(JSON.stringify({
 status:'FULL_QUANTITATIVE_REAL_INTERVENTION_PASS',evidence_source:'archived-remote-receipt',
 acceptance_contract:'demand-intervention-v1',simulation_location:'github-runner-original-pysd',
 source_run:45551954016,source_artifact:14995035411,
 receipt_sha256:sha(bytes),schema_sha256:baseline.schema_sha256,
 settings:base.specs,
 baseline:{revision:'base',model_sha256:parent,time:baseline.time,Inventory:baseline.Inventory,Demand:baseline.Demand,Inflow:baseline.Inflow},
 intervention:{revision:'demand-6',parent_sha256:parent,model_sha256:derivedHash,change:derived.change,...series},
 negative_control:{revision:'hard-coded-inflow',parent_sha256:derivedHash,model_sha256:negativeHash,change:negative.change,expected_rejection:'INFLOW_RESPONSE',...control}
}));
