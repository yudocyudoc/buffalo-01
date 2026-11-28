import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {LLMWrapper} from '../../utilities/LLMWrapper.js';
import {verifyQuantitative} from './verify-remote-quantitative.mjs';
import {PASS as SMOKE_MODEL_RETURNED} from './remote-quantitative.mjs';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {ENDPOINT} from '../private-merlin/protocol.mjs';
import {GEMMA} from '../private-merlin/gemma-response.mjs';
import {rest} from './test-rest.mjs';
import {session,assertDemand} from './test-session.mjs';
import {simulationModel,simulationScenario} from './simulation-fixture.mjs';
import {createSimulationClient} from './simulation-client.mjs';
import {ENGINE_ENDPOINT} from './engine-protocol.mjs';
import {quantitativeFixture,testOriginalEngine,testFailedOriginalEngine,agentPrompt} from './test-engine.mjs';
import {qualitativeFixture,exerciseQualitative,reopenQualitative} from './test-qualitative.mjs';
import {storePersistentRuns,recoverPersistentRuns} from './test-persistent-runs.mjs';
import {createConversationJournal,modelIdentity} from './conversation-client.mjs';
import {checkConversationBeforeRestart,checkConversationAfterRestart} from './test-persistent-conversations.mjs';
import {createSeldonFixture,exerciseSeldon} from './test-seldon-comparison.mjs';
import {createBassFixture,exerciseBassReference} from './test-seldon-bass-reference.mjs';
import {exerciseDocumentation} from './test-document-project-model.mjs';
import {seedNarrativeRuns, exerciseRunNarratives} from './test-run-narrative.mjs';

import {seedNativeLtm,reopenNativeLtm} from './test-native-ltm.mjs';
import {seedLtmMatrix,reopenLtmMatrix,matrixReport} from './test-native-ltm-matrix.mjs';

import {exerciseInterventionFamilies} from '../../research/buffalo-lab/c1-parity/intervention-families-run.mjs';
import {exerciseComparisonSession} from '../../research/buffalo-lab/c1-parity/comparison-ws.mjs';
import {exerciseParitySession} from '../../research/buffalo-lab/c1-parity/websocket.mjs';
const parityOnly=process.env.C1_PARITY_REPORT??null;
const parityAccumulate=process.env.C1_PARITY_ACCUMULATE==='true';
const parityStrict=process.env.C1_PARITY_STRICT_CACHE==='true';
const parityCompare=process.env.C1_PARITY_COMPARISON==='true';
const parityPairFeedback=process.env.C1_PARITY_COMPARATIVE_FEEDBACK==='true';
const parityInterventionReference=process.env.C1_PARITY_INTERVENTION_REFERENCE==='true';
const parityFamilies=process.env.C1_PARITY_INTERVENTION_FAMILIES==='true';
if(parityFamilies&&(!parityOnly||parityAccumulate||parityStrict||parityCompare||parityPairFeedback||parityInterventionReference||process.env.C1_PARITY_FEEDBACK_DEMAND==='true'||process.env.C1_PARITY_LTM_DEMAND==='true'))throw Error('PARITY_FAMILIES_EXCLUSIVE');
if(parityInterventionReference&&!parityPairFeedback)throw Error('PARITY_REFERENCE_REQUIRES_PAIR_FEEDBACK');
if(parityPairFeedback&&!parityCompare)throw Error('PARITY_PAIR_FEEDBACK_REQUIRES_COMPARE');
if(parityCompare&&(!parityStrict||process.env.C1_PARITY_FEEDBACK_DEMAND==='true'))throw Error('PARITY_COMPARE_REQUIRES_STRICT_ONLY');
const parityDemand=process.env.C1_PARITY_FEEDBACK_DEMAND==='true';
const parityLtmDemand=process.env.C1_PARITY_LTM_DEMAND==='true';
if(parityLtmDemand&&!parityDemand)throw Error('PARITY_LTM_DEMAND_REQUIRES_DEMAND');
if(parityDemand&&!parityStrict)throw Error('PARITY_DEMAND_REQUIRES_STRICT');
if(parityStrict&&(!parityOnly||!parityAccumulate))throw Error('PARITY_STRICT_REQUIRES_ACCUMULATE');
if(parityAccumulate&&!parityOnly)throw Error('PARITY_ACCUMULATE_REQUIRES_REPORT');
if(parityOnly&&(process.env.FULL_LTM_LIVE_SOCKET||process.env.FULL_LTM_MATRIX_REPORT))throw Error('PARITY_EXCLUSIVE_OFFLINE_MODE');

