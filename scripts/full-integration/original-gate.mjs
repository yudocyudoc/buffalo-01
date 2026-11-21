/**
 * Buffalo Full source-preservation gate, stage 1.
 *
 * This module deliberately NEVER imports the original agent, its SDKs, engines,
 * evaluator or simulator. Inspect only local, allowlisted source bytes.
 * Do NOT call providers, start sessions, launch Python, or read secrets.
 *
 * Usage: node scripts/full-integration/original-gate.mjs --check
 */
import {createHash} from 'node:crypto';
import {readFileSync, lstatSync} from 'node:fs';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ownPath=fileURLToPath(import.meta.url);
const DEFAULT_ROOT=resolve(dirname(ownPath),'../..');
export const ORIGINAL_AGENTS=Object.freeze([
  Object.freeze({id:'merlin',displayName:'Merlin',file:'agent/config/merlin.md'}),
  Object.freeze({id:'socrates',displayName:'Socrates',file:'agent/config/socrates.md'}),
  Object.freeze({id:'themis',displayName:'Themis',file:'agent/config/themis.md'}),
  Object.freeze({id:'athena_SFD',displayName:'Athena',file:'agent/config/athena_SFD.md'})
]);
export const ORIGINAL_FILES=Object.freeze([
  'agent/AgentOrchestrator.js',
  'agent/utilities/AgentEvalRunner.js',
  ...ORIGINAL_AGENTS.map(x=>x.file),
  'evals/categories/policyImplementation.js',
  'evals/utilities/simulator/PySDSimulator.js',
  'scripts/run-one-native-agent-case.mjs',
  '.github/workflows/paid-agent-case.yml'
].sort());

