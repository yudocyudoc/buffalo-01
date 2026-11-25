import assert from 'node:assert/strict';
import test from 'node:test';
import {toBindingRequest,toSdkResponse} from './engine-adapter.mjs';
import {ENGINE_ALIAS,ENGINE_MAX_TOKENS} from './engine-protocol.mjs';

const messages=[{role:'system',content:'original instructions'},{role:'user',content:'original question'}];
const base={model:ENGINE_ALIAS,messages};
const schema={type:'object',properties:{discussion:{type:'string'},items:{type:'array',items:{type:'number'}}},required:['discussion','items']};

test('one common adapter passes text, JSON object, and arbitrary original schemas unchanged',()=>{
 for(const format of [undefined,{type:'json_object'},{type:'json_schema',json_schema:{name:'sdai_schema',strict:true,schema}}]){
   const request={...base,...(format?{response_format:format}:{})};
   const snapshot=structuredClone(request);
   const wire=toBindingRequest(request);
   assert.deepEqual(request,snapshot);
   assert.deepEqual(wire.messages,messages);
   assert.equal(wire.model,ENGINE_ALIAS);
   assert.equal(wire.stream,false);
   assert.equal(wire.max_completion_tokens,ENGINE_MAX_TOKENS);
   assert.deepEqual(wire.chat_template_kwargs,{enable_thinking:false});
   assert.deepEqual(wire.response_format,format?.type==='json_schema'?{type:'json_schema',json_schema:schema}:format);
 }
});
test('honor smaller output cap and clamp larger ones; fail closed on unsupported options',()=>{
 assert.equal(toBindingRequest({...base,max_completion_tokens:512}).max_completion_tokens,512);
 assert.equal(toBindingRequest({...base,max_completion_tokens:99999}).max_completion_tokens,ENGINE_MAX_TOKENS);
 for(const invalid of [{seed:1},{top_p:0.5},{stream:true},{tools:[]},{max_completion_tokens:0},
   {response_format:{type:'json_schema',json_schema:{name:'missing schema'}}},{model:'not-the-private-alias'}])
   assert.throws(()=>toBindingRequest({...base,...invalid}));
});
test('SDK envelope preserves content and observed counters; missing total alone is derived',()=>{
 const content='{"discussion":"unchanged","items":[2,4]}';
 const result={choices:[{finish_reason:'stop',message:{role:'assistant',content}}],usage:{prompt_tokens:123,completion_tokens:9,neurons:0.5}};
 const id='12345678-1234-4234-8234-123456789abc';
 const envelope=toSdkResponse(result,id);
 assert.equal(envelope.id,'buffalo-'+id);
 assert.equal(envelope.model,ENGINE_ALIAS);
 assert.equal(envelope.choices[0].message.content,content);
 assert.equal(envelope.usage.total_tokens,132);
 assert.equal(result.usage.total_tokens,undefined);
 assert.equal(toSdkResponse({...result,usage:{...result.usage,total_tokens:140}},id).usage.total_tokens,140);
 assert.throws(()=>toSdkResponse({...result,choices:[{...result.choices[0],finish_reason:'length'}]},id));
 assert.throws(()=>toSdkResponse({...result,usage:{prompt_tokens:123}},id));
});

test('SDK and gateway share the same invalid total and overflow rules',()=>{
 const result={choices:[{finish_reason:'stop',message:{role:'assistant',content:'ok'}}],usage:{prompt_tokens:123,completion_tokens:9}};
 const id='12345678-1234-4234-8234-123456789abc';
 for(const total_tokens of [-1,1.5,'132',null,Number.MAX_SAFE_INTEGER+1])
   assert.throws(()=>toSdkResponse({...result,usage:{...result.usage,total_tokens}},id),/INVALID_ENGINE_USAGE/);
 assert.throws(()=>toSdkResponse({...result,usage:{...result.usage,prompt_tokens:Number.MAX_SAFE_INTEGER}},id),/INVALID_ENGINE_USAGE/);
});