const deps=createRequire(join(process.env.FULL_TEST_TOOLS,'entry.cjs'));
const {Miniflare,convertV4MiniflareOptions}=deps('miniflare');
const {build}=deps('esbuild');
// Substitute local TCP listeners for the container port and AI binding.
const testModule=`import {ProjectRuntime} from './infra/full-runtime/worker.mjs';
export {FullApplication,default} from './infra/full-runtime/worker.mjs';
export class LocalProject extends ProjectRuntime {
  constructor(ctx,env){
    super(ctx,{...env,AI:{async run(model,wire){
      const r=await fetch('http://127.0.0.1/fixture',{method:'POST',body:JSON.stringify({model,wire})});
      if(!r.ok)throw Error('fixture failed');
      return r.json();
    }}});
  }
  fetch(r){
    const path=new URL(r.url).pathname;
    if(path==='/fixture/infer'||path==='/fixture/infer-engine'){
      return this.infer(new Request(path==='/fixture/infer-engine'?'${ENGINE_ENDPOINT}':'${ENDPOINT}',r),r.headers.get('x-buffalo-project'));
    }
    return super.fetch(r);
  }
  async simulateNative(project,body){return fetch('http://127.0.0.1:8081/simulate',{method:'POST',body});}
  async applicationPort(){return {fetch(r){const u=new URL(r.url);u.host='127.0.0.1:8080';return fetch(new Request(u,r));}};}
}`;
const script=(await build({stdin:{contents:testModule,resolveDir:process.cwd()},bundle:true,write:false,
  format:'esm',target:'es2022',external:['cloudflare:workers']})).outputFiles[0].text;
const disk=await mkdtemp(join(tmpdir(),'buffalo-full-test-'));
const fixtureOptions=(limit=27,ttl=600000)=>({...convertV4MiniflareOptions({cf:false,host:'127.0.0.1',port:8793,workers:[
  {name:'client',modules:true,compatibilityDate:'2026-11-19',serviceBindings:{FULL:{name:'full',entrypoint:'FullApplication'}},
    script:"export default {fetch(r,e){const q=new Request(r);q.headers.set('x-buffalo-project',q.headers.get('x-fixture-project')==='other'?'other':'example');q.headers.delete('x-fixture-project');return e.FULL.fetch(q)}}"},
  {name:'full',modules:true,compatibilityDate:'2026-11-19',script,
    bindings:{RUNTIME_ENABLED:'true',APP_AUTH_KEY:'fixture',AI_PROJECT:'example',AI_MAX_CALLS:String(limit),ENGINE_INFERENCE_ENABLED:'true',
      AI_EXPIRES_AT:new Date(Date.now()+ttl).toISOString(),...(parityOnly?{C1_PARITY_SELDON_ENABLED:'true',...(parityCompare?{C1_PARITY_COMPARISON:'true'}:{})}:{})},durableObjects:{PROJECTS:{className:'LocalProject',useSQLite:true}}}
]}),resourcePersistencePath:disk});
const options=fixtureOptions();
let mf,child,exited,calls=0,engineCalls=0,scenarioOffset=0,generationOffset=null,lastEngineRequest=null,failNextEngine=false,invalidNextEngine=null;
const key=randomUUID(),base='http://127.0.0.1:8793';
const model={variables:[{name:'Demand',type:'variable',equation:'3'}],relationships:[]};
const doc=(options={})=>mf.dispatchFetch('http://localhost/project/model',{...options,
  headers:{'x-buffalo-project':'example',...options.headers}});
