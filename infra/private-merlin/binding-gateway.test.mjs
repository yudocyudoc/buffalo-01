import test from 'node:test';
import assert from 'node:assert/strict';
import {MODEL,ENDPOINT} from './protocol.mjs';
import {bindingProviderRequest,durableStage,readDurableTask,BINDING_TRANSPORT,GEMMA} from './binding-gateway.mjs';
const g={phase:'I',project_id:'arena-igc',task_id:'58532b8a-b25e-4b67-a90b-10db57da263b',source_commit:'a'.repeat(40),image_digest:'sha256:'+'b'.repeat(64),model_sha256:MODEL,max_posts:1,max_output_tokens:2048,max_input_bytes:131072,provider_model:GEMMA,expires:Date.now()+600000};
const run=()=>({...g,approval:g,status:'RUNNING',posts:0,egress_attempts:0,sd_json:'{"x":1}',deadline:Date.now()+60000});
const request=(extra={})=>new Request(ENDPOINT,{method:'POST',body:JSON.stringify({model:GEMMA,messages:[{role:'system',content:'Merlin'},{role:'user',content:'Model {"x":1}'}],tools:[{name:'forbidden'}],...extra})});
const response=()=>({model:GEMMA,choices:[{finish_reason:'stop',message:{role:'assistant',content:'Answer'}}],usage:{prompt_tokens:10,completion_tokens:2}});
function fixture(fn=async()=>response(),initial=run()){
 let s=structuredClone(initial),p=Promise.resolve(),calls=0;
 const storage={get:async()=>structuredClone(s),put:async(k,v)=>{assert.equal(k,'run');s=structuredClone(v)},transaction(cb){const next=p.then(()=>cb(this));p=next.catch(()=>{});return next}};
 const env={MERLIN_GRANT:JSON.stringify(g),MERLIN_I_TRANSPORT:BINDING_TRANSPORT,AI:{run:async(...a)=>{calls++;return fn(...a)}}};
 return {storage,env,read:()=>structuredClone(s),calls:()=>calls};
}
test('native binding only; exact Gemma limits and no tools, reasoning off, one concurrent winner',async()=>{
 const f=fixture(async(model,wire)=>{
  assert.equal(model,GEMMA);assert.deepEqual(Object.keys(wire).sort(),['chat_template_kwargs','max_completion_tokens','messages','stream']);
  assert.equal(wire.max_completion_tokens,2048);assert.equal(wire.stream,false);assert.deepEqual(wire.chat_template_kwargs,{enable_thinking:false});
  return response();
 });
 const results=await Promise.all([1,2].map(()=>bindingProviderRequest(f.storage,f.env,'I',request())));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,403]);
 const result=await results.find(r=>r.ok).json();assert.equal(result.choices[0].message.content,'Answer');
 assert.equal(f.calls(),1);assert.equal(f.read().posts,1);assert.equal(f.read().egress_attempts,2);
 assert.deepEqual(f.read().usage,{prompt_tokens:10,completion_tokens:2});
 assert.equal(f.read().provider_diagnostic.status,'OK');
});
test('no binding in R, no wrong grant or model, missing binding, invalid prompt or oversized request',async()=>{
 const r=fixture(undefined,{...run(),phase:'R'});assert.equal((await bindingProviderRequest(r.storage,r.env,'R',request())).status,403);assert.equal(r.calls(),0);
 for(const [patch,req] of [
  [{MERLIN_I_TRANSPORT:undefined},request()],
  [{AI:undefined},request()],
  [{MERLIN_GRANT:JSON.stringify({...g,expires:0})},request()],
  [{MERLIN_GRANT:JSON.stringify({...g,max_posts:2})},request()],
  [{},request({model:'wrong'})],
  [{},request({messages:[{role:'system',content:'x'.repeat(132000)},{role:'user',content:'{"x":1}'}]})]
 ]){
  const f=fixture();assert.equal((await bindingProviderRequest(f.storage,{...f.env,...patch},'I',req)).status,403);
  assert.equal(f.calls(),0);assert.equal(f.read().posts,0);
 }
});
test('binding failure persists numeric code/status without raw message; reservation is spent',async()=>{
 const f=fixture(async()=>{throw Object.assign(new Error('DO NOT STORE fake secret or prompt'),{code:'3040',status:429})});
 assert.equal((await bindingProviderRequest(f.storage,f.env,'I',request())).status,502);
 const s=f.read();assert.equal(s.posts,1);assert.equal(s.usage,null);assert.equal(s.provider_diagnostic.stage,'BINDING_INVOKE');
 assert.equal(s.provider_diagnostic.reason,'AI_BINDING_EXCEPTION');assert.equal(s.provider_diagnostic.provider_code,3040);assert.equal(s.provider_diagnostic.provider_http_status,429);
 assert(!JSON.stringify(s.provider_diagnostic).includes('DO NOT STORE'));
 await bindingProviderRequest(f.storage,f.env,'I',request());assert.equal(f.calls(),1);assert.deepEqual(f.read().provider_diagnostic,s.provider_diagnostic);
});
test('invalid response retains reported usage and finish reason; missing usage is unknown',async()=>{
 for(const change of [r=>{r.choices[0].finish_reason='length'},r=>{r.choices[0].message.tool_calls=[{}]},r=>{r.usage.completion_tokens=2049},r=>{delete r.usage},r=>{r.model='other'}]){
  const result=response();change(result);const f=fixture(async()=>result);
  assert.equal((await bindingProviderRequest(f.storage,f.env,'I',request())).status,502);
  const s=f.read();assert.equal(s.posts,1);assert.deepEqual(s.usage,result.usage??null);
  assert.equal(s.provider_diagnostic.stage,'RESPONSE');assert.equal(s.provider_diagnostic.status,'FAILED');assert.equal(f.calls(),1);
 }
});
test('distinct durable identities only for armed I binding; historical R and I names unchanged',()=>{
 assert.equal(durableStage({},'I'),'I');assert.equal(durableStage({MERLIN_I_TRANSPORT:BINDING_TRANSPORT},'I'),'I-binding-v2');
 assert.equal(durableStage({MERLIN_I_TRANSPORT:BINDING_TRANSPORT},'R'),'R');
});

