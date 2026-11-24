import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import {ID,MODE,SCHEMA,MODEL,boundedReceipt} from './receipt.mjs';
import {verifyLaunchContext} from './driver.mjs';
import {probeR2,startProbeServer} from './server.mjs';
import {runOneShot,cleanupAlarm} from './one-shot.mjs';
import {requireUnusedProbe,configs} from './manual.mjs';
const sha='a'.repeat(40),digest='sha256:'+'b'.repeat(64),key='c'.repeat(64),run='c135fb33-1234-4123-8123-123456789012';
const evidence={schema:'BUFFALO_STAGE3B8_ORIGINAL_MERLIN_PROCESS_OFFLINE_V1',status:'ORIGINAL_MERLIN_WORKER_OFFLINE_PROVIDER_DENIED_PASS',
 checkout_commit:sha,agent:'merlin',scenario:'dialysisClinic',initial_model_sha256:MODEL,agent_config_sha256:'d'.repeat(64),
 provider:'UNREGISTERED_DENY_ONLY',ipc_barriers:2,model_sync_requests:1,genuine_terminal_error:'CONVERSATION_ERROR',terminal_status:'awaiting_user',
 original_worker_spawner:true,original_agent_worker:true,bwrap_ipc_worker:true,worker_exited:true,launch_context_verified:true,proxy_stopped:true,session_directory_removed:true,
 agent_model_response:false,model_modified:false,simulation_executed:false,grader_executed:false,provider_requests_measured:false,inference_authorized:false};
const pass={schema:SCHEMA,probe_id:ID,source_commit:sha,run_id:run,status:'ORIGINAL_PROCESS_PASS',reason_code:'NONE',exit_code:0,
 process_log_sha256:'e'.repeat(64),raw_log_in_receipt:false,provider_requests_measured:false,inference_authorized:false,evidence};
