// One private origin and its genuine Linux worker in a loopback-only CI namespace.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {setTimeout as sleep} from 'node:timers/promises';
import {WebSocket} from 'ws';
import {readTurn} from './socket.mjs';
import {groups} from '../../evals/categories/policyImplementation.js';
import {MODEL,CONFIG_HASH,ENDPOINT,MODEL_IDS} from './protocol.mjs';
import {providerRequest} from './gateway.mjs';
const model=groups.policyImplementation.find(x=>x.expectations.scenario==='dialysisClinic').currentModel;
const key=randomBytes(32).toString('hex');
const source=process.env.GITHUB_SHA,deadline=Date.now()+90000;
const phase=process.argv[2]??'R';
assert(['R','I'].includes(phase));
const providerModel=MODEL_IDS[0];
const fixture='Offline transport fixture from the local provider.';
let requests=0, proxy;
if(phase==='I'){
  const g={phase,task_id:crypto.randomUUID(),project_id:'arena-igc',source_commit:source,
    image_digest:'sha256:'+'0'.repeat(64),model_sha256:MODEL,expires:deadline,
    provider_model:providerModel,max_posts:1,max_input_bytes:131072,max_output_tokens:128};
  let row={...g,approval:g,status:'RUNNING',deadline,sd_json:JSON.stringify(model),posts:0,egress_attempts:0};
  const storage={transaction:fn=>fn(storage),get:async()=>row,put:async(_k,data)=>{row=data;}};
  proxy=createServer(async(req,res)=>{
    try{
      assert.equal(req.url,'/v1/chat/completions');
      const request=new Request(ENDPOINT,{method:req.method,body:req,duplex:'half'});
      const response=await providerRequest(storage,{MERLIN_GRANT:JSON.stringify(g),MERLIN_AI_TOKEN:'fixture'},
        'I',request,async()=>{
          requests++;
          return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:fixture}}],
            usage:{prompt_tokens:10,completion_tokens:8}});
        });
      res.writeHead(response.status,{'content-type':'application/json'}).end(await response.text());
    }catch(e){console.error(e.message);res.writeHead(403).end();}
  });
  proxy.listen(80,'127.0.0.1');await once(proxy,'listening');
}
const child=spawn('/usr/bin/setpriv',['--inh-caps=-all','--ambient-caps=-all','--no-new-privs','--',
  process.execPath,'infra/private-merlin/origin.mjs'],{stdio:'inherit',env:{
    PATH:process.env.PATH,HOME:process.env.HOME,MERLIN_PHASE:phase,MERLIN_KEY:key,MERLIN_SOURCE:source,
    ...(phase==='I'?{BUFFALO_PRIVATE_MERLIN_MODEL:providerModel}:{}),
    BUFFALO_IMAGE_SOURCE_SHA:source,MERLIN_EXPIRES:String(deadline),ALLOW_UNSANDBOXED_FALLBACK:'false'}});
const stopped=once(child,'exit');
try{
  let ready=false;
  for(let i=0;i<300 && child.exitCode===null;i++){
    try{if((await fetch('http://127.0.0.1:8080/health')).status===204){ready=true;break;}}catch{}
    await sleep(100);
  }
  assert(ready,'origin failed to start');
  const ws=new WebSocket('ws://127.0.0.1:8080/api/v1',{headers:{'x-merlin-key':key}});
  const t=await readTurn(ws,phase,model,deadline);
  const res=await fetch('http://127.0.0.1:8080/proof',{headers:{'x-merlin-key':key}});
  assert.equal(res.status,200);
  const p=await res.json();
  assert.equal(p.session_id,t.session_id);
  assert.equal(p.source_commit,source);
  assert.equal(p.model_sha256,MODEL);
  assert.equal(p.agent_config_sha256,CONFIG_HASH);
  assert.deepEqual(p.worker_frames,['get_current_model',phase==='R'?'error':'agent_text','agent_complete']);
  assert.deepEqual(p.exit,{code:0,signal:null});
  assert.equal(p.shutdown_ipc_sent,true);
  if(phase==='R')assert.equal(t.output,null);
  else{assert(t.output.includes(fixture));assert.equal(requests,1);}
  console.log(phase==='R'?'OFFLINE_PRIVATE_WS_ORIGINAL_WORKER_DENIED':'OFFLINE_NATIVE_I_WITH_TEST_PROVIDER',JSON.stringify(p));
}finally{child.kill();await stopped;proxy?.close();}