const sha256=v=>createHash('sha256').update(v).digest('hex');
function ensure(value,code){if(!value)throw Error('BUFFALO_ORIGINAL_GATE_'+code)}
function readSource(root,path){
  ensure(ORIGINAL_FILES.includes(path),'PATH_NOT_ALLOWLISTED');
  const filename=join(root,...path.split('/'));
  const stat=lstatSync(filename);
  ensure(stat.isFile()&&!stat.isSymbolicLink(),'NOT_REGULAR_FILE');
  ensure(stat.size>0&&stat.size<=256_000,'SOURCE_SIZE_INVALID');
  return readFileSync(filename,'utf8');
}
function frontmatter(src){
  const match=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(src);
  ensure(Boolean(match),'FRONTMATTER_MISSING');
  return match[1];
}
function sourceIncludes(src,sentinel,code){ensure(src.includes(sentinel),code)}
export function inspectOriginalSources(root=DEFAULT_ROOT){
  ensure(typeof root==='string'&&root.length>0,'INVALID_ROOT');
  const entries=ORIGINAL_FILES.map(path=>{
    const content=readSource(root,path);
    return {path,content,sha256:sha256(content)};
  });
  const source=Object.fromEntries(entries.map(({path,content})=>[path,content]));
  for(const {id,displayName,file} of ORIGINAL_AGENTS){
    const header=frontmatter(source[file]);
    ensure(new RegExp('^name: "'+displayName+'"$', 'm').test(header),'AGENT_NAME_'+id);
    ensure(/^agent_mode:\s*(sdk|manual)$/m.test(header),'AGENT_MODE_'+id);
    ensure(/^max_iterations:\s*\d+$/m.test(header),'AGENT_ITERATIONS_'+id);
    ensure(/^supported_modes:\s*\r?\n\s+- sfd$/m.test(header),'AGENT_SFD_'+id);
  }
  const runner=source['scripts/run-one-native-agent-case.mjs'];
  const advertised=/const supportedAgents = new Set\(\[([^\]]+)\]\)/.exec(runner);
  ensure(Boolean(advertised),'RUNNER_AGENT_ALLOWLIST_MISSING');
  const agents=[...advertised[1].matchAll(/'([^']+)'/g)].map(match=>match[1]).sort();
  ensure(agents.length===ORIGINAL_AGENTS.length&&
    agents.every((x,i)=>x===ORIGINAL_AGENTS.map(y=>y.id).sort()[i]),
    'RUNNER_AGENT_ALLOWLIST_DRIFT');
  sourceIncludes(runner,"from '../agent/utilities/AgentEvalRunner.js'",'RUNNER_EVAL_IMPORT');
  sourceIncludes(runner,"from '../evals/categories/policyImplementation.js'",'RUNNER_BENCHMARK_IMPORT');
  sourceIncludes(runner,"BUFFALO_PAID_RUN === 'I_ACCEPT_CLOUDFLARE_AI_COSTS'",'RUNNER_PAID_GATE');
  sourceIncludes(runner,"interruptedTransport(", 'RUNNER_INTERRUPTION_GATE');
  const evalRunner=source['agent/utilities/AgentEvalRunner.js'];
  sourceIncludes(evalRunner,'export async function runAgent(prompt, currentModel, parameters)','EVAL_RUNNER_EXPORT');
  sourceIncludes(evalRunner,"from '../AgentOrchestrator.js'",'EVAL_RUNNER_ORCHESTRATOR');
  sourceIncludes(evalRunner,"from '../../evals/utilities/simulator/PySDSimulator.js'",'EVAL_RUNNER_PYSD');
  sourceIncludes(evalRunner,'const configPath = join(AGENT_CONFIG_DIR,', 'EVAL_RUNNER_CONFIG');
  const orchestrator=source['agent/AgentOrchestrator.js'];
  sourceIncludes(orchestrator,'export class AgentOrchestrator {','ORCHESTRATOR_EXPORT');
  const grader=source['evals/categories/policyImplementation.js'];
  sourceIncludes(grader,'export const groups = splitHeldOut(', 'BENCHMARK_GROUPS');
  sourceIncludes(grader,'export const evaluate = async function(', 'BENCHMARK_EVALUATE');
  for(const criterion of ['meetsGoal','intact','sensible'])
    sourceIncludes(grader,"criterion: '"+criterion+"'",'BENCHMARK_CRITERION_'+criterion.toUpperCase());
  sourceIncludes(source['evals/utilities/simulator/PySDSimulator.js'],
    'export default PySDSimulator;', 'PYSD_EXPORT');
  const paid=source['.github/workflows/paid-agent-case.yml'];
  sourceIncludes(paid,"I_ACCEPT_CLOUDFLARE_AI_COSTS", 'PAID_WORKFLOW_CONSENT');
  sourceIncludes(paid,"BUFFALO_AGENT: \${{ inputs.agent }}", 'PAID_WORKFLOW_AGENT_INPUT');
  sourceIncludes(paid,"run: node --import ./scripts/cloudflare/bootstrap.mjs scripts/run-one-native-agent-case.mjs",
    'PAID_WORKFLOW_ORIGINAL_RUNNER');

  const components=entries.map(({path,sha256})=>({path,sha256}));
  return Object.freeze({
    schema:'BUFFALO_ORIGINAL_SOURCE_PREFLIGHT_V1',
    mode:'SOURCE_READ_ONLY',
    status:'PASS',
    agents:ORIGINAL_AGENTS.map(({id,displayName,file})=>({id,name:displayName,config:file})),
    orchestration:'agent/AgentOrchestrator.js',
    evaluation_runner:'agent/utilities/AgentEvalRunner.js',
    benchmark:'evals/categories/policyImplementation.js',
    simulator:'evals/utilities/simulator/PySDSimulator.js',
    paid_workflow_unchanged_by_gate:true,
    // Unsigned transport fingerprint, not a proof of an executed benchmark.
    source_sha256:sha256(JSON.stringify(components)),
    components
  });
}
if(process.argv[1]&&resolve(process.argv[1])===ownPath){
  if(process.argv.length!==3||process.argv[2]!=='--check'){
    console.error('BUFFALO_ORIGINAL_GATE_USAGE: --check');
    process.exitCode=2;
  }else{
    try{console.log(JSON.stringify(inspectOriginalSources()))}
    catch(error){console.error(String(error?.message||'BUFFALO_ORIGINAL_GATE_UNKNOWN'));
      process.exitCode=1;}
  }
}
