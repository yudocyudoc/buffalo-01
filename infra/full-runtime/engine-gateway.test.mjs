import assert from 'node:assert/strict';
import test from 'node:test';
import {engineCompletion} from './engine-gateway.mjs';
import {digest} from './provider-wire.mjs';
import {ENGINE_ALIAS,ENGINE_ENDPOINT,ENGINE_MAX_TOKENS} from './engine-protocol.mjs';
import {GEMMA,GEMMA_OBSERVED_ALIAS} from '../private-merlin/gemma-response.mjs';

const schema={type:'object',properties:{answer:{type:'string'}},required:['answer']};
const invocation_id='12345678-1234-4234-8234-123456789abc';
const body={model:ENGINE_ALIAS,invocation_id,messages:[{role:'system',content:'private instruction'},{role:'user',content:'private prompt'}],
 stream:false,max_completion_tokens:ENGINE_MAX_TOKENS,response_format:{type:'json_schema',json_schema:schema}};
const req=(value=body,url=ENGINE_ENDPOINT)=>new Request(url,{method:'POST',body:JSON.stringify(value)});
const answer=()=>({model:GEMMA_OBSERVED_ALIAS,usage:{prompt_tokens:123,completion_tokens:9,neurons:0.5},
 choices:[{finish_reason:'stop',message:{role:'assistant',content:'{"answer":"private result"}'}}]});
async function run(result,request=req(),format=body.response_format){
 let initial,receipt,calls=0;
 const response=await engineCompletion(request,{run:async(model,wire)=>{
   calls++;assert.equal(model,GEMMA);
   assert.deepEqual(wire,{messages:body.messages,stream:false,max_completion_tokens:ENGINE_MAX_TOKENS,
     ...(format?{response_format:format}:{}),chat_template_kwargs:{enable_thinking:false}});
   return result();
 }},r=>{initial=r;return 1;},(id,r)=>{assert.equal(id,1);receipt=r;});
 assert.equal(calls,1);
 assert.equal(initial.status,'RESERVED');assert.equal(initial.usage,null);
 assert.equal(receipt.invocation_id,invocation_id);assert.equal(initial.invocation_id,invocation_id);
 assert.equal(receipt.request_sha256,initial.request_sha256);assert.match(receipt.request_sha256,/^[a-f0-9]{64}$/);
 assert(!JSON.stringify(receipt).includes('private'));
 return {response,receipt};
}
test('original engine uses Gemma with the bare upstream schema, not the virtual SDK alias',async()=>{
 const {response,receipt}=await run(answer);
 assert.equal(response.status,200);assert.equal(receipt.status,'OK');
 assert.equal(receipt.channel,'original-engine');
 assert.equal(receipt.schema_sha256,await digest(JSON.stringify(schema)));
 assert.equal(receipt.response_model,GEMMA_OBSERVED_ALIAS);
 assert.deepEqual((await response.json()).choices[0].message,answer().choices[0].message);
});
test('reject malformed structured responses and truncation without losing usage',async()=>{
 for(const [content,finish,failed] of [['not JSON','stop','json_valid'],['{}','length','finish_reason_valid']]){
   const {response,receipt}=await run(()=>({...answer(),choices:[{finish_reason:finish,message:{role:'assistant',content}}]}));
   assert.equal(response.status,422);assert(receipt.failed_predicates.includes(failed));
   assert.deepEqual(receipt.usage,{prompt_tokens:123,completion_tokens:9,total_tokens:null});assert.equal(receipt.neurons,0.5);
 }
});
test('reject invalid request before reserving or invoking',async()=>{
 for(const value of [{...body,invocation_id:undefined},{...body,invocation_id:'not-a-uuid'},{...body,model:GEMMA},{...body,tools:[]},{...body,stream:true},
   {...body,max_completion_tokens:ENGINE_MAX_TOKENS+1},{...body,response_format:{type:'json_schema',json_schema:{name:'wrap'},extra:true}}]){
   assert.equal((await engineCompletion(req(value),{run:assert.fail},assert.fail,assert.fail)).status,400);
 }
 assert.equal((await engineCompletion(req(body,'http://wrong/v1/engine/completions'),{run:assert.fail},assert.fail,assert.fail)).status,403);
 assert.equal((await engineCompletion(req(),{run:assert.fail},()=>false,assert.fail)).status,403);
});
test('binding failure remains a spent, diagnostic reservation',async()=>{
 const {response,receipt}=await run(()=>{throw Object.assign(Error('private failure'),{code:4001,status:503});});
 assert.equal(response.status,422);assert.equal(receipt.status,'FAILED');assert.equal(receipt.provider_code,4001);
 assert.equal(receipt.provider_http_status,503);assert.equal(receipt.usage,null);
});

