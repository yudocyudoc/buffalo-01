import test from 'node:test';
import assert from 'node:assert/strict';
import {ID,FAILED_ID,FAILED_TASK,MODEL,INPUT,responseChecks,runProbe} from './gemma-contract-probe.mjs';
const prior={probe_id:FAILED_ID,run_id:FAILED_TASK,status:'RUNTIME_FAILURE',receipt_json:JSON.stringify({probe_id:FAILED_ID,run_id:FAILED_TASK,status:'RUNTIME_FAILURE',task:{receipt:{task_id:FAILED_TASK,posts:1,egress_attempts:2,provider_model:MODEL,container_stopped:true,provider_diagnostic:{stage:'RESPONSE',status:'FAILED'},usage:{prompt_tokens:6904,completion_tokens:311},finish_reason:'stop'}}})};
const grant={task_id:'12345678-1234-4123-8123-123456789abc',source_commit:'a'.repeat(40),model:MODEL,max_calls:1,max_output_tokens:32,expires:Date.now()+600000};
function fixture(result,previous=prior){
 let row=null,calls=0;
 const env={GEMMA_PROBE_GRANT:JSON.stringify(grant),AI:{run:async(model,input)=>{calls++;assert.equal(model,MODEL);assert.deepEqual(input,INPUT);if(result instanceof Error)throw result;return result;}},DB:{prepare(sql){return {bind(...a){return {first:async()=>previous,run:async()=>{
 if(sql.startsWith('INSERT')){assert.equal(a[0],ID);if(row)return {meta:{changes:0}};row={status:a[2],receipt:JSON.parse(a[3])};return {meta:{changes:1}}}
 assert.equal(a[2],ID);assert.equal(a[3],grant.task_id);assert.equal(row.status,'CLAIMED');row={status:a[0],receipt:JSON.parse(a[1])};return {meta:{changes:1}}
 }}}}}}};
 return {env,calls:()=>calls,row:()=>row};
}
const response={model:'gemma-example-alias',choices:[{finish_reason:'stop',message:{role:'assistant',content:[{type:'text',text:'OK'}]}}],usage:{prompt_tokens:20,completion_tokens:2}};
test('capture response unchanged even if old validator rejects it; one concurrent winner',async()=>{
 const f=fixture(response);await Promise.all([runProbe(f.env),runProbe(f.env),runProbe(f.env)]);
 assert.equal(f.calls(),1);assert.equal(f.row().status,'RESPONSE_CAPTURED');assert.deepEqual(f.row().receipt.response,response);
 assert.equal(f.row().receipt.checks.model_exact,false);assert.equal(f.row().receipt.checks.content_string,false);assert.equal(f.row().receipt.checks.stop,true);
 await runProbe(f.env);assert.equal(f.calls(),1);
});
test('expired, disarmed, expanded budget or missing binding cannot run',async()=>{
 for(const patch of [{GEMMA_PROBE_GRANT:'null'},{GEMMA_PROBE_GRANT:JSON.stringify({...grant,expires:0})},{GEMMA_PROBE_GRANT:JSON.stringify({...grant,max_output_tokens:33})},{AI:undefined}]){
  const f=fixture(response);await runProbe({...f.env,...patch});assert.equal(f.calls(),0);assert.equal(f.row(),null);
 }
 const f=fixture(response,null);await assert.rejects(runProbe(f.env),/BINDING_I_FAILURE_REQUIRED/);assert.equal(f.calls(),0);
});
test('provider error stays spent; no raw error text or repeat',async()=>{
 const f=fixture(Object.assign(new Error('private message'),{code:3040,status:429}));await runProbe(f.env);await runProbe(f.env);
 assert.equal(f.calls(),1);assert.equal(f.row().status,'PROVIDER_FAILURE');assert.equal(f.row().receipt.provider_code,3040);assert(!JSON.stringify(f.row()).includes('private message'));
});
test('oversized response bounded and not mistaken for a captured object',async()=>{
 const f=fixture({...response,other:'x'.repeat(17000)});await runProbe(f.env);
 assert.equal(f.row().status,'RESPONSE_UNCAPTURED');assert.equal(f.row().receipt.response,null);assert.deepEqual(f.row().receipt.usage,response.usage);
});
