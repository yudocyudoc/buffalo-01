import assert from 'node:assert/strict';
import test from 'node:test';
import {completion} from './gateway.mjs';
import {GEMMA} from '../private-merlin/gemma-response.mjs';
import {ENDPOINT} from '../private-merlin/protocol.mjs';

const tool=name=>({type:'function',function:{name,parameters:{type:'object'}}});
const req=()=>new Request(ENDPOINT,{method:'POST',body:JSON.stringify({model:GEMMA,
  messages:[{role:'user',content:'Edit my variable'}],tools:[tool('edit_variables'),tool('write_file')]})});
test('a denied reservation never reaches the binding',async()=>{
  assert.equal((await completion(req(),{run:()=>assert.fail()},()=>false)).status,403);
});
test('a tool must occur in the actual allowlisted request and have valid object arguments',async()=>{
  for(const [name,args] of [['write_file','{}'],['edit_variables','[]'],['edit_variables','broken']]){
    const ai={run:async(model,wire)=>{
      assert.deepEqual(wire.tools.map(t=>t.function.name),['edit_variables']);
      return {model,usage:{prompt_tokens:9,completion_tokens:4},choices:[{finish_reason:'tool_calls',
        message:{role:'assistant',tool_calls:[{id:'x',type:'function',function:{name,arguments:args}}]}}]};
    }};
    assert.equal((await completion(req(),ai,()=>true)).status,422);
  }
});
test('provider exceptions consume the attempt and return a non-retryable SDK status',async()=>{
  let calls=0;
  assert.equal((await completion(req(),{run:async()=>{calls++;throw Error('unavailable');}},()=>true)).status,422);
  assert.equal(calls,1);
});
