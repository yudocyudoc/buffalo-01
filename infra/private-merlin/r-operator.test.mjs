import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {groups} from '../../evals/categories/policyImplementation.js';
import {ID,PASS,runPrivateR,checkRemotePass} from './r-operator.mjs';
import {MODEL,CONFIG_HASH} from './protocol.mjs';
import {configurations,checkR2Row} from './manual-r.mjs';
const model=JSON.stringify(groups.policyImplementation.find(x=>x.expectations.scenario==='dialysisClinic').currentModel);
const g={phase:'R',task_id:'58532b8a-b25e-4b67-a90b-10db57da263b',project_id:'arena-igc',model_sha256:MODEL,source_commit:'a'.repeat(40),image_digest:'sha256:'+'b'.repeat(64),expires:Date.now()+600000};
const proof={source_commit:g.source_commit,agent_config_sha256:CONFIG_HASH,model_sha256:MODEL,spawn_calls:1,shutdown_ipc_sent:true,exit:{code:0,signal:null},session_id:'sess_'+'c'.repeat(32),worker_frames:['get_current_model','error','agent_complete']};
const pass={...g,status:PASS,receipt:{phase:'R',task_id:g.task_id,source_commit:g.source_commit,image_digest:g.image_digest,status:PASS,posts:0,egress_attempts:0,container_stopped:true,intercepts_registered:true,internet_enabled_config:false,output:null,proof,frames:['session_created','session_ready','agent_selected','agent_text','get_current_model','error','agent_complete']}};
function fixture({submitFails=false}={}){
 let row=null,task=null,submits=0,reads=0;
 const db={prepare(sql){return {bind(...a){return {first:async()=>row&&structuredClone(row),run:async()=>{
  if(sql.startsWith('INSERT')){assert.equal(a[0],ID);if(row)return {meta:{changes:0}};row={run_id:a[1],status:a[2],receipt_json:a[3]};return {meta:{changes:1}}}
  assert.equal(a[2],ID);assert.equal(a[3],row.run_id);if(row.status!==a[4])return {meta:{changes:0}};
  row={...row,status:a[0],receipt_json:a[1]};return {meta:{changes:1}};
 }}}}}};
 const env={DB:db,MERLIN_GRANT:JSON.stringify(g),MERLIN_SD_JSON:model,MERLIN:{
  submit:async input=>{submits++;assert.equal(input.sd_json,model);task={...g,status:'QUEUED'};if(submitFails)throw Error('ambiguous');return task},
  read:async key=>{reads++;assert.equal(key.task_id,g.task_id);return task}
 }};
 return {env,row:()=>row,counts:()=>({submits,reads}),terminal:x=>{task=x}};
}
test('R grant and exact model, one claim under concurrent ticks; subsequent ticks only read',async()=>{
 const f=fixture({submitFails:true});await Promise.all([runPrivateR(f.env),runPrivateR(f.env)]);
 assert.equal(f.counts().submits,1);assert.equal(f.row().status,'CLAIMED');
 f.terminal(pass);await runPrivateR(f.env);assert.equal(f.row().status,PASS);
 assert.equal(JSON.parse(f.row().receipt_json).egress_independently_measured,false);
 await runPrivateR(f.env);assert.equal(f.counts().submits,1);
});
test('disarmed, expired, changed model and I grant cannot submit',async()=>{
 for(const [changes,throws] of [[{MERLIN_GRANT:'null'},false],[{MERLIN_GRANT:JSON.stringify({...g,expires:0})},true],[{MERLIN_SD_JSON:'{}'},true],[{MERLIN_GRANT:JSON.stringify({...g,phase:'I'})},true]]){
  const f=fixture();const p=runPrivateR({...f.env,...changes});if(throws)await assert.rejects(p);else await p;
  assert.equal(f.counts().submits,0);assert.equal(f.row(),null);
 }
});
test('remote PASS requires real identity, exact frames, closure and zero intercepted requests/posts',async()=>{
 assert(checkRemotePass(pass,g));
 for(const change of [x=>{x.receipt.posts=1},x=>{x.receipt.egress_attempts=1},x=>{x.receipt.intercepts_registered=false},x=>{x.receipt.container_stopped=false},x=>{x.receipt.proof.exit.code=137},x=>{x.receipt.proof.shutdown_ipc_sent=false},x=>{x.task_id=crypto.randomUUID()}]){
  const x=structuredClone(pass);change(x);assert.throws(()=>checkRemotePass(x,g));
 }
 const f=fixture();await runPrivateR(f.env);const bad=structuredClone(pass);bad.receipt.posts=1;f.terminal(bad);await runPrivateR(f.env);assert.equal(f.row().status,'INVALID_REMOTE_RECEIPT');
});
test('configuration generation exact model and grant, only operator cron, disabled has no grant or model',()=>{
 const load=n=>JSON.parse(readFileSync(new URL(n,import.meta.url)));
 const input={router:load('./wrangler.router.template.json'),bridge:load('./wrangler.bridge.jsonc'),operator:load('./wrangler.r-operator.template.json'),
  ref:'registry.cloudflare.com/e0cb52526a69c0f48f001901a5b9a640/buffalo-merlin-private-origin@'+g.image_digest,source:g.source_commit,task:g.task_id,model,expires:g.expires};
 const {armed,disabled}=configurations(input);
 assert.deepEqual(armed.operator.triggers.crons,['* * * * *']);assert.deepEqual(armed.router.triggers.crons,[]);assert.deepEqual(armed.bridge.triggers.crons,[]);
 for(const c of Object.values(disabled)){assert.equal(c.vars.MERLIN_GRANT,'null');assert.equal(c.workers_dev,false);assert.deepEqual(c.triggers.crons,[])}
 assert.equal(disabled.operator.vars.MERLIN_SD_JSON,'');assert.equal(armed.operator.vars.MERLIN_SD_JSON,model);
 assert.equal(JSON.parse(armed.router.vars.MERLIN_GRANT).phase,'R');
 assert.throws(()=>configurations({...input,model:'{}'}));
});
test('truncated R2 cannot open R',()=>assert.throws(()=>checkR2Row({probe_id:'one-shot-private-original-merlin-r2-v1',status:'R2_REMOTE_ORIGINAL_PROCESS_PASS',receipt_json:'{}'})));
