import assert from 'node:assert/strict';
import {LLMWrapper} from '../../utilities/LLMWrapper.js';
import {GEMMA} from '../private-merlin/gemma-response.mjs';
import {ENGINE_MAX_TOKENS} from './engine-protocol.mjs';
import {simulationModel} from './simulation-fixture.mjs';
import {createSimulationClient} from './simulation-client.mjs';

const prompt='Create a stock Inventory initially 10, fed by Inflow equal to Demand of 5 per Day. Simulate days 0 to 4 with Euler dt 1.';
export function quantitativeFixture(model,wire){
 assert.equal(model,GEMMA);
 assert.equal(wire.stream,false);
 assert.equal(wire.max_completion_tokens,ENGINE_MAX_TOKENS);
 assert.equal(wire.chat_template_kwargs.enable_thinking,false);
 assert.equal(wire.messages.at(-1).content,prompt);
 assert.equal(wire.response_format.type,'json_schema');
 const schema=LLMWrapper.prototype.generateQuantitativeSDJSONResponseSchema(false,false,false,false);
 assert.deepEqual(wire.response_format.json_schema,schema.toJSONSchema());
 const fixture=simulationModel();
 fixture.variables[0].equation='5';fixture.specs.stopTime=4;
 const generated={specs:fixture.specs,variables:fixture.variables.map(v=>({
   units:v.type==='stock'?'items':'items/Day',inflows:[],outflows:[],graphicalFunction:{points:[]},
   uniflow:v.type==='flow',documentation:'Offline provider fixture',...v
 })),relationships:[{from:'Demand',to:'Inflow',polarity:'+',reasoning:'Demand drives Inflow',
 polarityReasoning:'Higher Demand increases Inflow',delay:false}],title:'Inventory',explanation:'Constant inflow.'};
 assert(schema.safeParse(generated).success,'fixture must satisfy actual original Zod schema');
 return {model,usage:{prompt_tokens:500,completion_tokens:100,neurons:1.5},
   choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(generated)}}]};
}
export async function testOriginalEngine(base,key){
 const url=base+'/api/v1/engines/quantitative/generate';
 const post=(body,authentication)=>fetch(url,{method:'POST',
   headers:{'content-type':'application/json',...(authentication?{Authentication:authentication}:{})},
   body:JSON.stringify(body)});
 // The historical BYOK waiver must not spend the private project's binding.
 const denied=await post({prompt,openRouterKey:'arbitrary-client-key'});
 assert.equal(denied.status,403);await denied.body?.cancel();
 const response=await post({prompt},key);
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.success,true,result.message);
 assert.equal(result.supportingInfo.title,'Inventory');
 assert.deepEqual(result.model.variables.map(v=>[v.name,v.type,v.equation]),[
   ['Demand','variable','5'],['Inflow','flow','Demand'],['Inventory','stock','10']]);
 assert(result.model.relationships.some(r=>r.from==='Demand'&&r.to==='Inflow'&&r.polarity==='+'));
 const client=createSimulationClient();
 const run=await client.request({type:'run_model'},result.model);
 assert.equal(run.simulated,true,run.error);
 const data=client.runs.get(run.runId).data;
 assert.deepEqual(data.time,[0,1,2,3,4]);assert.deepEqual(data.Inventory,[10,15,20,25,30]);
 console.log('FULL_ORIGINAL_QUANTITATIVE_REST_AND_PYSD_OFFLINE '+JSON.stringify({time:data.time,Inventory:data.Inventory}));
 return result.model;
}
