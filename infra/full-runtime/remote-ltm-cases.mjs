// Same fixtures and clock settings as the passing controlled matrix.
import armsRace from '../../evals/categories/feedbackExplanationData/armsRace.json' with {type:'json'};
import bassDiffusion from '../../evals/categories/feedbackExplanationData/bassDiffusion.json' with {type:'json'};
import inventoryWorkforce from '../../evals/categories/feedbackExplanationData/inventoryWorkforce.json' with {type:'json'};
import predatorPrey from '../../evals/categories/feedbackExplanationData/predatorPrey.json' with {type:'json'};
import marketGrowth from '../../evals/categories/feedbackExplanationData/marketGrowth.json' with {type:'json'};
import maibab from '../../evals/categories/feedbackExplanationData/maibab.json' with {type:'json'};
const specs=[
 ['armsRace',armsRace,'Euler',.125,3],['bassDiffusion',bassDiffusion,'Euler',.0625,2],
 ['inventoryWorkforce',inventoryWorkforce,'RK4',.0625,3],['predatorPrey',predatorPrey,'RK4',1,5],
 ['marketGrowth',marketGrowth,'Euler',5,20],['maibab',maibab,'RK4',1,10],
 ['maibab-control',maibab,'RK4',.125,10],['maibab-perturbed',maibab,'RK4',.125,10]
];
export const CASES=specs.map(([name])=>name);
export const LIMIT=8;
export const PREFIX='one-shot-buffalo-native-ltm-v1-';
export const probeId=name=>PREFIX+name.toLowerCase();
export const projectId=name=>'buffalo-native-ltm-v1-'+name.toLowerCase();
export function fixture(name){
 const row=specs.find(x=>x[0]===name);if(!row)throw Error('UNKNOWN_LTM_CASE');
 const [,source,method,saveStep,expectedCycles]=row;
 const model=structuredClone(source.model);model.specs.integrationMethod=method;model.specs.saveStep=saveStep;
 if(name.startsWith('maibab-')){
  model.specs.stopTime=1812;
  const normal=model.variables.filter(v=>v.name==='Normal Food Per Deer');
  if(normal.length!==1||normal[0].equation!=='1')throw Error('UNEXPECTED_MAIBAB_BASELINE');
  if(name==='maibab-perturbed')normal[0].equation='100';
 }
 return {model,expectedCycles,expectedSamples:Math.round((model.specs.stopTime-model.specs.startTime)/saveStep)+1};
}
export function validGrant(g,now=Date.now()){
 return CASES.includes(g?.case_name)&&g.project===projectId(g.case_name)&&g.max_calls===LIMIT&&
 /^[a-f0-9]{40}$/.test(g.source_commit)&&/^sha256:[a-f0-9]{64}$/.test(g.image_digest)&&
 /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(g.run_id)&&
 Number.isSafeInteger(g.expires)&&g.expires>now&&g.expires-now<=22*60000;
}
