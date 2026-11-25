// Evaluate the exact model returned remotely; never rewrite its equations.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {LLMWrapper} from '../../utilities/LLMWrapper.js';
import {createSimulationClient} from './simulation-client.mjs';
import {PASS,validInference} from './remote-quantitative.mjs';
const folder=process.env.RUNNER_TEMP+'/buffalo-full-quantitative';
const receipt=JSON.parse(readFileSync(folder+'/remote-receipt.json'));
assert.equal(receipt.status,PASS);assert(receipt.container_stopped&&receipt.single_reservation&&validInference(receipt.inference));
const schema=LLMWrapper.prototype.generateQuantitativeSDJSONResponseSchema(false,false,false,false).toJSONSchema();
const expectedSchemaHash=createHash('sha256').update(JSON.stringify(schema)).digest('hex');
assert.equal(receipt.inference.schema_sha256,expectedSchemaHash,'EXACT_ORIGINAL_SCHEMA_HASH');
const model=receipt.model;
for(const [name,type] of [['Inventory','stock'],['Inflow','flow'],['Demand','variable']])
 assert(model.variables.some(v=>v.name===name&&v.type===type),'MISSING_'+name);
const client=createSimulationClient();
const run=await client.request({type:'run_model'},model);
assert.equal(run.simulated,true,run.error);
const data=client.runs.get(run.runId).data;
assert.deepEqual(data.time,[0,1,2,3,4]);assert.deepEqual(data.Inventory,[10,15,20,25,30]);
assert.deepEqual(data.Demand,[5,5,5,5,5]);assert.deepEqual(data.Inflow,[5,5,5,5,5]);
const outcome={status:'FULL_REMOTE_QUANTITATIVE_PYSD_PASS',schema_sha256:expectedSchemaHash,
 time:data.time,Inventory:data.Inventory,Demand:data.Demand,Inflow:data.Inflow,
 model_sha256:createHash('sha256').update(JSON.stringify(model)).digest('hex'),
 simulation_location:'github-runner-original-pysd',remote_provider:receipt.inference.response_model};
writeFileSync(folder+'/simulation.json',JSON.stringify(outcome,null,2)+'\n');
console.log(JSON.stringify(outcome));