function start(edit){
  child=spawn('/usr/bin/setpriv',['--inh-caps=-all','--ambient-caps=-all','--no-new-privs','--',process.execPath,
    '--import','./infra/full-runtime/bootstrap.mjs','app.js'],{stdio:'inherit',env:{
      PATH:process.env.PATH,HOME:process.env.HOME,PORT:'8080',WEBSOCKET_PORT:'8080',AUTHENTICATION_KEY:key,BUFFALO_NATIVE_LTM:'true',
      BUFFALO_SIMLIN_PYTHON:process.env.BUFFALO_SIMLIN_PYTHON,
      ...(parityStrict?{C1_PARITY_STRICT_CACHE:'true',...(parityCompare?{C1_PARITY_COMPARISON:'true',...(parityPairFeedback?{C1_PARITY_COMPARATIVE_FEEDBACK:'true'}:{})}:{}),...(parityDemand?{C1_PARITY_FEEDBACK_DEMAND:'true'}:{})}:{}),
      ALLOW_UNSANDBOXED_FALLBACK:'false',...(edit?{BUFFALO_PRIVATE_MERLIN_MODEL:GEMMA,BUFFALO_FULL_ENGINE_PROVIDER:'true'}:{})}});
  exited=once(child,'exit');
}
async function stop(){if(child){child.kill();await exited;child=null;}}
const scriptedTools=[
  ['read_model_section',{section:'variables',filter:{variableNames:['Demand']}}],
  ['edit_variables',{operation:'update',data:[{name:'Demand',equation:'5'}]}],
  ['update_model',{}]
];
const simulationSteps=[
 ['edit_variables',{operation:'update',data:[{name:'Demand',equation:'5'}]}],
 ['edit_relationships',{operation:'add',data:[{from:'Demand',to:'Inflow',polarity:'+'}]}],
 ['edit_specs',{data:{stopTime:4}}],
 ['edit_modules',{operation:'add',data:[{name:'Operations',parentModule:null}]}],
 ['edit_modules',{operation:'remove',data:[{name:'Operations'}]}],
 ['run_model',{}],
 ['get_run_info',{}],
 ['get_variable_data',{variableNames:['Inventory'],runIds:['run-1'],detailed:true}],
 ['read_file',null]
];
let qualitative=false,seldon=null,bass=null;
let engineFixture;
function fixture(model,wire){
  if(engineFixture)return engineFixture(model,wire);
  if(bass)return bass.reply(model,wire);
  if(seldon)return seldon.reply(model,wire);
  if(qualitative)return qualitativeFixture(model,wire);
  assert.equal(model,GEMMA);
  if(wire.response_format){engineCalls++;if(failNextEngine){failNextEngine=false;throw Error('controlled provider failure');}
    const result=quantitativeFixture(model,wire,generationOffset===null?undefined:agentPrompt);
    const invalid=invalidNextEngine;invalidNextEngine=null;
    if(invalid==='schema_valid')result.choices[0].message.content='{}';
    if(invalid==='total_tokens_valid')result.usage.total_tokens=-1;
    return result;}
  calls++;
  if(!wire.tools)return {model,usage:{prompt_tokens:12,completion_tokens:2049,neurons:1.25},
    choices:[{finish_reason:'length',message:{role:'assistant',content:'truncated fixture'}}]};
  const local=calls-(generationOffset??scenarioOffset);
  if(local>1)assert(wire.messages.some(m=>m.role==='tool' && m.tool_call_id==='step-'+(calls-1)));
  const message={role:'assistant'};
  const generationSteps=[['generate_quantitative_model',{prompt:agentPrompt,difficulty:'normal',parameters:{allowArrays:false,allowModules:false,allowSubTypes:false}}],
    ['edit_variables',{operation:'update',data:[{name:'Demand',equation:'6'}]}],['run_model',{}],
    ['get_variable_data',{variableNames:['Inventory'],runIds:['run-1'],detailed:true}]];
  const step=(generationOffset!==null?generationSteps:scenarioOffset?simulationSteps:scriptedTools)[local-1];
  if(step){
    const [name,originalArgs]=step;
    let args=originalArgs;
    if(name==='read_file'){
      const result=wire.messages.find(m=>m.role==='tool'&&m.tool_call_id==='step-'+(calls-1));
      const parsed=JSON.parse(result.content);assert.match(parsed.filePath,/variable_data_\d+\.json$/);args={filePath:parsed.filePath};
    }
    assert(wire.tools.some(t=>t.function.name===name));
    message.tool_calls=[{type:'function',id:'step-'+calls,function:{name,arguments:JSON.stringify(args)}}];
  }else{
    if(generationOffset!==null){const result=wire.messages.find(m=>m.role==='tool'&&m.tool_call_id==='step-'+(calls-1));
      const parsed=JSON.parse(result.content);assert.equal(typeof parsed.filePath,'string');}
    else if(scenarioOffset){const result=wire.messages.find(m=>m.role==='tool'&&m.tool_call_id==='step-'+(calls-1));
      const parsed=JSON.parse(result.content);assert.deepEqual(JSON.parse(parsed.content)['run-1'].Inventory,[10,15,20,25,30]);}
    message.content='Offline fixture acknowledges operation.';
  }
  return {model,usage:{prompt_tokens:12,completion_tokens:8},
    choices:[{index:0,finish_reason:message.tool_calls?'tool_calls':'stop',message}]};
}
const infer=(body,engine=false)=>mf.dispatchFetch('http://localhost/fixture/'+(engine?'infer-engine':'infer'),{method:'POST',body});
const proxy=createServer(async(req,res)=>{
  try{
    const body=await new Response(req).text();
    if(req.url==='/fixture'){
      const {model,wire}=JSON.parse(body);
      // Evaluate and serialize the fixture before committing HTTP status 200.
      // A controlled binding failure must reach the catch as a single 422.
      const payload=JSON.stringify(await fixture(model,wire));
      res.writeHead(200,{'content-type':'application/json'}).end(payload);
      return;
    }
    assert(['/v1/chat/completions','/v1/engine/completions'].includes(req.url));
    if(req.url==='/v1/engine/completions')lastEngineRequest=body;
    const r=await infer(body,req.url==='/v1/engine/completions');
    const payload=await r.text();
    res.writeHead(r.status,{'content-type':'application/json'}).end(payload);
  }catch(e){
    console.error(e);
    if(res.headersSent){res.destroy(e);return;}
    res.writeHead(422).end();
  }
});
try{
  if(parityOnly){
    mf=new Miniflare(fixtureOptions(parityFamilies?1:parityPairFeedback?7:parityCompare?6:parityLtmDemand?6:parityDemand?7:parityStrict?9:parityAccumulate?7:6));await mf.ready;
    proxy.listen(80,'127.0.0.1');await once(proxy,'listening');
    start(true);await rest(base,key);
    const request=(path,init={})=>mf.dispatchFetch('http://localhost'+path,init);
    if(parityFamilies){engineFixture=()=>{throw Error('FAMILIES_INFERENCE_FORBIDDEN');};await exerciseInterventionFamilies(request,parityOnly);}
    else if(parityCompare)await exerciseComparisonSession(request,key,provider=>{engineFixture=provider;},parityOnly,{pairFeedback:parityPairFeedback,interventionReference:parityInterventionReference});
    else await exerciseParitySession(request,key,provider=>{engineFixture=provider;},parityOnly,{accumulate:parityAccumulate,strictCache:parityStrict,demand:parityDemand,ltmDemand:parityLtmDemand});
  }else{
  mf=new Miniflare(options);await mf.ready;
  const created=await doc({method:'PUT',headers:{'if-none-match':'*'},body:JSON.stringify(model)});
  assert.equal(created.status,201);
  start(false);await rest(base,key);
  for(const [mode,agents] of [['cld',['socrates','athena_CLD','merlin']],['sfd',['themis','athena_SFD','socrates','merlin']]]){
    for(const agent of agents)await session({mode,key,agent,model:mode==='cld'?{variables:[{name:'Trust',type:'variable'}],relationships:[]}:model});
  }
  await stop();assert.equal(calls,0);console.log('FULL_ORIGINAL_REST_AND_FIVE_CONFIGURATIONS');
  proxy.listen(80,'127.0.0.1');await once(proxy,'listening');
  start(true);await rest(base,key);
  const smokeModel=await testOriginalEngine(base,key);assert.equal(engineCalls,2);assert.equal(calls,0);
  const engineReceiptResponse=await mf.dispatchFetch('http://localhost/project/inference/1');
  assert.equal(engineReceiptResponse.status,200);
  const engineReceipt=await engineReceiptResponse.json();
  assert.equal(engineReceipt.channel,'original-engine');assert.equal(engineReceipt.status,'OK');
  assert.equal(engineReceipt.response_format,'json_schema');assert.equal(engineReceipt.neurons,1.5);
  assert.equal(engineReceipt.schema_sha256,createHash('sha256').update(JSON.stringify(LLMWrapper.prototype.generateQuantitativeSDJSONResponseSchema(false,false,false,false).toJSONSchema())).digest('hex'));
  assert.equal(engineReceipt.predicates.schema_valid,true);assert.equal(engineReceipt.predicates.total_tokens_valid,true);
  assert.deepEqual(engineReceipt.usage,{prompt_tokens:500,completion_tokens:100,total_tokens:null});
  // Run the very same verifier that will consume a real smoke receipt.
  // All inputs here are explicitly controlled-provider fixtures.
  const smokeReceipt={fixture_only:true,status:SMOKE_MODEL_RETURNED,container_stopped:true,single_reservation:true,inference:engineReceipt,model:smokeModel};
  const verified=await verifyQuantitative(smokeReceipt);
  assert.deepEqual(verified.Inventory,[10,15,20,25,30]);
  await assert.rejects(verifyQuantitative({...smokeReceipt,inference:{...engineReceipt,schema_sha256:'0'.repeat(64)}}),/EXACT_ORIGINAL_SCHEMA_HASH/);
  const wrongModel=structuredClone(smokeModel);wrongModel.variables.find(v=>v.name==='Demand').equation='6';
  await assert.rejects(verifyQuantitative({...smokeReceipt,model:wrongModel}));
  // Equivalent auxiliary factorization and variable order are not semantic failures.
  const factored=structuredClone(smokeModel);
  factored.variables.find(v=>v.name==='Demand').equation='DailyDemandRate';
  factored.variables.push({name:'DailyDemandRate',type:'variable',equation:'5',units:'items/Day'});
  factored.variables.reverse();
  const factoredOutcome=await verifyQuantitative({...smokeReceipt,model:factored});
  assert.deepEqual(factoredOutcome.Inventory,[10,15,20,25,30]);
  assert.equal(factoredOutcome.variable_count,4);
  const wrongFactored=structuredClone(factored);
  wrongFactored.variables.find(v=>v.name==='DailyDemandRate').equation='6';
  await assert.rejects(verifyQuantitative({...smokeReceipt,model:wrongFactored}));
  const extraStock=structuredClone(factored);
  extraStock.variables.push({name:'OtherStock',type:'stock',equation:'0'});
  await assert.rejects(verifyQuantitative({...smokeReceipt,model:extraStock}),/EXACT_ONE_STOCK/);
  const extraFlow=structuredClone(factored);
  extraFlow.variables.push({name:'OtherFlow',type:'flow',equation:'0'});
  await assert.rejects(verifyQuantitative({...smokeReceipt,model:extraFlow}),/EXACT_ONE_FLOW/);
  console.log('FULL_QUANTITATIVE_EQUIVALENT_AUXILIARY_ACCEPTED_OFFLINE');
  console.log('FULL_QUANTITATIVE_SMOKE_VERIFIER_OFFLINE '+JSON.stringify({time:verified.time,Inventory:verified.Inventory,Demand:verified.Demand,Inflow:verified.Inflow}));
  const repeatReceipt=await (await mf.dispatchFetch('http://localhost/project/inference/2')).json();
  assert.equal(repeatReceipt.status,'OK');assert.equal(repeatReceipt.request_sha256,engineReceipt.request_sha256);
  assert.notEqual(repeatReceipt.invocation_id,engineReceipt.invocation_id);
  assert.equal((await infer(lastEngineRequest,true)).status,403);assert.equal(engineCalls,2);
  console.log('FULL_ENGINE_IDENTICAL_EXPERIMENTS_ALLOWED_REPLAY_DENIED');
  failNextEngine=true;await testFailedOriginalEngine(base,key);
  assert.equal(failNextEngine,false);assert.equal(engineCalls,3);
  const failureReceipt=await (await mf.dispatchFetch('http://localhost/project/inference/3')).json();
  assert.equal(failureReceipt.status,'FAILED');assert.equal(failureReceipt.request_sha256,engineReceipt.request_sha256);
  assert.notEqual(failureReceipt.invocation_id,engineReceipt.invocation_id);
  assert.equal((await infer(lastEngineRequest,true)).status,403);assert.equal(engineCalls,3);
  console.log('FULL_ENGINE_SDK_FAILURE_NO_AUTOMATIC_RETRY');
  // Both regressions travel through the original REST/SDK and workerd.
  // A rejected response still spends exactly one reservation.
  for(const predicate of ['schema_valid','total_tokens_valid']){
    invalidNextEngine=predicate;
    const before=engineCalls;await testFailedOriginalEngine(base,key);
    assert.equal(invalidNextEngine,null);assert.equal(engineCalls,before+1);
    const rejected=await (await mf.dispatchFetch('http://localhost/project/inference/'+engineCalls)).json();
    assert.equal(rejected.status,'REJECTED');assert.deepEqual(rejected.failed_predicates,[predicate]);
    assert.deepEqual(rejected.usage,{prompt_tokens:500,completion_tokens:100,total_tokens:null});
    assert.equal(rejected.neurons,1.5);assert.equal(rejected.request_sha256,engineReceipt.request_sha256);
    assert.equal((await infer(lastEngineRequest,true)).status,403);assert.equal(engineCalls,before+1);
  }
  console.log('FULL_ENGINE_SCHEMA_AND_USAGE_REJECTION_RECEIPTS');
  const old={'if-match':created.headers.get('etag')};
  let etag=old['if-match'];
  const journalRequest=(path,init={})=>mf.dispatchFetch('http://localhost'+path,init);
  const journalOther=(path,init={})=>journalRequest(path,{...init,headers:{...init.headers,'x-fixture-project':'other','x-buffalo-project':'example'}});
  const journalInput=modelIdentity(created);
  const journal=await createConversationJournal(journalRequest,{mode:'sfd',agent:'merlin',provider:'cloudflare'},journalInput);
  let journalOutput;
  await session({mode:'sfd',key,model,agent:'merlin',edit:true,journal,save:async m=>{
    const saved=await doc({method:'PUT',headers:{'if-match':etag},body:JSON.stringify(m)});
    assert.equal(saved.status,204);etag=saved.headers.get('etag');
    journalOutput=modelIdentity(saved);return journalOutput;
  }});
  const conversationState=await checkConversationBeforeRestart(journalRequest,journalOther,journal,journalInput,journalOutput);
  assert.equal((await doc({method:'PUT',headers:old,body:JSON.stringify(model)})).status,412);
  // A second original session runs a real stock/flow simulation in the compatible client.
  scenarioOffset=calls;const scenario=simulationScenario();
  await session({mode:'sfd',key,model:simulationModel(),agent:'merlin',edit:true,scenario,
    save:async m=>{scenario.snapshots.push(structuredClone(m));}});
  assert.equal(calls,14);
  // An empty client model invokes the ORIGINAL sandboxed generation tool, then
  // edits and simulates the generated model and persists each confirmed update.
  generationOffset=calls;
  const sim=createSimulationClient(),snapshots=[];
  await session({mode:'sfd',key,model:{variables:[],relationships:[]},agent:'merlin',edit:true,
    scenario:{message:agentPrompt+' Then edit Demand to 6 and simulate.',capabilities:{supportsArrays:false,supportsModules:false,supportsSubTypes:false},
      clientRequest:(m,model)=>sim.request(m,model),
      verify(model,tools){
        assertDemand(model,'6');assert(snapshots.some(m=>m.variables.some(v=>v.name==='Demand'&&v.equation==='5')));
        for(const name of ['generate_quantitative_model','edit_variables','run_model','get_variable_data'])
          assert(tools.some(t=>t.event==='tool_call_completed'&&t.name===name&&t.isError===false),name);
        const data=sim.runs.get('run-1')?.data;
        assert.deepEqual(data?.time,[0,1,2,3,4]);assert.deepEqual(data?.Inventory,[10,16,22,28,34]);
        console.log('FULL_ORIGINAL_AGENT_GENERATE_EDIT_SIMULATE '+JSON.stringify({time:data.time,Inventory:data.Inventory}));
      }},
    save:async m=>{snapshots.push(structuredClone(m));const saved=await doc({method:'PUT',headers:{'if-match':etag},body:JSON.stringify(m)});
      assert.equal(saved.status,204);etag=saved.headers.get('etag');}});
  assert.equal(engineCalls,6);assert.equal(calls,19);
  const rejectedRequest=JSON.stringify({model:GEMMA,messages:[{role:'user',content:'fixture'}],tools:[]});
  assert.equal((await infer(rejectedRequest)).status,422);
  const lastAttempt=calls+engineCalls;
  await stop();await mf.dispose();mf=new Miniflare(options);await mf.ready;
  const saved=await doc();assert.equal(saved.headers.get('etag'),etag);
  const recovered=await saved.json();assertDemand(recovered,'6');
  const receipt=await mf.dispatchFetch('http://localhost/project/inference/'+lastAttempt);
  assert.equal(receipt.status,200);
  const diagnostic=await receipt.json();
  assert.deepEqual(diagnostic.usage,{prompt_tokens:12,completion_tokens:2049});
  assert.equal(diagnostic.neurons,1.25);
  assert.equal(diagnostic.status,'REJECTED');
  assert(diagnostic.failed_predicates.includes('finish_reason_valid'));
  // There is still one reservation available; replay denial must survive restart
  // independently of the budget. A fresh ID for identical content uses that slot.
  assert.equal((await infer(lastEngineRequest,true)).status,403);assert.equal(engineCalls,6);
  assert.equal((await infer(JSON.stringify({...JSON.parse(lastEngineRequest),invocation_id:randomUUID()}),true)).status,200);
  assert.equal(engineCalls,7);
  const repeatedAfterRestart=await (await mf.dispatchFetch('http://localhost/project/inference/'+(lastAttempt+1))).json();
  assert.equal(repeatedAfterRestart.status,'OK');
  assert.equal((await infer(rejectedRequest)).status,403);
  const historicalMessages=await checkConversationAfterRestart(journalRequest,journalOther,conversationState,journal);
  start(false);await rest(base,key);await session({mode:'sfd',key,agent:'merlin',model:recovered,historicalMessages});
  console.log('FULL_ORIGINAL_SESSION_INITIALIZED_WITH_RECOVERED_HISTORY');
  assert.equal(calls+engineCalls,lastAttempt+1);console.log('FULL_ORIGINAL_EDIT_CONFIRMED_AND_PROJECT_REOPENED_OFFLINE');
  // Separate offline project storage keeps the quantitative replay and
  // lifetime-budget regression above independent of the CLD scenarios.
  await stop();await mf.dispose();
  const cldOptions={...options,resourcePersistencePath:join(disk,'cld')};
  qualitative=true;
  mf=new Miniflare(cldOptions);await mf.ready;
  start(true);await rest(base,key);
  let cldTag;
  const saveCLD=async model=>{
    const headers=cldTag?{'if-match':cldTag}:{'if-none-match':'*'};
    const saved=await doc({method:'PUT',headers,body:JSON.stringify(model)});
    assert.equal(saved.status,cldTag?204:201);
    cldTag=saved.headers.get('etag');
  };
  await exerciseQualitative(base,key,saveCLD,async n=>{
    const r=await mf.dispatchFetch('http://localhost/project/inference/'+n);
    assert.equal(r.status,200);return r.json();
  });
  await stop();await mf.dispose();mf=new Miniflare(cldOptions);await mf.ready;
  const cld=await doc();assert.equal(cld.status,200);assert.equal(cld.headers.get('etag'),cldTag);
  // Consume the Miniflare response before starting the app and awaiting its REST checks.
  // Keep the recovered model, not the response stream, across asynchronous boundaries.
  const recoveredCLD=await cld.json();
  start(false);await rest(base,key);await reopenQualitative(key,recoveredCLD);
  console.log('FULL_ORIGINAL_CLD_REST_MERLIN_AND_PROJECT_REOPENED_OFFLINE');
  // Return to the preexisting quantitative model-only storage; do not
  // start the original app or invoke the controlled provider in this test.
  await stop();await mf.dispose();mf=new Miniflare(options);await mf.ready;
  const request=(path,init={})=>mf.dispatchFetch('http://localhost'+path,init);
  const other=(path,init={})=>request(path,{...init,headers:{...init.headers,'x-fixture-project':'other','x-buffalo-project':'example'}});
  const persistence=await storePersistentRuns(request,other);
  await mf.dispose();mf=new Miniflare(options);await mf.ready;
  await recoverPersistentRuns(request,other,persistence);
  assert.equal(calls+engineCalls,lastAttempt+1);
  // The previous test exhausted its 27 reservations and proved denial.
  // Only the offline controlled-provider fixture receives six new slots;
  // no deployed grant, runtime template or real provider budget changes.
  assert.equal(lastAttempt+1,27);
  await mf.dispose();mf=new Miniflare(fixtureOptions(33));await mf.ready;
  qualitative=false;seldon=createSeldonFixture();
  start(true);await rest(base,key);
  await exerciseSeldon(request,other,key,persistence,seldon,lastAttempt+1);
  assert.equal(calls+engineCalls,lastAttempt+1);
  // A fresh local DO database prevents accidental association of the Bass
  // reference with the unrelated persisted Inventory runs.
  await stop();await mf.dispose();
  mf=new Miniflare({...fixtureOptions(3),resourcePersistencePath:join(disk,'bass')});await mf.ready;
  seldon=null;bass=createBassFixture();
  start(true);await rest(base,key);
  await exerciseBassReference(request,key,bass);
  assert.equal(calls+engineCalls,lastAttempt+1);
  await stop();await mf.dispose();
  const documentationOptions={...fixtureOptions(3),resourcePersistencePath:join(disk,'documentation')};
  mf=new Miniflare(documentationOptions);await mf.ready;
  bass=null;
  start(true);await rest(base,key);
  const documented=await exerciseDocumentation(request,key,provider=>{engineFixture=provider;});
  await stop();await mf.dispose();
  mf=new Miniflare(documentationOptions);await mf.ready;
  const restored=await request('/project/model');
  assert.equal(restored.headers.get('etag'),'"'+documented.revision+'"');
  assert.deepEqual(await restored.json(),documented.model);
  console.log('FULL_DOCUMENTATION_ORIGINAL_REST_THREE_SCHEMAS_REVISION_REOPENED');
  await mf.dispose();
  const narrativeOptions={...fixtureOptions(2),resourcePersistencePath:join(disk,'narratives')};
  mf=new Miniflare(narrativeOptions);await mf.ready;
  const cases=await seedNarrativeRuns(request,other);
  await mf.dispose();mf=new Miniflare(narrativeOptions);await mf.ready;
  start(true);await rest(base,key);
  await exerciseRunNarratives(request,other,key,cases,provider=>{engineFixture=provider;});
  await stop();await mf.dispose();mf=new Miniflare(narrativeOptions);await mf.ready;
  for(const c of cases){
    assert.deepEqual(await (await request(c.narrativePath)).json(),c.saved);
    assert.deepEqual(await (await request(c.path+'/feedback')).json(),c.feedback);
  }
  console.log('FULL_LTM_NARRATIVE_BASS_AND_JOINT_DOMINANCE_REOPENED');
  await mf.dispose();
  const nativeOptions={...fixtureOptions(10),resourcePersistencePath:join(disk,'native-ltm')};
  mf=new Miniflare(nativeOptions);await mf.ready;
  start(false);await rest(base,key);
  const nativeRuns=await seedNativeLtm(request,other);
  await stop();await mf.dispose();
  mf=new Miniflare(nativeOptions);await mf.ready;
  start(true);await rest(base,key);
  await reopenNativeLtm(request,other,key,nativeRuns,provider=>{engineFixture=provider;});
  // Keep the earlier two-case regression intact. The separate matrix has its own
  // fresh local storage and budget. Live mode affects ONLY this matrix.
  if(process.env.FULL_LTM_MATRIX_REPORT){
    await stop();await mf.dispose();
    const socket=process.env.FULL_LTM_LIVE_SOCKET??null;
    if(socket)assert.equal(process.env.FULL_LTM_LIVE_APPROVAL,'RUN_LTM_MATRIX_MAX_64');
    const matrixOptions={...fixtureOptions(64,socket?1800000:600000),resourcePersistencePath:join(disk,'native-ltm-matrix')};
    // The original local expiry is 10 min; allow up to 30 min only for the
    // explicitly opted-in matrix, still with a 64-call durable ceiling.
    const {report,save}=matrixReport(process.env.FULL_LTM_MATRIX_REPORT,socket);
    save();
    mf=new Miniflare(matrixOptions);await mf.ready;
    start(false);await rest(base,key);
    await seedLtmMatrix(request,other,report,save);
    await stop();await mf.dispose();mf=new Miniflare(matrixOptions);await mf.ready;
    start(true);await rest(base,key);
    await reopenLtmMatrix(request,other,key,report,save,provider=>{engineFixture=provider;},{socket});
  }
  }
}finally{await stop();proxy.close();await mf?.dispose();await rm(disk,{recursive:true,force:true});}