test('read both I receipts after disarm; only read, never submit; R is unchanged',async()=>{
 const old={task_id:'old',phase:'I',status:'RUNTIME_FAILURE'},next={task_id:'new',phase:'I',status:'REAL_MERLIN_TURN_COMPLETED'},r={task_id:'r',phase:'R',status:'PASS'};
 const rows={'arena-merlin-v1-I':old,'arena-merlin-v1-I-binding-v2':next,'arena-merlin-v1-R':r};
 const calls=[];
 const env={TASKS:{getByName(name){calls.push(name);return {read:async key=>rows[name]?.task_id===key.task_id?rows[name]:null}}}};
 assert.deepEqual(await readDurableTask(env,{phase:'I',task_id:'new'}),next);
 assert.deepEqual(calls.splice(0),['arena-merlin-v1-I','arena-merlin-v1-I-binding-v2']);
 assert.deepEqual(await readDurableTask(env,{phase:'I',task_id:'old'}),old);
 assert.deepEqual(calls.splice(0),['arena-merlin-v1-I']);
 assert.deepEqual(await readDurableTask({...env,MERLIN_I_TRANSPORT:BINDING_TRANSPORT},{phase:'I',task_id:'old'}),old);
 assert.deepEqual(calls.splice(0),['arena-merlin-v1-I-binding-v2','arena-merlin-v1-I']);
 assert.deepEqual(await readDurableTask(env,{phase:'R',task_id:'r'}),r);
 assert.deepEqual(calls.splice(0),['arena-merlin-v1-R']);
});
