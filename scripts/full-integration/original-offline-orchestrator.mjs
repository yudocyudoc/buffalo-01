/**
 * Stage 3A: invoke the ORIGINAL Buffalo session + orchestrator in a one-case,
 * no-provider sandbox. This is a boundary/handshake probe, NOT an agent run.
 *
 * No edited agents, no model generation, no PySD, no gradings or paid workflows.
 * The actual startConversation is entered with a deliberately unregistered
 * provider id; it MUST emit an original CONVERSATION_ERROR / awaiting_user.
 * The original get_current_model handshake is serviced by an in-memory client.
 */
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {inspectOriginalSources} from './original-gate.mjs';
import {buildHandoff} from './prepare-handoff.mjs';
import {AgentOrchestrator} from '../../agent/AgentOrchestrator.js';
import {AgentConfigurationManager} from '../../agent/utilities/AgentConfigurationManager.js';
import {SessionManager} from '../../agent/utilities/SessionManager.js';
import {groups} from '../../evals/categories/policyImplementation.js';

export const STAGE3_SCHEMA='BUFFALO_ORIGINAL_ORCHESTRATOR_OFFLINE_PREP_V1';
export const OFFLINE_PROVIDER='buffalo_stage3_provider_denied';
const hash=v=>createHash('sha256').update(v).digest('hex');
const check=(test,code)=>{if(!test)throw Error('STAGE3_FAIL_'+code)};
const BLOCKED_SECRET_NAMES=[
 'BUFFALO_PAID_RUN','CLOUDFLARE_API_TOKEN','ANTHROPIC_API_KEY','GEMINI_API_KEY',
 'OPENAI_API_KEY','OPEN_ROUTER_API_KEY','GITHUB_FINE_GRAINED_TOKEN',
 'GITHUB_SOURCE_READ_TOKEN'
];

