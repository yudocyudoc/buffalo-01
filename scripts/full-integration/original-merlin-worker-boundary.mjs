/**
 * Stage 3B-8/P. ONE original AgentWorker via ORIGINAL WorkerSpawner on Linux
 * bubblewrap. Deliberately unregistered provider: the real orchestrator must
 * end with CONVERSATION_ERROR; it must NOT run an LLM or simulation.
 *
 * This is an offline PROCESS probe, NOT an end-to-end Worker/Container/WS run.
 * It does not change the original Buffalo classes or agent configuration.
 */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {WorkerSpawner,IpcWorker} from '../../agent/WorkerSpawner.js';
import credentialProxy from '../../agent/utilities/CredentialProxy.js';
import {shutdownOriginalWorker} from './original-merlin-shutdown.mjs';
import {AgentConfigurationManager} from '../../agent/utilities/AgentConfigurationManager.js';
import {groups} from '../../evals/categories/policyImplementation.js';

export const PROCESS_SCHEMA='BUFFALO_STAGE3B8_ORIGINAL_MERLIN_PROCESS_OFFLINE_V1';
export const DENIED_PROVIDER='buffalo_stage3_provider_denied';
const PINNED_MODEL_SHA='57fed6310be45c10c263aecb796eeb72f993b318c5bc770013ff35e014cb4f39';
const BLOCKED_KEYS=[
 'BUFFALO_PAID_RUN','CLOUDFLARE_API_TOKEN','ANTHROPIC_API_KEY',
 'OPENAI_API_KEY','GEMINI_API_KEY','GOOGLE_API_KEY','OPEN_ROUTER_API_KEY',
 'OPENROUTER_API_KEY','DEEPSEEK_API_KEY','DEEPSEEK_TOKEN',
 'GITHUB_SOURCE_READ_TOKEN','GITHUB_FINE_GRAINED_TOKEN',
];
const hash=value=>createHash('sha256').update(value).digest('hex');

/** Pure preflight: tests can verify dangerous configurations without spawning. */
export function assertProcessProbeEnvironment({platform=process.platform,
 env=process.env,commit,bwrapAvailable}={}){
 if(platform!=='linux')throw Error('3B8_SANDBOX_NOT_AVAILABLE_LINUX_REQUIRED');
 if(!bwrapAvailable)throw Error('3B8_SANDBOX_NOT_AVAILABLE_BWRAP_REQUIRED');
 if(env.ALLOW_UNSANDBOXED_FALLBACK==='true')
  throw Error('3B8_UNSANDBOXED_FALLBACK_FORBIDDEN');
 if(BLOCKED_KEYS.some(key=>Boolean(env[key])))
  throw Error('3B8_PROVIDER_OR_PAID_SECRET_PRESENT');
 if(!/^[a-f0-9]{40}$/.test(commit??'')||
     !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA??'')||
     commit!==env.GITHUB_SHA)
  throw Error('3B8_CHECKOUT_COMMIT_IDENTITY_REQUIRED');
 return true;
}

export function originalCase(){
 const scenarios=[...new Set(groups.policyImplementation.map(x=>x.expectations?.scenario))];
 assert.equal(scenarios[0],'dialysisClinic','3B8_ORIGINAL_CASE_DRIFT');
 const same=groups.policyImplementation.filter(x=>x.expectations?.scenario===scenarios[0]);
 assert.equal(same.length,3,'3B8_ORIGINAL_CASE_FAMILY_DRIFT');
 assert(same.every(x=>x.heldOut===false));
 const model=structuredClone(same[0].currentModel);
 assert(same.every(x=>JSON.stringify(x.currentModel)===JSON.stringify(model)),
  '3B8_ORIGINAL_CASE_MODELS_DIFFER');
 assert.equal(hash(JSON.stringify(model)),PINNED_MODEL_SHA,'3B8_INITIAL_MODEL_DRIFT');
 const configuration=new AgentConfigurationManager({
  path:resolve('agent/config/merlin.md')});
 assert.equal(configuration.getAgentName(),'merlin');
 assert.equal(configuration.getAgentMode(),'sdk');
 return {model,scenario:scenarios[0],configSha:hash(readFileSync(resolve('agent/config/merlin.md')))};
}
function waitFor(worker,predicate,timeout=10000){
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{cleanup();reject(Error('3B8_REAL_WORKER_IPC_TIMEOUT'))},timeout);
  const onMessage=m=>{if(predicate(m)){cleanup();resolve(m)}};
  const onExit=()=>{cleanup();reject(Error('3B8_REAL_WORKER_EXITED_EARLY'))};
  const cleanup=()=>{clearTimeout(timer);worker.off('message',onMessage);worker.off('exit',onExit)};
  worker.on('message',onMessage);worker.once('exit',onExit);
 });
}
async function stopWorker(worker){
 if(!worker)return false;
 const exited=new Promise(resolve=>worker.once('exit',()=>resolve(true)));
 worker.kill('SIGKILL');
 return await Promise.race([exited,new Promise(resolve=>setTimeout(()=>resolve(false),5000))]);
}

