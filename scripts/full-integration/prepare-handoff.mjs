/**
 * Build one non-executable handoff from the ORIGINAL development benchmark.
 * Loading groups does not call evaluate(), runAgent(), PySD or a provider.
 */
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectOriginalSources} from './original-gate.mjs';
import {HANDOFF_KIND,HANDOFF_SCHEMA,normalizeHandoff,digestHandoff} from './handoff-contract.mjs';

const sha=v=>createHash('sha256').update(v).digest('hex');
function ensure(v,code){if(!v)throw Error('FULL_HANDOFF_PREPARE_'+code)}
export async function buildHandoff({handoff_id,agent,case_index,commit_sha,groups,sourceManifest}){
 ensure(sourceManifest?.status==='PASS'&&sourceManifest?.mode==='SOURCE_READ_ONLY','SOURCE_GATE_NOT_PASSED');
 ensure(Array.isArray(groups?.policyImplementation),'DEVELOPMENT_GROUP_MISSING');
 const tests=groups.policyImplementation;
 const ids=[...new Set(tests.map(t=>t.expectations?.scenario))];
 ensure(ids.every(x=>typeof x==='string'),'SCENARIO_ID_MISSING');
 ensure(Number.isSafeInteger(case_index)&&case_index>=0&&case_index<ids.length,
  'CASE_INDEX_OUT_OF_BOUNDS');
 const scenario_id=ids[case_index];
 const siblings=tests.filter(t=>t.expectations?.scenario===scenario_id);
 const baseline=siblings[0];
 ensure(siblings.length===3,'CRITERIA_MISSING');
 ensure([...siblings.map(x=>x.expectations.criterion)].sort().join(',')===
  'intact,meetsGoal,sensible','CRITERIA_DRIFT');
 ensure(siblings.every(x=>x.heldOut===false),'HELD_OUT_NOT_ALLOWED');
 const prompt=baseline.prompt,initialModel=baseline.currentModel;
 ensure(typeof prompt==='string'&&prompt.length>0,'PROMPT_MISSING');
 ensure(initialModel&&Array.isArray(initialModel.variables)&&
  Array.isArray(initialModel.relationships),'INITIAL_MODEL_MISSING');
 const baselineParameters=baseline.additionalParameters;
 ensure(baselineParameters?.mode==='sfd','MODE_DRIFT');
 ensure(siblings.every(x=>x.prompt===prompt&&
  JSON.stringify(x.currentModel)===JSON.stringify(initialModel)&&
  JSON.stringify(x.additionalParameters)===JSON.stringify(baselineParameters)),
  'SIBLING_BASELINE_DRIFT');
 const config=sourceManifest.agents?.find(x=>x.id===agent);
 ensure(config,'AGENT_NOT_IN_SOURCE_GATE');
 const sourceComponent=sourceManifest.components?.find(x=>x.path===config.config);
 ensure(sourceComponent,'AGENT_COMPONENT_MISSING');
 const parameters={...baselineParameters,agentName:agent,mode:'sfd'};
 const manifest=normalizeHandoff({
  schema_version:HANDOFF_SCHEMA,handoff_id,kind:HANDOFF_KIND,agent,
  benchmark:'policyImplementation',scenario_id,case_index,mode:'sfd',
  commit_sha,source_sha256:sourceManifest.source_sha256,
  agent_config_sha256:sourceComponent.sha256,
  prompt_sha256:sha(prompt),initial_model_sha256:sha(JSON.stringify(initialModel)),
  parameters_sha256:sha(JSON.stringify(parameters))
 });
 return {manifest,manifest_sha256:await digestHandoff(manifest),source:'BENCHMARK_DEV_METADATA_ONLY',
  execution:'NOT_EXECUTED',provenance:'DECLARED_UNVERIFIED'};
}
function parseArgs(argv){
 const args={};
 for(let i=0;i<argv.length;i+=2){
  ensure(/^--(handoff-id|agent|case-index|commit)$/.test(argv[i])&&
   argv[i+1]!==undefined,'INVALID_ARGUMENTS');
  const key=argv[i].slice(2);ensure(!(key in args),'DUPLICATE_ARGUMENT');
  args[key]=argv[i+1];
 }
 ensure(Object.keys(args).length===4,'MISSING_ARGUMENT');
 ensure(/^(0|[1-9]\d{0,2})$/.test(args['case-index']),'INVALID_INDEX');
 return {handoff_id:args['handoff-id'],agent:args.agent,
  case_index:Number(args['case-index']),commit_sha:args.commit};
}
async function main(){
 const params=parseArgs(process.argv.slice(2));
 const sourceManifest=inspectOriginalSources();
 // Import ONLY the original benchmark metadata after all structural checks pass.
 // It may load local dependencies; it must never call evaluate or simulateModel.
 const {groups}=await import('../../evals/categories/policyImplementation.js');
 const candidate=await buildHandoff({...params,groups,sourceManifest});
 console.log(JSON.stringify(candidate));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await main()}catch(e){console.error(String(e?.message||'FULL_HANDOFF_PREPARE_FAILED'));process.exitCode=1}
}