const blocked={...pass,status:'ORIGINAL_PROCESS_BLOCKED',reason_code:'ORIGINAL_WORKER_START_FAILED',exit_code:1,evidence:null};
test('launch context rejects root, caps and missing no-new-privs',()=>{
 const status='Uid:\t1000 1000 1000 1000\nNoNewPrivs:\t1\nCapInh:\t000\nCapPrm:\t000\nCapEff:\t000\nCapAmb:\t000';
 assert(verifyLaunchContext(status));
 for(const s of [status.replaceAll('1000','0'),status.replace('CapPrm:\t000','CapPrm:\t001'),status.replace('NoNewPrivs:\t1','NoNewPrivs:\t0'),status.replace('CapEff','Other')])assert.throws(()=>verifyLaunchContext(s));
});
test('positive receipt requires original process, IPC, denied provider, model integrity and cleanup',()=>{
 assert.equal(boundedReceipt(pass,sha,run).status,'ORIGINAL_PROCESS_PASS');
 for(const e of [{worker_exited:false},{proxy_stopped:false},{ipc_barriers:1},{model_modified:true},{launch_context_verified:false},{agent_model_response:true}])assert.throws(()=>boundedReceipt({...pass,evidence:{...evidence,...e}},sha,run),/R2_FALSE_PASS/);
 assert.throws(()=>boundedReceipt({...pass,probe_id:'one-shot-private-bwrap-r1-v2'},sha,run));
});
test('fixed process invocation with allowlisted env and no raw log',()=>{
 const x=probeR2({commit:sha,spawn:(bin,args,opts)=>{
  assert.equal(bin,'/usr/bin/setpriv');assert.deepEqual(args.slice(0,4),['--inh-caps=-all','--ambient-caps=-all','--no-new-privs','--']);
  assert.match(args.at(-1),/driver\.mjs$/);assert.equal(opts.env.ALLOW_UNSANDBOXED_FALLBACK,'false');assert(!opts.env.ANTHROPIC_API_KEY);assert.equal(opts.timeout,80000);
  return {status:0,stdout:'BUFFALO_R2_PROCESS='+JSON.stringify(evidence)+'\n',stderr:''};
 }});
 assert.equal(boundedReceipt({...x,schema:SCHEMA,probe_id:ID,source_commit:sha,run_id:run},sha,run).status,'ORIGINAL_PROCESS_PASS');
 const b=probeR2({commit:sha,spawn:()=>({status:1,stderr:'setpriv: denied',stdout:''})});
 assert.equal(b.reason_code,'LAUNCH_CONTEXT_FAILED');assert.equal(b.evidence,null);
});
test('disabled origin denies; private one shot, body denied and replay rejected',async t=>{
 assert.throws(()=>startProbeServer({env:{}}),/R2_ORIGIN_NOT_ARMED/);
 let calls=0;const s=startProbeServer({host:'127.0.0.1',port:0,env:{R2_MODE:MODE,BUFFALO_IMAGE_SOURCE_SHA:sha,R2_EXPECTED_SHA:sha,R2_RUN_ID:run,R2_KEY:key,ALLOW_UNSANDBOXED_FALLBACK:'false'},probe:()=>{calls++;return pass}});
 t.after(()=>{s.closeAllConnections();return new Promise(r=>s.close(r))});if(!s.listening)await once(s,'listening');
 const u='http://127.0.0.1:'+s.address().port;const headers={'x-buffalo-r2-key':key};
 assert.equal((await fetch(u+'/probe',{method:'POST'})).status,404);
 assert.equal((await fetch(u+'/probe',{method:'POST',headers,body:'bad'})).status,400);
 assert.equal((await (await fetch(u+'/probe',{method:'POST',headers})).json()).status,'ORIGINAL_PROCESS_PASS');
 assert.equal((await fetch(u+'/probe',{method:'POST',headers})).status,409);assert.equal(calls,1);
});
function fixture({receipt=pass,failUpdate=false}={}){
 const rows=new Map(),data=new Map();let starts=0,posts=0,alarm=false,stops=0;
 const storage={get:async k=>data.get(k),put:async(k,v)=>data.set(k,v),transaction:async f=>f(storage),setAlarm:async()=>{alarm=true},deleteAlarm:async()=>{alarm=false}};
 const image='registry.example/r2@'+digest;
 const container={images:{base:image},running:false,start(x){starts++;assert.equal(x.instance,'basic');assert.equal(x.enableInternet,false);this.running=true},
 setInactivityTimeout:async ms=>assert.equal(ms,120000),inspect:async()=>container.running?{image}:null,
 getTcpPort:()=>({fetch:async u=>{if(u.endsWith('/health'))return new Response(null,{status:204});posts++;return Response.json(receipt)}}),
 destroy:async()=>{stops++;container.running=false}};
 const DB={prepare(sql){return {bind(...a){return {first:async()=>{const r=rows.get(a[0]);return r&&{run_id:r.run_id,status:r.status,receipt_json:JSON.stringify(r)}},run:async()=>{
 if(sql.startsWith('INSERT')){assert(!rows.has(a[0]));rows.set(a[0],JSON.parse(a[3]));return {meta:{changes:1}}}
 if(failUpdate){failUpdate=false;throw Error('transient')}
 const r=rows.get(a[2]);if(!r||r.status!==a[4]||r.run_id!==a[3])return {meta:{changes:0}};
 rows.set(a[2],JSON.parse(a[1]));return {meta:{changes:1}};
 }}}}}};
 return {ctx:{storage,container},env:{R2_MODE:MODE,R2_EXPECTED_SHA:sha,R2_IMAGE_DIGEST:digest,R2_EXPIRES_AT:new Date(Date.now()+600000).toISOString(),DB,R2_CONTAINER:{getByName(){}}},rows,counts:()=>({starts,posts,stops,alarm})};
}
const opts={sleep:async()=>{},randomUUID:()=>run,randomKey:()=>key};
test('single basic instance, one POST, terminal cleanup; historical R1 untouched',async()=>{
 const f=fixture();const historical={status:'R1_REMOTE_MINIMAL_PASS'};f.rows.set('one-shot-private-bwrap-r1-v2',historical);
 const r=await runOneShot(f.ctx,f.env,opts);assert.equal(r.status,'R2_REMOTE_ORIGINAL_PROCESS_PASS');
 assert.deepEqual(f.rows.get('one-shot-private-bwrap-r1-v2'),historical);assert.deepEqual(f.counts(),{starts:1,posts:1,stops:1,alarm:false});
 assert.equal((await runOneShot(f.ctx,f.env,opts)).status,'R2_ALREADY_CLAIMED_NO_RETRY');
});
test('blocked result not promoted; persistence recovery never reruns',async()=>{
 const f=fixture({receipt:blocked,failUpdate:true});await assert.rejects(runOneShot(f.ctx,f.env,opts),/transient/);
 assert.equal(f.rows.get(ID).status,'CLAIMED');await cleanupAlarm(f.ctx,f.env);
 assert.equal(f.rows.get(ID).status,'R2_REMOTE_ORIGINAL_PROCESS_BLOCKED');assert.deepEqual(f.counts(),{starts:1,posts:1,stops:1,alarm:false});
});
test('preflight requires prior R1 PASS and no R2 or open claim',async()=>{
 const read=(n,ok=true)=>async(sql,params)=>sql.includes('sqlite_master')?[{name:'buffalo_stage3b8r1_receipts'}]:sql.includes('receipt_json')?(ok?[{status:'R1_REMOTE_MINIMAL_PASS',receipt_json:JSON.stringify({probe:{launch_context_verified:true,exit_code:0}})}]:[]):[{n}];
 await requireUnusedProbe(read(0));await assert.rejects(requireUnusedProbe(read(0,false)),/R2_R1_PASS_REQUIRED/);await assert.rejects(requireUnusedProbe(read(1)),/R2_PRIOR_EVIDENCE_NO_REPLAY/);
 const template=JSON.parse(readFileSync(new URL('./wrangler.template.json',import.meta.url),'utf8'));
 const ref='registry.cloudflare.com/e0cb52526a69c0f48f001901a5b9a640/buffalo-original-worker-r2@'+digest;
 const x=configs(template,sha,ref);assert.deepEqual(x.disabled.triggers.crons,[]);assert.equal(x.disabled.vars.R2_MODE,'DISABLED');
});