export async function originalOfflineProbe({agent='merlin',case_index=0,commit_sha,
 handoff_id=randomUUID(),timeLimitMs=5000}={}){
 const guard=globalThis.__BUFFALO_STAGE3_EGRESS__;
 check(guard?.mode==='BLOCK_ALL_NODE_STANDARD_EGRESS_AND_SUBPROCESSES','EGRESS_GUARD_REQUIRED');
 check(BLOCKED_SECRET_NAMES.every(key=>!process.env[key]),'ENV_SECRET_OR_PAID_CONSENT_PRESENT');
 check(/^[a-f0-9]{40}$/.test(commit_sha??''),'COMMIT_REQUIRED');
 check(!process.env.GITHUB_SHA||process.env.GITHUB_SHA.toLowerCase()===commit_sha,'CHECKOUT_COMMIT_MISMATCH');
 check(Number.isSafeInteger(case_index)&&case_index>=0&&case_index<=999,'BAD_CASE_INDEX');
 check(typeof timeLimitMs==='number'&&timeLimitMs>=500&&timeLimitMs<=10000,'INVALID_TIMEOUT');
 const source=inspectOriginalSources();
 check(source?.status==='PASS'&&source?.mode==='SOURCE_READ_ONLY','SOURCE_GATE_FAILED');
 const entry=source.agents?.find(x=>x.id===agent);
 check(entry&&['merlin','socrates','themis','athena_SFD'].includes(agent),'ORIGINAL_AGENT_MISSING');
 const handoff=await buildHandoff({
  handoff_id,agent,case_index,commit_sha,groups,sourceManifest:source
 });
 const cases=[...new Set(groups.policyImplementation.map(t=>t.expectations.scenario))];
 const chosen=cases[case_index];
 const baseline=groups.policyImplementation.find(t=>t.expectations.scenario===chosen);
 check(chosen&&chosen===handoff.manifest.scenario_id&&baseline,'CASE_DRIFT');
 const model=structuredClone(baseline.currentModel);
 const initialModelSha=hash(JSON.stringify(model));
 check(initialModelSha===handoff.manifest.initial_model_sha256,'INITIAL_MODEL_SHA_DRIFT');
 const agentMarkdown=readFileSync(resolve(entry.config),'utf8');
 const configuration=new AgentConfigurationManager({markdownContent:agentMarkdown});
 check(configuration.getAgentName()===agent.replace('_SFD','').toLowerCase(),'CONFIG_NAME_MISMATCH');
 const originalPrompt=configuration.buildSystemPrompt('sfd');
 check(originalPrompt.length>200,'SYSTEM_PROMPT_MISSING');
 const initialSystemPromptSha=hash(originalPrompt);
 const temp=mkdtempSync(join(tmpdir(),'buffalo-original-offline-'));
 const received=[],pendingErrors=[];
 let manager,orchestrator,sessionId, syncReplies=0;
 const sendToClient=async message=>{
  received.push(message);
  if(message.type==='get_current_model'){
   // Mimic only the original client's model-response protocol, no text/model generation.
   setImmediate(()=>{
    const pending=manager?.getSession(sessionId)?.pendingModelRequests?.get(message.requestId);
    if(!pending){pendingErrors.push('PENDING_MODEL_REQUEST_MISSING');return;}
    clearTimeout(pending.timeout);
    manager.getSession(sessionId).pendingModelRequests.delete(message.requestId);
    syncReplies++;
    pending.resolve(structuredClone(model));
   });
  }
 };
 try{
  manager=new SessionManager({disableCleanup:true,tempBasePath:temp});
  sessionId=manager.createSession({readyState:1,send(){}});
  manager.initializeSession(sessionId,'sfd',model,[],{
   supportsArrays:true,supportsModules:true,supportsSubTypes:false
  },'offline-original-eval-client');
  check(manager.getSession(sessionId)?.mode==='sfd','SESSION_MODE_INVALID');
  const preModelPath=join(manager.getSessionTempDir(sessionId),'model.sdjson');
  check(hash(JSON.stringify(JSON.parse(readFileSync(preModelPath,'utf8'))))===initialModelSha,
   'SESSION_PERSISTED_MODEL_DRIFT');
  // EXACT original class and config/tool providers; never a fake orchestrator.
  // Deliberately unsupported provider prevents any provider SDK preload.
  orchestrator=new AgentOrchestrator(manager,sessionId,sendToClient,
   {markdownContent:agentMarkdown},OFFLINE_PROVIDER);
  check(orchestrator.configManager.getAgentName()===configuration.getAgentName(),
   'ORCHESTRATOR_CONFIG_DRIFT');
  check(orchestrator.configManager.getAgentMode()===configuration.getAgentMode(),
   'ORCHESTRATOR_LOOP_MODE_DRIFT');
  const getCurrent=orchestrator.builtInToolProvider.getTools().tools.get_current_model;
  check(typeof getCurrent?.handler==='function','ORIGINAL_MODEL_TOOL_MISSING');
  const sync=await Promise.race([
   getCurrent.handler({}),
   new Promise((_,reject)=>{
    const t=setTimeout(()=>reject(Error('STAGE3_FAIL_MODEL_SYNC_TIMEOUT')),timeLimitMs);
    t.unref?.();
   })
  ]);
  check(sync?.isError===false,'ORIGINAL_CLIENT_MODEL_SYNC_FAILED');
  // Test the original routing failure, not an agent completion. All providers
  // are blocked before a model call; even a mistaken outbound attempt is caught.
  let timer;
  try{
   await Promise.race([orchestrator.startConversation(baseline.prompt),
    new Promise((_,reject)=>{timer=setTimeout(
     ()=>reject(Error('STAGE3_FAIL_ROUTER_TIMEOUT')),timeLimitMs)})]);
  }finally{clearTimeout(timer)}
  check(pendingErrors.length===0,'PENDING_MODEL_SYNC_FAILED');
  check(syncReplies===2,'ORIGINAL_CLIENT_HANDSHAKE_COUNT');
  const types=received.map(x=>x.type);
  check(types.filter(x=>x==='get_current_model').length===2,'ORIGINAL_MODEL_REQUESTS');
  const errs=received.filter(x=>x.type==='error');
  check(errs.length===1&&errs[0].errorCode==='CONVERSATION_ERROR'&&
   String(errs[0].error).includes('Unknown combination: provider='+OFFLINE_PROVIDER),
   'PROVIDER_REJECTION_MISSING');
  const completed=received.filter(x=>x.type==='agent_complete');
  check(completed.length===1&&completed[0].status==='awaiting_user',
   'ORIGINAL_ROUTER_TERMINAL_MISSING');
  check(types.every(x=>['get_current_model','error','agent_complete'].includes(x)),
   'UNEXPECTED_TOOL_OR_AGENT_ACTIVITY');
  check(hash(JSON.stringify(manager.getClientModel(sessionId)))===initialModelSha,
   'CLIENT_MODEL_CHANGED');
  check(hash(JSON.stringify(JSON.parse(readFileSync(preModelPath,'utf8'))))===initialModelSha,
   'PERSISTED_MODEL_CHANGED');
  check(guard.count()===0,'OUTBOUND_OR_CHILD_PROCESS_ATTEMPTED');
  return Object.freeze({
   schema:STAGE3_SCHEMA,
   source:'ORIGINAL_BUFFALO_SESSION_AND_ORCHESTRATOR',
   case_source:'ORIGINAL_POLICY_IMPLEMENTATION_DEVELOPMENT',
   status:'OFFLINE_BOUNDARY_PASS_NO_AGENT_OUTPUT',
   handoff_id:handoff.manifest.handoff_id,
   manifest_sha256:handoff.manifest_sha256,
   commit_sha:handoff.manifest.commit_sha,
   source_sha256:handoff.manifest.source_sha256,
   agent:handoff.manifest.agent,
   original_agent_mode:configuration.getAgentMode(),
   benchmark:handoff.manifest.benchmark,
   scenario_id:handoff.manifest.scenario_id,
   case_index,
   prompt_sha256:handoff.manifest.prompt_sha256,
   initial_model_sha256:initialModelSha,
   original_system_prompt_sha256:initialSystemPromptSha,
   session_initialized:true,
   original_tool_model_sync_requests:2,
   original_tool_model_sync_responses:syncReplies,
   rejected_provider:OFFLINE_PROVIDER,
   terminal_error_code:'CONVERSATION_ERROR',
   terminal_status:'awaiting_user',
   agent_turn_executed:false,
   grader_executed:false,
   simulation_executed:false,
   output_model_generated:false,
   network_attempts:guard.count(),
   provider_requests:0,
   child_process_attempts:0,
   external_run_id:null,
   github_provenance_attested:false,
   execution_allowed:false
  });
 }finally{
  try{orchestrator?.destroy()}catch{}
  try{if(sessionId)manager?.deleteSession(sessionId)}catch{}
  rmSync(temp,{recursive:true,force:true});
 }
}
function args(argv){
 const options={};
 for(let i=0;i<argv.length;i+=2){
  const key=argv[i],value=argv[i+1];
  check(['--agent','--case-index','--commit','--handoff-id'].includes(key)&&
   typeof value==='string'&&!(key in options),'BAD_ARGUMENTS');
  options[key]=value;
 }
 check(Object.keys(options).length===4,'MISSING_ARGUMENTS');
 check(/^(0|[1-9][0-9]{0,2})$/.test(options['--case-index']),'BAD_CASE_INDEX');
 return {agent:options['--agent'],case_index:Number(options['--case-index']),
  commit_sha:options['--commit'],handoff_id:options['--handoff-id']};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const record=await originalOfflineProbe(args(process.argv.slice(2)));
  console.log('BUFFALO_ORIGINAL_OFFLINE_EVIDENCE='+JSON.stringify(record));
 }catch(e){console.error('STAGE3_FAILED:',String(e?.message??e));process.exitCode=1;}
}
