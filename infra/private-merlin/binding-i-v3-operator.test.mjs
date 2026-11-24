import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {groups} from '../../evals/categories/policyImplementation.js';
import {MODEL,CONFIG_HASH,digest} from './protocol.mjs';
import {ID as R_ID,PASS as R_PASS} from './r-operator.mjs';
import {ID,PASS,SOURCE,IMAGE,LIMITS,runPrivateI,checkHistoricalR,checkIPass,exactGrant,FAILED_ID,FAILED_TASK,checkPriorFailure,BINDING_FAILED_ID,BINDING_FAILED_TASK,PROBE_ID,PROBE_TASK,checkProbe} from './binding-i-v3-operator.mjs';
import {configurations} from './manual-binding-i-v3.mjs';
import captured from './fixtures/gemma-native-contract-45496578147.json' with {type:'json'};
import {INPUT as PROBE_INPUT,responseChecks} from './gemma-contract-probe.mjs';
import {responsePredicates} from './gemma-response.mjs';
const model=JSON.stringify(groups.policyImplementation.find(x=>x.expectations.scenario==='dialysisClinic').currentModel);
const g={phase:'I',task_id:'58532b8a-b25e-4b67-a90b-10db57da263b',project_id:'arena-igc',model_sha256:MODEL,source_commit:SOURCE,image_digest:IMAGE,expires:Date.now()+600000,...LIMITS};
const prior={phase:'R',task_id:'195c2f57-fbe7-4dd9-8708-742bc9ef79f7',project_id:g.project_id,model_sha256:MODEL,source_commit:SOURCE,image_digest:IMAGE,expires:0};
const proof={source_commit:SOURCE,agent_config_sha256:CONFIG_HASH,model_sha256:MODEL,spawn_calls:1,shutdown_ipc_sent:true,exit:{code:0,signal:null},session_id:'sess_'+'c'.repeat(32),worker_frames:['get_current_model','error','agent_complete']};
const common={source_commit:SOURCE,image_digest:IMAGE,container_stopped:true,intercepts_registered:true,internet_enabled_config:false};
const rTask={...prior,status:R_PASS,receipt:{...common,phase:'R',task_id:prior.task_id,status:R_PASS,posts:0,egress_attempts:0,output:null,proof,frames:['session_created','session_ready','agent_selected','agent_text','get_current_model','error','agent_complete']}};
const historical={probe_id:R_ID,run_id:prior.task_id,status:R_PASS,receipt_json:JSON.stringify({probe_id:R_ID,run_id:prior.task_id,status:R_PASS,source_commit:SOURCE,image_digest:IMAGE,approval:prior,task:rTask,inference_authorized:false,egress_independently_measured:false})};
const failed={probe_id:FAILED_ID,run_id:FAILED_TASK,status:'RUNTIME_FAILURE',receipt_json:JSON.stringify({probe_id:FAILED_ID,run_id:FAILED_TASK,status:'RUNTIME_FAILURE',source_commit:SOURCE,image_digest:IMAGE,inference_authorized:true,task:{task_id:FAILED_TASK,status:'RUNTIME_FAILURE',error:'WS_INCOMPLETE',receipt:{task_id:FAILED_TASK,posts:1,egress_attempts:1,container_stopped:true,usage:null,output:null}}})};
const bindingFailed={probe_id:BINDING_FAILED_ID,run_id:BINDING_FAILED_TASK,status:'RUNTIME_FAILURE',receipt_json:JSON.stringify({probe_id:BINDING_FAILED_ID,run_id:BINDING_FAILED_TASK,status:'RUNTIME_FAILURE',task:{receipt:{task_id:BINDING_FAILED_TASK,posts:1,egress_attempts:2,provider_model:LIMITS.provider_model,container_stopped:true,provider_diagnostic:{stage:'RESPONSE',status:'FAILED'},usage:{prompt_tokens:6904,completion_tokens:311},finish_reason:'stop'}}})};
const probe={probe_id:PROBE_ID,run_id:PROBE_TASK,status:'RESPONSE_CAPTURED',receipt_json:JSON.stringify({probe_id:PROBE_ID,run_id:PROBE_TASK,status:'RESPONSE_CAPTURED',approval:{task_id:PROBE_TASK,source_commit:'c47ba78aece52c613487e7fdb052440ad2b639f6',model:LIMITS.provider_model,max_calls:1,max_output_tokens:32},reserved_calls:1,request:PROBE_INPUT,response:captured,response_bytes:390,checks:responseChecks(captured),usage:{prompt_tokens:28,completion_tokens:2}})};
const output='<p>Offline fixture, not real inference.</p>';
const pass={...g,approval:g,status:PASS,receipt:{...common,approval:g,phase:'I',task_id:g.task_id,status:PASS,posts:1,egress_attempts:1,provider_model:LIMITS.provider_model,finish_reason:'stop',provider_diagnostic:{transport:'binding-v3',stage:'COMPLETE',status:'OK',response_model:captured.model,predicates:responsePredicates(captured,2048,true),failed_predicates:[]},usage:{prompt_tokens:1500,completion_tokens:100},output,proof:{...proof,worker_frames:['get_current_model','agent_text','agent_complete'],output_sha256:await digest(output)},frames:['session_created','session_ready','agent_selected','agent_text','get_current_model','agent_text','agent_complete']}};
function fixture({submitFails=false,previous=historical,previousFailed=failed,previousBindingFailed=bindingFailed,previousProbe=probe}={}){
 let row=null,task=null,submits=0;
 const db={prepare(sql){return {bind(...a){return {first:async()=>a[0]===R_ID?structuredClone(previous):a[0]===FAILED_ID?structuredClone(previousFailed):a[0]===BINDING_FAILED_ID?structuredClone(previousBindingFailed):a[0]===PROBE_ID?structuredClone(previousProbe):row&&structuredClone(row),run:async()=>{
  if(sql.startsWith('INSERT')){assert.equal(a[0],ID);if(row)return {meta:{changes:0}};row={run_id:a[1],status:a[2],receipt_json:a[3]};return {meta:{changes:1}}}
  assert.equal(a[2],ID);assert.equal(a[3],row.run_id);if(row.status!==a[4])return {meta:{changes:0}};
  row={...row,status:a[0],receipt_json:a[1]};return {meta:{changes:1}};
 }}}}}};
 const env={DB:db,MERLIN_I_TRANSPORT:'binding-v3',MERLIN_GRANT:JSON.stringify(g),MERLIN_SD_JSON:model,MERLIN:{
  submit:async input=>{submits++;assert.equal(input.sd_json,model);task={...g,status:'QUEUED'};if(submitFails)throw Error('ambiguous');return task},
  read:async key=>{assert.equal(key.task_id,g.task_id);return task}
 }};
 return {env,row:()=>row,submits:()=>submits,terminal:x=>{task=x}};
}
test('historical remote R is required; wrong image or invalid proof cannot authorize I',()=>{
 assert.equal(checkHistoricalR(historical).status,R_PASS);
 for(const modify of [x=>{x.image_digest='sha256:'+'0'.repeat(64)},x=>{x.task.receipt.posts=1},x=>{x.task.receipt.proof.exit.code=137}]){
  const x=JSON.parse(historical.receipt_json);modify(x);assert.throws(()=>checkHistoricalR({...historical,receipt_json:JSON.stringify(x)}));
 }
});
test('exact Gemma limits and R image, alternate model or expanded budget refused',()=>{
 assert(exactGrant(g));
 for(const x of [{provider_model:'@cf/thinkingmachines/inkling-2-small'},{max_posts:2},{max_input_bytes:131073},{max_output_tokens:2049},{source_commit:'a'.repeat(40)}])assert.throws(()=>exactGrant({...g,...x}));
});
test('one I claim, ambiguous submit never replayed, terminal usage and output recovered',async()=>{
 const f=fixture({submitFails:true});await Promise.all([runPrivateI(f.env),runPrivateI(f.env)]);
 assert.equal(f.submits(),1);assert.equal(f.row().status,'CLAIMED');
 f.terminal(pass);await runPrivateI(f.env);assert.equal(f.row().status,PASS);
 assert.equal(JSON.parse(f.row().receipt_json).task.receipt.usage.completion_tokens,100);
 await runPrivateI(f.env);assert.equal(f.submits(),1);
});
test('no R, expired I, altered budget and disarmed operator never submit',async()=>{
 for(const [override,previous,throws] of [[{MERLIN_GRANT:'null'},historical,false],[{MERLIN_GRANT:JSON.stringify({...g,expires:0})},historical,true],[{MERLIN_GRANT:JSON.stringify({...g,max_output_tokens:100})},historical,true],[{},null,true]]){
  const f=fixture({previous});const p=runPrivateI({...f.env,...override});if(throws)await assert.rejects(p);else await p;
  assert.equal(f.submits(),0);assert.equal(f.row(),null);
 }
});
test('I receipt cannot pass with wrong output hash, budget, usage, model or shutdown',async()=>{
 assert(await checkIPass(pass,g));
 for(const modify of [x=>{x.receipt.output+='x'},x=>{x.receipt.usage.completion_tokens=2049},x=>{x.receipt.usage=null},x=>{x.receipt.provider_model='other'},x=>{x.receipt.posts=2},x=>{x.receipt.proof.exit.signal='SIGKILL'},x=>{x.receipt.finish_reason='length'}]){
  const x=structuredClone(pass);modify(x);await assert.rejects(checkIPass(x,g));
 }
 const f=fixture();await runPrivateI(f.env);const bad=structuredClone(pass);bad.receipt.usage=null;f.terminal(bad);await runPrivateI(f.env);assert.equal(f.row().status,'INVALID_REMOTE_RECEIPT');assert.equal(f.submits(),1);
});
test('I armed configs use pinned R image and restore original disabled R operator',()=>{
 const load=n=>JSON.parse(readFileSync(new URL(n,import.meta.url)));
 const {armed,disabled,g:actual}=configurations({router:load('./wrangler.router.template.json'),bridge:load('./wrangler.bridge.jsonc'),operator:load('./wrangler.r-operator.template.json'),task:g.task_id,model,expires:g.expires});
 assert.deepEqual(actual,g);assert.equal(armed.operator.main,'binding-i-v3-operator.mjs');assert.equal(disabled.operator.main,'r-operator.mjs');
 for(const c of Object.values(disabled)){assert.equal(c.vars.MERLIN_GRANT,'null');assert.equal(c.workers_dev,false);assert.deepEqual(c.triggers.crons,[])}
 for(const c of Object.values(armed))assert.deepEqual(JSON.parse(c.vars.MERLIN_GRANT),g);
 assert(armed.router.containers[0].images.base.image.endsWith('@'+IMAGE));assert.deepEqual(armed.operator.triggers.crons,['* * * * *']);assert.deepEqual(armed.router.triggers.crons,[]);assert.deepEqual(armed.bridge.triggers.crons,[]);
 assert(!JSON.stringify(armed).includes('MERLIN_AI_TOKEN'));
 assert.deepEqual(armed.router.ai,{binding:'AI'});assert(!armed.bridge.ai&&!armed.operator.ai);
 for(const c of Object.values(armed))assert.equal(c.vars.MERLIN_I_TRANSPORT,'binding-v3');
 for(const c of Object.values(disabled)){assert(!c.ai);assert(!c.vars.MERLIN_I_TRANSPORT)}
});

