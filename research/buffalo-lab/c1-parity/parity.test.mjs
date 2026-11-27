import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {completion} from '../../../infra/full-runtime/gateway.mjs';
import {ENDPOINT} from '../../../infra/private-merlin/protocol.mjs';
import {GEMMA} from '../../../infra/private-merlin/gemma-response.mjs';
import {createDiscussModelWithSeldonTool} from '../../../agent/tools/builtin/discussModelWithSeldon.js';
import {LLMWrapper} from '../../../utilities/LLMWrapper.js';
import {z} from 'zod';

const name='discuss_model_with_seldon';
const prompt='Explain why Inventory oscillates.';
const tool=(name,parameters={type:'object'})=>({type:'function',function:{name,description:'controlled '+name,parameters}});
const names=['get_feedback_information','generate_ltm_narrative',name,'discuss_model_across_runs','client_run_sensitivity','write_file'];
const answer=(chosen)=>({model:GEMMA,usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30},choices:[{finish_reason:chosen?'tool_calls':'stop',message:chosen?{role:'assistant',content:null,tool_calls:[{id:'controlled-1',type:'function',function:{name:chosen,arguments:JSON.stringify({prompt,difficulty:'normal',parameters:{runIds:['run-A']}})}}]}:{role:'assistant',content:'controlled final'}}]});
async function invoke({opts={},tools=names.map(n=>tool(n)),chosen=name,messages=[{role:'user',content:prompt}],deny=false,fail=false}={}){
 let offered=[],wire,calls=0,reservations=0,receipts=[];
 const response=await completion(new Request(ENDPOINT,{method:'POST',body:JSON.stringify({model:GEMMA,messages,tools})}),{run:async(_,w)=>{calls++;wire=structuredClone(w);offered=w.tools?.map(t=>t.function.name)??[];if(fail)throw Object.assign(Error('controlled'),{status:503});return answer(chosen)}},()=>{reservations++;return deny?false:1},(_,r)=>receipts.push(r),opts);
 return {response,offered,wire,calls,reservations,receipts};
}
test('default and engine grant alone preserve ceiling; exact opt-in admits only Seldon',async()=>{
 for(const [opts,expected,status] of [
 [{},['get_feedback_information'],422],
 [{paritySeldonEnabled:true},['get_feedback_information'],422],
 [{engineEnabled:true},['get_feedback_information','generate_ltm_narrative'],422],
 [{engineEnabled:true,paritySeldonEnabled:'true'},['get_feedback_information','generate_ltm_narrative'],422],
 [{engineEnabled:true,paritySeldonEnabled:true},['get_feedback_information','generate_ltm_narrative',name],200]]){
  const r=await invoke({opts});assert.deepEqual(r.offered,expected);assert.equal(r.response.status,status);assert.equal(r.calls,1);assert.equal(r.reservations,1);
  if(status===422)assert.deepEqual(r.receipts[0].failed_predicates,['tools_offered']);
 }
});
test('opt-in does not inject an absent tool or admit other client/file tools',async()=>{
 const opts={engineEnabled:true,paritySeldonEnabled:true};
 const a=await invoke({opts,tools:[tool('get_feedback_information')]});assert.equal(a.response.status,422);
 for(const chosen of ['discuss_model_across_runs','client_run_sensitivity','write_file']){
  const r=await invoke({opts,chosen});assert.equal(r.response.status,422);assert.deepEqual(r.receipts[0].failed_predicates,['tools_offered']);
 }
});
test('budget denial, oversize and provider error remain fail closed and never retry',async()=>{
 const opts={engineEnabled:true,paritySeldonEnabled:true};
 const a=await invoke({opts,deny:true});assert.equal(a.response.status,403);assert.equal(a.calls,0);
 const b=await invoke({opts,messages:[{role:'user',content:'x'.repeat(140000)}]});assert.equal(b.response.status,413);assert.equal(b.calls,0);assert.equal(b.reservations,0);
 const c=await invoke({opts,fail:true});assert.equal(c.response.status,422);assert.equal(c.calls,1);assert.equal(c.receipts[0].provider_http_status,503);
});
test('gateway accepts actual Seldon schema; original handler consumes matched cache and returns marker for synthesis',async()=>{
 const fixture=JSON.parse(readFileSync(new URL('../../../evals/categories/feedbackExplanationData/inventoryWorkforce.json',import.meta.url)));
 const dir=mkdtempSync(join(tmpdir(),'c1-parity-'));
 const old=LLMWrapper.prototype.createChatCompletion;
 let messages;
 try{
  // Historical feedback is frozen; the two-sample behavior marker is synthetic,
  // never represented as the historical trajectory or as a mathematical result.
  writeFileSync(join(dir,'feedback.json'),JSON.stringify({runIds:['run-A'],feedbackContent:fixture.feedback}));
  writeFileSync(join(dir,'variable_data_0001.json'),JSON.stringify({'run-A':{time:[0,1],C1_PARITY_SYNTHETIC:[1,2]}}));
  const manager={getSession:()=>({clientId:'offline',agentName:'merlin'}),getClientModel:()=>structuredClone(fixture.model),getSessionTempDir:()=>dir};
  const handler=createDiscussModelWithSeldonTool(manager,'offline',()=>assert.fail('unexpected client request'),{provider:'google',toolModels:{nonBuild:{normal:'gemini-3.8-flash',hard:'gemini-3.8-flash'}}});
  const definition={type:'function',function:{name,description:handler.description,parameters:z.toJSONSchema(handler.inputSchema)}};
  const opts={engineEnabled:true,paritySeldonEnabled:true};
  const a=await invoke({opts,tools:[definition]});
  assert.equal(a.response.status,200);assert.deepEqual(a.wire.tools,[definition]);
  LLMWrapper.prototype.createChatCompletion=async function(m,model,schema){
   assert.equal(messages,undefined,'unexpected second engine invocation');messages=structuredClone(m);
   const parsed={response:'C1_PARITY_NESTED_MARKER',feedbackInformationRequired:false};
   assert(schema.safeParse(parsed).success);return {parsed};
  };
  const c=(await a.response.json()).choices[0].message.tool_calls[0];
  const args=handler.inputSchema.parse(JSON.parse(c.function.arguments));
  const result=await handler.handler(args);
  assert.equal(result.isError,false,JSON.stringify(result));
  assert(messages.some(m=>m.content.includes('C1_PARITY_SYNTHETIC')));
  assert(messages.some(m=>m.content.includes('feedbackLoops')));
  assert(JSON.stringify(result).includes('C1_PARITY_NESTED_MARKER'));
  const b=await invoke({opts,tools:[definition],chosen:null,messages:[{role:'user',content:prompt},{role:'assistant',content:null,tool_calls:[c]},{role:'tool',tool_call_id:c.id,content:JSON.stringify(result)}]});
  assert.equal(b.response.status,200);
  assert(b.wire.messages.at(-1).content.includes('C1_PARITY_NESTED_MARKER'));
  assert.equal((await b.response.json()).choices[0].message.content,'controlled final');
 }finally{LLMWrapper.prototype.createChatCompletion=old;rmSync(dir,{recursive:true,force:true});}
});
