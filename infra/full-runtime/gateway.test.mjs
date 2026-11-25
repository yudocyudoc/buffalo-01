import assert from 'node:assert/strict';
import test from 'node:test';
import {completion,MODEL_TOOLS} from './gateway.mjs';
import {GEMMA,GEMMA_OBSERVED_ALIAS} from '../private-merlin/gemma-response.mjs';
import {ENDPOINT} from '../private-merlin/protocol.mjs';

const tool=name=>({type:'function',function:{name,parameters:{type:'object'}}});
const req=()=>new Request(ENDPOINT,{method:'POST',body:JSON.stringify({model:GEMMA,
  messages:[{role:'user',content:'private prompt'}],tools:[tool('edit_variables'),tool('write_file')]})});
const textResponse=()=>({model:GEMMA_OBSERVED_ALIAS,usage:{prompt_tokens:9,completion_tokens:4,neurons:0.5},
  choices:[{finish_reason:'stop',message:{role:'assistant',content:'private reply'}}]});
async function invoke(run){
  let receipt;
  const response=await completion(req(),{run},initial=>{
    assert.equal(initial.status,'RESERVED');
    assert.equal(initial.usage,null);
    return 7;
  },(attempt,result)=>{
    assert.equal(attempt,7);
    receipt=result;
  });
  assert(receipt.request_bytes>0 && receipt.elapsed_ms>=0);
  assert(!JSON.stringify(receipt).includes('private'));
  return {response,receipt};
}
test('a denied reservation never reaches the binding or records a response',async()=>{
  assert.equal((await completion(req(),{run:()=>assert.fail()},()=>false,assert.fail)).status,403);
});
test('rejected tool calls preserve usage and identify the failed checks',async()=>{
  for(const [name,args,failed] of [['write_file','{}','tools_offered'],['edit_variables','[]','tool_arguments_valid'],
    ['edit_variables','private malformed arguments','tool_arguments_valid']]){
    const {response,receipt}=await invoke(async(model,wire)=>{
      assert.deepEqual(wire.tools.map(t=>t.function.name),['edit_variables']);
      return {...textResponse(),choices:[{finish_reason:'tool_calls',
        message:{role:'assistant',tool_calls:[{id:'private id',type:'function',function:{name,arguments:args}}]}}]};
    });
    assert.equal(response.status,422);
    assert.deepEqual(receipt.failed_predicates,[failed]);
    assert.equal(receipt.finish_reason,'tool_calls');
    assert.equal(receipt.response_model,GEMMA_OBSERVED_ALIAS);
    assert.deepEqual(receipt.usage,{prompt_tokens:9,completion_tokens:4});
    assert.equal(receipt.neurons,0.5);
  }
});
test('a truncated response retains independent observed counters, including over-budget output',async()=>{
  const result=textResponse();
  result.model='private model';
  result.choices[0].finish_reason='length';
  result.usage={completion_tokens:2051};
  const {response,receipt}=await invoke(()=>result);
  assert.equal(response.status,422);
  assert.equal(receipt.response_model,null);
  assert.equal(receipt.finish_reason,'length');
  assert.equal(receipt.status,'REJECTED');
  assert.deepEqual(receipt.usage,{prompt_tokens:null,completion_tokens:2051});
  assert.equal(receipt.neurons,null);
  assert.deepEqual(receipt.failed_predicates.sort(),
    ['completion_tokens_valid','finish_reason_valid','model_accepted','prompt_tokens_valid']);
});
test('a binding exception records only bounded provider metadata and consumes one attempt',async()=>{
  let calls=0;
  const {response,receipt}=await invoke(()=>{calls++;throw Object.assign(Error('private error'),{code:'123',status:503});});
  assert.equal(calls,1);
  assert.equal(response.status,422);
  assert.equal(receipt.reason,'AI_BINDING_EXCEPTION');
  assert.equal(receipt.provider_code,123);
  assert.equal(receipt.provider_http_status,503);
  assert.equal(receipt.usage,null);
});
test('accepted text and correlated tool responses pass through after recording',async()=>{
  for(const finish of ['stop','tool_calls']){
    const result=textResponse();
    if(finish==='tool_calls')result.choices=[{finish_reason:finish,message:{role:'assistant',content:null,
      tool_calls:[{id:'private id',type:'function',function:{name:'edit_variables',arguments:'{}'}}]}}];
    const {response,receipt}=await invoke(()=>result);
    assert.equal(response.status,200);
    assert.equal(receipt.status,'OK');
    assert.deepEqual(receipt.failed_predicates,[]);
    assert.deepEqual((await response.json()).choices[0].message,result.choices[0].message);
  }
});

test('all seven editing and four simulation/data tools preserve original offered schemas; no other tools added',async()=>{
 const names=['get_current_model','read_model_section','edit_variables','edit_relationships','edit_specs','edit_modules','update_model','run_model','get_run_info','get_variable_data','read_file'];
 assert.deepEqual([...MODEL_TOOLS],names);
 const definitions=names.map(name=>({type:'function',function:{name,description:'original '+name,parameters:{type:'object',properties:{value:{type:'number'}}}}}));
 const request=new Request(ENDPOINT,{method:'POST',body:JSON.stringify({model:GEMMA,messages:[{role:'user',content:'test'}],tools:[...definitions,tool('write_file'),tool('generate_quantitative_model')]})});
 const response=await completion(request,{run:async(_model,wire)=>{
  assert.deepEqual(wire.tools,definitions);
  return {...textResponse(),choices:[{finish_reason:'tool_calls',message:{role:'assistant',tool_calls:[{type:'function',id:'simulation',function:{name:'run_model',arguments:'{}'}}]}}]};
 }},()=>1,()=>{});
 assert.equal(response.status,200);
});
test('a transport-supported tool not offered by the original session is still rejected',async()=>{
 const {response,receipt}=await invoke(()=>({...textResponse(),choices:[{finish_reason:'tool_calls',message:{role:'assistant',tool_calls:[{type:'function',id:'x',function:{name:'run_model',arguments:'{}'}}]}}]}));
 assert.equal(response.status,422);assert.deepEqual(receipt.failed_predicates,['tools_offered']);
});

test('generation requires engine permission and the specific original tool offered by the session',async()=>{
 for(const [offered,chosen,enabled,status] of [
   ['generate_quantitative_model','generate_quantitative_model',true,200],
   ['generate_qualitative_model','generate_qualitative_model',true,200],
   ['generate_qualitative_model','generate_qualitative_model',false,422],
   ['generate_quantitative_model','generate_quantitative_model',false,422],
   ['generate_quantitative_model','generate_qualitative_model',true,422]
 ]){
   const generation=tool(offered);
   const request=new Request(ENDPOINT,{method:'POST',body:JSON.stringify({model:GEMMA,messages:[{role:'user',content:'test'}],tools:[generation,tool('write_file')]})});
   const response=await completion(request,{run:async(_model,wire)=>{
     assert.deepEqual(wire.tools,enabled?[generation]:undefined);
     return {...textResponse(),choices:[{finish_reason:'tool_calls',message:{role:'assistant',tool_calls:[{type:'function',id:'g',function:{name:chosen,arguments:'{}'}}]}}]};
   }},()=>1,()=>{},{engineEnabled:enabled});
   assert.equal(response.status,status);
 }
});