const withContent=(content,usage=answer().usage)=>({...answer(),usage,
 choices:[{finish_reason:'stop',message:{role:'assistant',content}}]});
const runFormat=(format,content,usage)=>run(()=>withContent(content,usage),
 req({...body,response_format:format??undefined}),format);
test('schema mode rejects parseable objects that omit required fields or have wrong types',async()=>{
 for(const content of ['{}','{"answer":7}']){
   const {response,receipt}=await runFormat(body.response_format,content);
   assert.equal(response.status,422);assert.equal(receipt.status,'REJECTED');
   assert.equal(receipt.predicates.json_valid,true);
   assert.deepEqual(receipt.failed_predicates,['schema_valid']);
   assert.deepEqual(receipt.usage,{prompt_tokens:123,completion_tokens:9,total_tokens:null});
 }
});
test('schema mode validates root arrays, scalars, null, and local schema references',async()=>{
 const cases=[
   [{type:'array',items:{type:'number'}},'[1,2]',true],
   [{type:'array',items:{type:'number'}},'[1,"bad"]',false],
   [{type:'string'},'"private result"',true],
   [{type:'null'},'null',true],
   [{type:'object',properties:{answer:{$ref:'#/$defs/value'}},required:['answer'],
      additionalProperties:false,$defs:{value:{type:'string',enum:['yes','no']}}},'{"answer":"yes"}',true],
   [{type:'object',properties:{answer:{$ref:'#/$defs/value'}},required:['answer'],
      additionalProperties:false,$defs:{value:{type:'string',enum:['yes','no']}}},'{"answer":"wrong"}',false]
 ];
 for(const [json_schema,content,valid] of cases){
   const {response,receipt}=await runFormat({type:'json_schema',json_schema},content);
   assert.equal(response.status,valid?200:422);
   assert.equal(receipt.predicates.json_valid,true);assert.equal(receipt.predicates.schema_valid,valid);
   if(valid)assert.equal((await response.json()).choices[0].message.content,content);
 }
});
test('json_object mode requires an object but imposes no engine schema; text is unchanged',async()=>{
 for(const [format,content,valid] of [[{type:'json_object'},'{}',true],[{type:'json_object'},'[1,2]',false],
    [{type:'json_object'},'null',false],[null,'plain private text',true]]){
   const {response,receipt}=await runFormat(format,content);
   assert.equal(response.status,valid?200:422);
   assert.equal(receipt.predicates.json_object_valid,valid);
   if(!valid)assert.deepEqual(receipt.failed_predicates,['json_object_valid']);
 }
});
test('invalid supplied total rejects before an OK receipt, while other observed usage survives',async()=>{
 for(const total_tokens of [-1,1.5,'132',null,Number.MAX_SAFE_INTEGER+1]){
   const {response,receipt}=await run(()=>withContent('{"answer":"private result"}',{...answer().usage,total_tokens}));
   assert.equal(response.status,422);assert.equal(receipt.status,'REJECTED');
   assert.deepEqual(receipt.failed_predicates,['total_tokens_valid']);
   assert.deepEqual(receipt.usage,{prompt_tokens:123,completion_tokens:9,total_tokens:null});
   assert.equal(receipt.neurons,0.5);
 }
 const {response,receipt}=await run(()=>withContent('{"answer":"private result"}',
   {...answer().usage,prompt_tokens:Number.MAX_SAFE_INTEGER}));
 assert.equal(response.status,422);assert.deepEqual(receipt.failed_predicates,['total_tokens_valid']);
 assert.equal(receipt.usage.prompt_tokens,Number.MAX_SAFE_INTEGER);
});
test('valid observed total is retained; missing total is not falsely attributed to binding',async()=>{
 for(const total of [undefined,132,140]){
   const {response,receipt}=await run(()=>withContent('{"answer":"private result"}',{...answer().usage,total_tokens:total}));
   assert.equal(response.status,200);assert.equal(receipt.status,'OK');
   assert.equal(receipt.usage.total_tokens,total??null);
   assert.equal((await response.json()).usage.total_tokens,total);
 }
});
