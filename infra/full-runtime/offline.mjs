import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
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
import {ENGINE_ENDPOINT} from './engine-protocol.mjs';
import {quantitativeFixture,testOriginalEngine} from './test-engine.mjs';

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
  async applicationPort(){return {fetch(r){const u=new URL(r.url);u.host='127.0.0.1:8080';return fetch(new Request(u,r));}};}
}`;
const script=(await build({stdin:{contents:testModule,resolveDir:process.cwd()},bundle:true,write:false,
  format:'esm',target:'es2022',external:['cloudflare:workers']})).outputFiles[0].text;
const disk=await mkdtemp(join(tmpdir(),'buffalo-full-test-'));
const options={...convertV4MiniflareOptions({cf:false,host:'127.0.0.1',port:8793,workers:[
  {name:'client',modules:true,compatibilityDate:'2026-11-19',serviceBindings:{FULL:{name:'full',entrypoint:'FullApplication'}},
    script:"export default {fetch(r,e){const q=new Request(r);q.headers.set('x-buffalo-project','example');return e.FULL.fetch(q)}}"},
  {name:'full',modules:true,compatibilityDate:'2026-11-19',script,
    bindings:{RUNTIME_ENABLED:'true',APP_AUTH_KEY:'fixture',AI_PROJECT:'example',AI_MAX_CALLS:'16',ENGINE_INFERENCE_ENABLED:'true',
      AI_EXPIRES_AT:new Date(Date.now()+600000).toISOString()},durableObjects:{PROJECTS:{className:'LocalProject',useSQLite:true}}}
]}),resourcePersistencePath:disk};
let mf,child,exited,calls=0,engineCalls=0,scenarioOffset=0;
const key=randomUUID(),base='http://127.0.0.1:8793';
const model={variables:[{name:'Demand',type:'variable',equation:'3'}],relationships:[]};
const doc=(options={})=>mf.dispatchFetch('http://localhost/project/model',{...options,
  headers:{'x-buffalo-project':'example',...options.headers}});
function start(edit){
  child=spawn('/usr/bin/setpriv',['--inh-caps=-all','--ambient-caps=-all','--no-new-privs','--',process.execPath,
    '--import','./infra/full-runtime/bootstrap.mjs','app.js'],{stdio:'inherit',env:{
      PATH:process.env.PATH,HOME:process.env.HOME,PORT:'8080',WEBSOCKET_PORT:'8080',AUTHENTICATION_KEY:key,
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
function fixture(model,wire){
  assert.equal(model,GEMMA);
  if(wire.response_format){engineCalls++;return quantitativeFixture(model,wire);}
  calls++;
  if(!wire.tools)return {model,usage:{prompt_tokens:12,completion_tokens:2049,neurons:1.25},
    choices:[{finish_reason:'length',message:{role:'assistant',content:'truncated fixture'}}]};
  const local=calls-scenarioOffset;
  if(local>1)assert(wire.messages.some(m=>m.role==='tool' && m.tool_call_id==='step-'+(calls-1)));
  const message={role:'assistant'};
  const step=(scenarioOffset?simulationSteps:scriptedTools)[local-1];
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
    if(scenarioOffset){const result=wire.messages.find(m=>m.role==='tool'&&m.tool_call_id==='step-'+(calls-1));
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
      res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(fixture(model,wire)));
      return;
    }
    assert(['/v1/chat/completions','/v1/engine/completions'].includes(req.url));
    const r=await infer(body,req.url==='/v1/engine/completions');
    res.writeHead(r.status,{'content-type':'application/json'}).end(await r.text());
  }catch(e){console.error(e);res.writeHead(422).end();}
});
try{
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
  await testOriginalEngine(base,key);assert.equal(engineCalls,1);assert.equal(calls,0);
  const engineReceiptResponse=await mf.dispatchFetch('http://localhost/project/inference/1');
  assert.equal(engineReceiptResponse.status,200);
  const engineReceipt=await engineReceiptResponse.json();
  assert.equal(engineReceipt.channel,'original-engine');assert.equal(engineReceipt.status,'OK');
  assert.equal(engineReceipt.response_format,'json_schema');assert.equal(engineReceipt.neurons,1.5);
  const old={'if-match':created.headers.get('etag')};
  let etag=old['if-match'];
  await session({mode:'sfd',key,model,agent:'merlin',edit:true,save:async m=>{
    const saved=await doc({method:'PUT',headers:{'if-match':etag},body:JSON.stringify(m)});
    assert.equal(saved.status,204);etag=saved.headers.get('etag');
  }});
  assert.equal((await doc({method:'PUT',headers:old,body:JSON.stringify(model)})).status,412);
  // A second original session runs a real stock/flow simulation in the compatible client.
  scenarioOffset=calls;const scenario=simulationScenario();
  await session({mode:'sfd',key,model:simulationModel(),agent:'merlin',edit:true,scenario,
    save:async m=>{scenario.snapshots.push(structuredClone(m));}});
  assert.equal(calls,14);
  const rejectedRequest=JSON.stringify({model:GEMMA,messages:[{role:'user',content:'fixture'}],tools:[]});
  assert.equal((await infer(rejectedRequest)).status,422);
  const lastAttempt=calls+engineCalls;
  await stop();await mf.dispose();mf=new Miniflare(options);await mf.ready;
  const saved=await doc();assert.equal(saved.headers.get('etag'),etag);
  const recovered=await saved.json();assertDemand(recovered,'5');
  const receipt=await mf.dispatchFetch('http://localhost/project/inference/'+lastAttempt);
  assert.equal(receipt.status,200);
  const diagnostic=await receipt.json();
  assert.deepEqual(diagnostic.usage,{prompt_tokens:12,completion_tokens:2049});
  assert.equal(diagnostic.neurons,1.25);
  assert.equal(diagnostic.status,'REJECTED');
  assert(diagnostic.failed_predicates.includes('finish_reason_valid'));
  assert.equal((await infer(rejectedRequest)).status,403);
  start(false);await rest(base,key);await session({mode:'sfd',key,agent:'merlin',model:recovered});
  assert.equal(calls+engineCalls,lastAttempt);console.log('FULL_ORIGINAL_EDIT_CONFIRMED_AND_PROJECT_REOPENED_OFFLINE');
}finally{await stop();proxy.close();await mf?.dispose();await rm(disk,{recursive:true,force:true});}