test('failed REST attempt must exist and remain spent; new I uses a distinct ledger',async()=>{
 assert.equal(checkPriorFailure(failed).run_id,FAILED_TASK);assert.notEqual(ID,FAILED_ID);
 const f=fixture({previousFailed:null});await assert.rejects(runPrivateI(f.env),/I_V1_FAILURE_REQUIRED/);assert.equal(f.submits(),0);
 const changed=JSON.parse(failed.receipt_json);changed.task.receipt.posts=0;
 assert.throws(()=>checkPriorFailure({...failed,receipt_json:JSON.stringify(changed)}));
 const missingDiagnostic=structuredClone(pass);delete missingDiagnostic.receipt.provider_diagnostic;
 await assert.rejects(checkIPass(missingDiagnostic,g));
});

test('v3 requires exact captured microprobe and spent binding v2 before submitting',async()=>{
 assert.equal(checkProbe(probe).run_id,PROBE_TASK);
 for(const [opts,err] of [[{previousProbe:null},/GEMMA_PROBE_REQUIRED/],[{previousBindingFailed:null},/BINDING_I_FAILURE_REQUIRED/]]){
  const f=fixture(opts);await assert.rejects(runPrivateI(f.env),err);assert.equal(f.submits(),0);
 }
 const changed=JSON.parse(probe.receipt_json);changed.response.model='other';assert.throws(()=>checkProbe({...probe,receipt_json:JSON.stringify(changed)}));
 const wrong=structuredClone(pass);wrong.receipt.provider_diagnostic.response_model='other';await assert.rejects(checkIPass(wrong,g));
 const bad=structuredClone(pass);bad.receipt.provider_diagnostic.predicates.model_accepted=false;await assert.rejects(checkIPass(bad,g));
});
