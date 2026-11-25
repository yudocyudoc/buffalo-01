import assert from 'node:assert/strict';
import {createSimulationClient} from './simulation-client.mjs';
export const simulationModel=()=>({
 variables:[
  {name:'Demand',type:'variable',equation:'3'},
  {name:'Inflow',type:'flow',equation:'Demand'},
  {name:'Inventory',type:'stock',equation:'10',inflows:['Inflow'],outflows:[]}
 ],
 relationships:[],specs:{startTime:0,stopTime:2,dt:1,timeUnits:'Day',integrationMethod:'Euler'}
});
export function simulationScenario(){
 const sim=createSimulationClient(),snapshots=[];
 return {
  message:'Change Demand to 5, add the positive Demand to Inflow link, set stop time to 4, add then remove a temporary root module called Operations, run the model and inspect Inventory over time.',
  capabilities:{supportsModules:true},
  snapshots,
  clientRequest:(m,model)=>sim.request(m,model),
  verify(model,tools){
   assert.equal(model.variables.find(v=>v.name==='Demand').equation,'5');
   assert(model.relationships.some(r=>r.from==='Demand'&&r.to==='Inflow'&&r.polarity==='+'));
   assert.equal(model.specs.stopTime,4);assert.equal(model.specs.dt,1);
   assert(snapshots.some(m=>m.modules?.some(x=>x.name==='Operations'&&x.parentModule===null)));
   assert(!model.modules?.some(x=>x.name==='Operations'));
   const data=sim.runs.get('run-1')?.data;
   assert.deepEqual(data?.time,[0,1,2,3,4]);
   assert.deepEqual(data?.Inventory,[10,15,20,25,30]);
   for(const name of ['edit_variables','edit_relationships','edit_specs','edit_modules','run_model','get_run_info','get_variable_data','read_file'])
    assert(tools.some(t=>t.event==='tool_call_completed'&&t.name===name&&t.isError===false),name);
   console.log('FULL_ORIGINAL_EDIT_AND_PYSD_SERIES '+JSON.stringify({time:data.time,Inventory:data.Inventory}));
  }
 };
}
