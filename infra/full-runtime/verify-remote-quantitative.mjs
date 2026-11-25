// Evaluate the exact model returned remotely; never rewrite its equations.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {LLMWrapper} from '../../utilities/LLMWrapper.js';
import {createSimulationClient} from './simulation-client.mjs';
import {PASS,validInference} from './remote-quantitative.mjs';

const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export async function verifyQuantitative(receipt){
 assert.equal(receipt.status,PASS);assert(receipt.container_stopped&&receipt.single_reservation&&validInference(receipt.inference));
 const schema=LLMWrapper.prototype.generateQuantitativeSDJSONResponseSchema(false,false,false,false).toJSONSchema();
 const expectedSchemaHash=hash(schema);
 assert.equal(receipt.inference.schema_sha256,expectedSchemaHash,'EXACT_ORIGINAL_SCHEMA_HASH');
 const model=receipt.model;
 // Bound the synthetic smoke to the requested tiny model before simulation.
 assert.equal(model.variables.length,3,'EXACT_THREE_VARIABLES');
 for(const [name,type] of [['Inventory','stock'],['Inflow','flow'],['Demand','variable']])
  assert(model.variables.some(v=>v.name===name&&v.type===type),'MISSING_'+name);
 const stock=model.variables.find(v=>v.name==='Inventory');
 assert.deepEqual(stock.inflows,['Inflow']);assert.deepEqual(stock.outflows??[],[]);
 assert.equal(model.specs?.startTime,0);assert.equal(model.specs?.stopTime,4);assert.equal(model.specs?.dt,1);
 assert.equal(model.specs?.integrationMethod?.toLowerCase(),'euler');
 assert.equal(model.specs?.timeUnits?.toLowerCase(),'day');
 assert.equal(model.modules?.length??0,0);
 const modelHash=hash(model);
 const client=createSimulationClient();
 const run=await client.request({type:'run_model'},model);
 assert.equal(run.simulated,true,run.error);
 const data=client.runs.get(run.runId).data;
 assert.deepEqual(data.time,[0,1,2,3,4]);assert.deepEqual(data.Inventory,[10,15,20,25,30]);
 assert.deepEqual(data.Demand,[5,5,5,5,5]);assert.deepEqual(data.Inflow,[5,5,5,5,5]);
 assert.equal(hash(model),modelHash,'MODEL_MUTATED');
 return {status:'FULL_REMOTE_QUANTITATIVE_PYSD_PASS',schema_sha256:expectedSchemaHash,
  time:data.time,Inventory:data.Inventory,Demand:data.Demand,Inflow:data.Inflow,model_sha256:modelHash,
  simulation_location:'github-runner-original-pysd',provider_model:receipt.inference.response_model,
  evidence_source:receipt.fixture_only===true?'controlled-provider-fixture':'remote-receipt'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const receipt=JSON.parse(readFileSync(process.argv[2],'utf8'));
 assert.equal(receipt.fixture_only===true,process.argv[3]==='--fixture','FIXTURE_MODE_MISMATCH');
 console.log(JSON.stringify(await verifyQuantitative(receipt)));
}
