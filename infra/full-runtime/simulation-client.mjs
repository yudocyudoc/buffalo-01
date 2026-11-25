// Test client uses the same upstream converter and simulator as AgentEvalRunner.
import SDJsonToXMILE from '../../utilities/SDJsonToXMILE.js';
import PySDSimulator from '../../evals/utilities/simulator/PySDSimulator.js';
export function createSimulationClient(){
 const runs=new Map();
 return {
  runs,
  async request(message,model){
   switch(message.type){
    case 'run_model':{
     const id='run-'+(runs.size+1);
     try{
      const xmile=SDJsonToXMILE(structuredClone(model),{modelName:'buffalo-client'});
      const names=model.variables.map(v=>v.name.replace(/\s+/g,'_'));
      const data=await new PySDSimulator(xmile).simulate(names);
      if(!Array.isArray(data.time)||!data.time.length||!data.time.every(Number.isFinite))throw Error('missing finite time series');
      runs.set(id,{data});return {runId:id,simulated:true};
     }catch(e){
      const error=String(e.message??e).split('Parse tree:')[0].slice(0,600);
      runs.set(id,{error});return {runId:id,simulated:false,error};
     }
    }
    case 'get_run_info':
     return {runs:[...runs].map(([id,r])=>({id,name:id,variables:Object.keys(r.data??{}).filter(k=>k!=='time')}))};
    case 'get_variable_data':{
     const result={};
     for(const id of message.runIds??[]){
      const run=runs.get(id);if(!run)continue;
      if(run.error){result[id]={error:run.error};continue}
      const data=run.data,n=message.detailed?200:50,time=data.time;
      const indices=time.length>n?Array.from({length:n},(_,i)=>Math.round(i*(time.length-1)/(n-1))):time.map((_,i)=>i);
      result[id]={time:indices.map(i=>time[i])};
      for(const name of message.variableNames??[])if(Array.isArray(data[name]))result[id][name]=indices.map(i=>data[name][i]);
     }
     return result;
    }
    default:throw Error('UNSUPPORTED_SIMULATION_REQUEST');
   }
  }
 };
}
