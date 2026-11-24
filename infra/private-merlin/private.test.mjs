import test from 'node:test';
import assert from 'node:assert/strict';
import {Turn,DENIED,ENDPOINT,MODEL,grant} from './protocol.mjs';
import {providerRequest} from './gateway.mjs';
import {readTask,runTask} from './task.mjs';

const key={project_id:'arena-igc',task_id:'58532b8a-b25e-4b67-a90b-10db57da263b',phase:'I'};
const g={...key,source_commit:'a'.repeat(40),image_digest:'sha256:'+'b'.repeat(64),model_sha256:MODEL,
  max_posts:1,max_output_tokens:100,max_input_bytes:8192,provider_model:'@cf/thinkingmachines/inkling-2-small',
  expires:Date.now()+100000};
const env={MERLIN_GRANT:JSON.stringify(g),MERLIN_AI_TOKEN:'unit-test'};
const sid='sess_'+'c'.repeat(32);
function storage(initial){
  const state=new Map(Object.entries(initial));
  let previous=Promise.resolve();
  return {get:async k=>structuredClone(state.get(k)),put:async(k,v)=>state.set(k,structuredClone(v)),
    setAlarm:async()=>{},deleteAlarm:async()=>{},
    transaction(fn){const next=previous.then(()=>fn(this));previous=next.catch(()=>{});return next;}};
}
function selected(phase){
  const turn=new Turn(phase,{x:1});
  const event=(type,rest={})=>turn.onNative({type,sessionId:sid,...rest});
  assert.equal(event('session_created').type,'initialize_session');
  assert.equal(event('session_ready').type,'select_agent');
  event('agent_selected',{currentProvider:phase==='R'?DENIED:'cloudflare',agentId:'merlin'});
  assert.equal(event('agent_text',{isThinking:false,content:'Merlin (Private) — What can I do for you today?'}).type,'chat');
  return event;
}
test('one read tied to the native request, denial and ordered close',()=>{
  const frame=selected('R');
  assert.deepEqual(frame('get_current_model',{requestId:'model-1'}),
    {type:'tool_call_response',sessionId:sid,callId:'model-1',result:{x:1},isError:false});
  frame('error',{errorCode:'CONVERSATION_ERROR',error:'Unknown combination: provider='+DENIED+', loop=sdk'});
  assert.equal(frame('agent_complete',{status:'awaiting_user'}).type,'disconnect');
  assert.throws(()=>frame('get_current_model'));
});
test('foreign session, repeated model sync, premature completion or arbitrary tool fails',()=>{
  for(const [type,attrs] of [['get_current_model',{sessionId:'else',requestId:'x'}],
    ['agent_complete',{status:'success'}],['update_model',{}],['tool_call_request',{}]]){
    assert.throws(()=>selected('I')(type,attrs));
  }
  const frame=selected('I');
  frame('get_current_model',{requestId:'request'});
  assert.throws(()=>frame('get_current_model',{requestId:'replay'}));
});
test('absent, expired, wrong phase and missing budget grants fail closed',()=>{
  for(const bad of [null,{...g,phase:'R'},{...g,expires:0},{...g,max_posts:2},{...g,max_output_tokens:Infinity}]){
    assert.throws(()=>grant({MERLIN_GRANT:JSON.stringify(bad)},'I'));
  }
});
const run=()=>({...g,status:'RUNNING',posts:0,egress_attempts:0,sd_json:'{"x":1}',deadline:Date.now()+100000});
const request=()=>new Request(ENDPOINT,{method:'POST',body:JSON.stringify({model:g.provider_model,
  messages:[{role:'system',content:'Merlin'},{role:'user',content:'Model {"x":1}'}],tools:[{}]})});
test('two concurrent provider attempts reserve exactly one POST and remove all tool capabilities',async()=>{
  const db=storage({run:run()});let sent=0;
  const send=async(url,init)=>{
    sent++;assert.equal(new URL(url).hostname,'api.cloudflare.com');
    assert.equal(init.redirect,'error');
    assert.deepEqual(Object.keys(JSON.parse(init.body)).sort(),['max_completion_tokens','messages','model','stream']);
    return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:'Answer'}}],
      usage:{prompt_tokens:10,completion_tokens:2}});
  };
  const results=await Promise.allSettled([1,2].map(()=>providerRequest(db,env,'I',request(),send)));
  assert.equal(sent,1);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.deepEqual((await db.get('run')).usage,{prompt_tokens:10,completion_tokens:2});
});
test('R intercept records and blocks even a valid-looking paid request',async()=>{
  const db=storage({run:{...run(),phase:'R'}});
  assert.equal((await providerRequest(db,{},'R',request(),()=>assert.fail())).status,403);
  assert.equal((await db.get('run')).egress_attempts,1);assert.equal((await db.get('run')).posts,0);
});
test('provider tool calls and truncation stay terminal and consume their reservation',async()=>{
  for(const choice of [{finish_reason:'length',message:{role:'assistant',content:'cut'}},
    {finish_reason:'stop',message:{role:'assistant',tool_calls:[{}],content:'unused'}}]){
    const db=storage({run:run()});
    await assert.rejects(providerRequest(db,env,'I',request(),async()=>Response.json({choices:[choice],
      usage:{prompt_tokens:10,completion_tokens:2}})));
    assert.equal((await db.get('run')).posts,1);
  }
});
test('reconnecting after a bridge restart recovers terminal receipt without submitting again',async()=>{
  const db=storage({task:{...run(),...key}});
  const receipt={...key,status:'RUNTIME_FAILURE',source_commit:g.source_commit,image_digest:g.image_digest,posts:1};
  await runTask(db,{ROUTER:{result:async()=>receipt}});
  assert.deepEqual((await readTask(db,key)).receipt,receipt);
  assert.equal(await readTask(db,{...key,task_id:crypto.randomUUID()}),null);
  assert.equal(Object.hasOwn(await readTask(db,key),'sd_json'),false);
});