export async function originalMerlinProcessProbe({commit}={}){
 const bwrap=spawnSync('bwrap',['--version'],{encoding:'utf8',timeout:3000});
 assertProcessProbeEnvironment({commit,bwrapAvailable:bwrap.status===0});
 const original=originalCase();
 const sessionId=randomUUID();
 const root=mkdtempSync(join(tmpdir(),'buffalo-3b8-offline-'));
 const sessionPath=join(root,'session');
 let worker,childExit=false;
 const messages=[],workerErrors=[];
 let modelRequests=0;
 try{
  // The original spawner is NOT monkey-patched or replaced. If bwrap cannot
  // create a sandbox, it must refuse. A fork is not an acceptable substitute.
  worker=await WorkerSpawner.spawn(sessionId,sessionPath);
  assert(worker instanceof IpcWorker,'3B8_UNSANDBOXED_WORKER_FORBIDDEN');
  worker.on('message',m=>{
   messages.push(m);
   if(m.type==='worker_error')workerErrors.push(m.error);
   if(m.type==='to_client'&&m.message?.type==='get_current_model'){
    modelRequests++;
    worker.send({type:'tool_response',callId:m.message.requestId,
     result:structuredClone(original.model),isError:false});
   }
  });
  worker.send({type:'initialize',mode:'sfd',model:structuredClone(original.model),
   tools:[],context:{},clientId:'buffalo-worker-'+sessionId,
   conversationHistory:[],attachedFiles:[],supportsArrays:true,
   supportsModules:false,supportsSubTypes:false,supportsMedia:false});
  // FIFO IPC barrier from the REAL AgentWorker, not a fabricated agent event.
  const initId=randomUUID();
  const initialized=waitFor(worker,m=>m.type==='context_response'&&m.requestId===initId);
  worker.send({type:'get_context',requestId:initId});
  assert.deepEqual((await initialized).context,[]);
  assert.deepEqual(workerErrors,[],'3B8_WORKER_INIT_ERROR');
  worker.send({type:'select_agent',agentId:'merlin',provider:DENIED_PROVIDER});
  const selectId=randomUUID();
  const selected=waitFor(worker,m=>m.type==='context_response'&&m.requestId===selectId);
  worker.send({type:'get_context',requestId:selectId});
  assert.deepEqual((await selected).context,[]);
  assert.deepEqual(workerErrors,[],'3B8_WORKER_SELECTION_ERROR');

  const requestText='Describe the names of the stocks in the initial model; do not edit or simulate.';
  const finished=waitFor(worker,m=>m.type==='to_client'&&
    m.message?.type==='agent_complete',15000);
  worker.send({type:'chat',message:requestText});
  const completion=(await finished).message;
  // It must be an authentic rejection from the ORIGINAL orchestrator.
  const errors=messages.filter(m=>m.type==='to_client'&&m.message?.type==='error')
    .map(m=>m.message);
  assert.equal(errors.length,1,'3B8_EXPECTED_SINGLE_REAL_REJECTION');
  assert.equal(errors[0].errorCode,'CONVERSATION_ERROR');
  assert.match(errors[0].error,new RegExp('Unknown combination: provider='+DENIED_PROVIDER));
  assert.equal(completion.status,'awaiting_user');
  assert.equal(modelRequests,1,'3B8_EXPECTED_REAL_CURRENT_MODEL_SYNC');
  assert.deepEqual(workerErrors,[],'3B8_REAL_WORKER_ERROR');
  const forbidden=messages.filter(m=>m.type==='to_client'&&
    !['get_current_model','error','agent_complete'].includes(m.message?.type));
  assert.equal(forbidden.length,0,'3B8_UNEXPECTED_MODEL_OR_TOOL_OUTPUT');
  const persisted=join(sessionPath,'model.sdjson');
  assert(existsSync(persisted),'3B8_ORIGINAL_WORKER_MODEL_FILE_MISSING');
  assert.equal(hash(JSON.stringify(JSON.parse(readFileSync(persisted,'utf8')))),
   PINNED_MODEL_SHA,'3B8_ORIGINAL_MODEL_MUTATED');
  const shutdown=await shutdownOriginalWorker(worker);
  childExit=true;
  worker=null;
  assert.deepEqual(workerErrors,[],'3B8_WORKER_SHUTDOWN_ERROR');
  return Object.freeze({schema:PROCESS_SCHEMA,
   status:'ORIGINAL_MERLIN_WORKER_OFFLINE_PROVIDER_DENIED_PASS',
   checkout_commit:commit,agent:'merlin',agent_config_sha256:original.configSha,
   scenario:original.scenario,initial_model_sha256:PINNED_MODEL_SHA,
   original_worker_spawner:true,original_agent_worker:true,
   bwrap_ipc_worker:true,ipc_barriers:2,model_sync_requests:modelRequests,
   genuine_terminal_error:'CONVERSATION_ERROR',terminal_status:completion.status,
   worker_exited:true,...shutdown,provider:'UNREGISTERED_DENY_ONLY',
   provider_requests_measured:false,agent_model_response:false,
   model_modified:false,simulation_executed:false,grader_executed:false,
   bridge_or_container_deployed:false,execution_allowed:false});
 }finally{
  if(worker){try{childExit=await stopWorker(worker)}catch{}}
  await credentialProxy.stop();
  rmSync(root,{recursive:true,force:true});
 }
}
function cli(argv){
 if(argv.length!==2||argv[0]!=='--commit'||
    !/^[a-f0-9]{40}$/.test(argv[1]??''))throw Error('3B8_CLI_COMMIT_REQUIRED');
 return argv[1];
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const evidence=await originalMerlinProcessProbe({commit:cli(process.argv.slice(2))});
  console.log('BUFFALO_3B8_PROCESS_EVIDENCE='+JSON.stringify(evidence));}
 catch(e){console.error('BUFFALO_3B8_PROCESS_FAILURE',e?.message??String(e));process.exitCode=1;}
}
