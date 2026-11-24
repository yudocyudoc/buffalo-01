import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {ID,MODE,SCHEMA,FLAGS,R1_ARGS,boundedReceipt} from './receipt.mjs';
import {probeR1,startProbeServer} from './server.mjs';
import {runOneShot,cleanupAlarm,deny} from './one-shot.mjs';

const commit='a'.repeat(40),digest='sha256:'+'b'.repeat(64),key='c'.repeat(64);
const run='c135fb33-1234-4123-8123-123456789012';
const proof={schema:SCHEMA,probe_id:ID,source_commit:commit,run_id:run,flags_sha256:FLAGS,
 status:'MINIMAL_BWRAP_PASS',reason_code:'NONE',stderr_signature:'NONE',exit_code:0,
 stderr_sha256:'d'.repeat(64),agent_executed:false,inference_executed:false,
 raw_stderr_in_receipt:false,sandbox_relaxations:false,launch_context_verified:true};
const blocked={...proof,status:'MINIMAL_BWRAP_BLOCKED',reason_code:'NAMESPACE_CREATION_DENIED',
 stderr_signature:'NO_PERMISSIONS_TO_CREATE_NEW_NAMESPACE',exit_code:1};
const opts={sleep:async()=>{},randomUUID:()=>run,randomKey:()=>key};

test('v2 binds the dynamic loader directories read-only and fingerprints its own flags',()=>{
 assert.deepEqual(R1_ARGS.slice(0,9),['--ro-bind','/usr','/usr','--ro-bind','/lib','/lib','--ro-bind','/lib64','/lib64']);
 assert.equal(createHash('sha256').update(JSON.stringify(R1_ARGS)).digest('hex'),FLAGS);
 assert.throws(()=>boundedReceipt({...proof,launch_context_verified:false},commit,run),/R1_FALSE_PASS/);
 assert.throws(()=>boundedReceipt({...proof,probe_id:'one-shot-private-bwrap-r1-v1'},commit,run),/R1_RECEIPT_INVALID/);
});

test('v2 invokes only the launcher and distinguishes its guard from the bwrap diagnostic',{
 skip:process.platform!=='linux'
},()=>{
 const env={GITHUB_SHA:commit,ALLOW_UNSANDBOXED_FALLBACK:'false'};
 const attempt=(status,stdout,stderr)=>probeR1({commit,env,spawn:(bin,args,options)=>{
  assert.equal(bin,'/bin/sh');assert.match(args[0],/launch-bwrap\.sh$/);
  assert.deepEqual(args.slice(1),R1_ARGS);
  assert.deepEqual(Object.keys(options.env).sort(),['HOME','LANG','PATH']);
  return {status,stdout,stderr,signal:null,error:null};
 }});
 const convert=x=>boundedReceipt({...x,schema:SCHEMA,probe_id:ID,run_id:run},commit,run);
 const marker='R1_BWRAP_LAUNCH_CONTEXT_VERIFIED\n';
 assert.equal(convert(attempt(0,marker,'')).launch_context_verified,true);
 assert.throws(()=>convert(attempt(0,'','')),/R1_FALSE_PASS/);
 const cap=convert(attempt(1,marker,'bwrap: Unexpected capabilities but not setuid, old file caps config?\n'));
 assert.equal(cap.reason_code,'UNEXPECTED_BWRAP_CAPABILITIES');
 assert.equal(cap.launch_context_verified,true);
 const guard=convert(attempt(77,'','R1_BWRAP_LAUNCH_CONTEXT_REJECTED\n'));
 assert.equal(guard.reason_code,'BWRAP_LAUNCH_CONTEXT_FAILED');
 assert.equal(guard.launch_context_verified,false);
});

function fixture({response=proof,throwPost=false,throwDestroy=false,dbFail=false,failUpdateOnce=false,loseUpdateAck=false,badRunningImage=false}={}){
 const events=[],rows=new Map(),data=new Map();
 let alarm=false,starts=0,posts=0,stops=0;
 const storage={get:async k=>data.get(k),put:async(k,v)=>{data.set(k,v);events.push('storage:'+v.status)},
  transaction:async fn=>fn(storage),setAlarm:async()=>{alarm=true;events.push('alarm')},
  deleteAlarm:async()=>{alarm=false}};
 const image='registry.example/r1@'+digest;
 const container={images:{base:image},running:false,
  start(x){starts++;events.push('start');assert.equal(x.enableInternet,false);assert.equal(x.instance,'lite');
   assert.equal(x.env.ALLOW_UNSANDBOXED_FALLBACK,'false');this.running=true},
  async setInactivityTimeout(ms){assert.equal(ms,60000)},
  async inspect(){return this.running?{image:badRunningImage?'other':image}:null},
  getTcpPort(){return {fetch:async(url,init)=>{
   if(url.endsWith('/health'))return new Response(null,{status:204});
   posts++;assert.equal(init.method,'POST');assert.equal(init.headers['x-buffalo-r1-key'],key);
   if(throwPost)throw Error('network failed');
   return Response.json(response);
  }}},
  async destroy(){stops++;events.push('destroy');if(throwDestroy)throw Error('not stopped');this.running=false}};
 const DB={prepare(sql){return {bind(...args){return {async first(){
  const row=rows.get(args[0]);return row?{run_id:row.receipt.run_id,status:row.status,receipt_json:JSON.stringify(row.receipt)}:null;
 },async run(){
  if(dbFail)throw Error('DB unavailable');
  if(sql.startsWith('INSERT')){
   if(rows.has(args[0]))throw Error('duplicate');
   rows.set(args[0],{status:args[2],receipt:JSON.parse(args[3])});events.push('d1:CLAIMED');
  }else{
   if(failUpdateOnce){failUpdateOnce=false;throw Error('transient UPDATE failure')}
   const row=rows.get(args[2]);if(!row||row.status!==args[4]||row.receipt.run_id!==args[3])return {meta:{changes:0}};
   rows.set(args[2],{status:args[0],receipt:JSON.parse(args[1])});events.push('d1:'+args[0]);
   if(loseUpdateAck){loseUpdateAck=false;throw Error('lost UPDATE acknowledgement')}
  }
  return {meta:{changes:1}};
 }}}}}};
 const ctx={storage,container},env={R1_MODE:MODE,R1_EXPECTED_SHA:commit,R1_IMAGE_DIGEST:digest,R1_EXPIRES_AT:new Date(Date.now()+600000).toISOString(),DB,
 R1_CONTAINER:{getByName(){throw Error('not a real binding')}}};
 return {ctx,env,events,rows,data,counts:()=>({starts,posts,stops,alarm})};
}
test('disabled configuration or wrong digest cannot allocate',async()=>{
 const f=fixture();
 assert.equal((await runOneShot(f.ctx,{...f.env,R1_MODE:'DISABLED'},opts)).status,'R1_DISABLED');
 assert.equal((await runOneShot(f.ctx,{...f.env,R1_IMAGE_DIGEST:'sha256:'+'e'.repeat(64)},opts)).status,'R1_IMAGE_DIGEST_MISMATCH');
 assert.deepEqual(f.counts(),{starts:0,posts:0,stops:0,alarm:false});
 assert.equal(deny().status,404);
});
test('one claim, one no-internet start, one POST, cleanup and terminal D1 receipt',async()=>{
 const f=fixture();
 const r=await runOneShot(f.ctx,f.env,opts);
 assert.equal(r.status,'R1_REMOTE_MINIMAL_PASS');assert.equal(r.container_inspect_null,true);
 assert.equal(r.agent_execution_authorized,false);assert.equal(r.provider_requests_measured,false);
 assert.equal(r.probe.egress_independently_measured,false);
 assert.equal(f.rows.get(ID).status,r.status);
 assert(f.events.indexOf('d1:CLAIMED')<f.events.indexOf('start'));
 assert(f.events.indexOf('alarm')<f.events.indexOf('start'));
 assert(!JSON.stringify(r).includes(key));
 assert.equal((await runOneShot(f.ctx,f.env,opts)).status,'R1_ALREADY_CLAIMED_NO_RETRY');
 assert.deepEqual(f.counts(),{starts:1,posts:1,stops:1,alarm:false});
});
test('minimal namespace rejection stays a rejection',async()=>{
 const f=fixture({response:blocked});
 const r=await runOneShot(f.ctx,f.env,opts);
 assert.equal(r.status,'R1_REMOTE_MINIMAL_BLOCKED');
 assert.equal(r.probe.reason_code,'NAMESPACE_CREATION_DENIED');
 assert.equal(r.destroy_acknowledged,true);
});
test('unavailable D1 blocks start before allocating resources',async()=>{
 const f=fixture({dbFail:true});
 await assert.rejects(runOneShot(f.ctx,f.env,opts),/DB unavailable/);
 assert.equal(f.counts().starts,0);
});
test('v2 leaves the original R1 record and DO claim intact',async()=>{
 const f=fixture();
 const v1='one-shot-private-bwrap-r1-v1';
 const previous={probe_id:v1,run_id:'dcb2c513-661d-4fd3-aff1-68ffc72c0dc1',status:'R1_REMOTE_MINIMAL_BLOCKED'};
 f.rows.set(v1,{status:previous.status,receipt:previous});
 f.data.set('r1-namespace-claim-v1',previous);
 await cleanupAlarm(f.ctx,f.env);
 assert.equal(f.counts().stops,0);
 assert.equal((await runOneShot(f.ctx,f.env,opts)).status,'R1_REMOTE_MINIMAL_PASS');
 assert.deepEqual(f.rows.get(v1).receipt,previous);
 assert.deepEqual(f.data.get('r1-namespace-claim-v1'),previous);
});
test('ambiguous POST failure is not retried; cleanup still runs',async()=>{
 const f=fixture({throwPost:true});
 assert.equal((await runOneShot(f.ctx,f.env,opts)).status,'R1_RUNTIME_FAILURE');
 assert.deepEqual(f.counts(),{starts:1,posts:1,stops:1,alarm:false});
});
test('running image mismatch denies POST even after ready',async()=>{
 const f=fixture({badRunningImage:true});
 assert.equal((await runOneShot(f.ctx,f.env,opts)).phase,'IMAGE_INSPECT');
 assert.equal(f.counts().posts,0);assert.equal(f.counts().stops,1);
});
test('failed destroy is not a remote pass and watchdog remains armed',async()=>{
 const f=fixture({throwDestroy:true});
 const r=await runOneShot(f.ctx,f.env,opts);
 assert.equal(r.status,'R1_CLEANUP_UNCONFIRMED');assert.equal(f.counts().alarm,true);
});
test('receipt rejects fabricated success, wrong source and arbitrary diagnostic',()=>{
 for(const x of [{...proof,exit_code:1},{...proof,source_commit:'b'.repeat(40)},
   {...blocked,stderr_signature:'OTHER'},{...proof,agent_executed:true}])
   assert.throws(()=>boundedReceipt(x,commit,run),/R1_/);
 assert.equal(boundedReceipt({...proof,secret:key},commit,run).secret,undefined);
});
test('watchdog stops interrupted attempt without replaying it',async()=>{
 const f=fixture();
 const claim={probe_id:ID,run_id:run,status:'CLAIMED'};
 f.data.set(ID,claim);f.rows.set(ID,{status:'CLAIMED',receipt:claim});
 f.ctx.container.running=true;
 await cleanupAlarm(f.ctx,f.env);
 assert.equal(f.rows.get(ID).status,'R1_INTERRUPTED_NO_RETRY');
 assert.deepEqual(f.counts(),{starts:0,posts:0,stops:1,alarm:false});
});
test('private origin requires exact identity and explicit arming',()=>{
 assert.throws(()=>startProbeServer({env:{}}),/R1_ORIGIN_NOT_ARMED/);
});
test('real loopback HTTP rejects unauthenticated requests and replay; mocked probe not runtime proof',async t=>{
 let calls=0;
 const s=startProbeServer({host:'127.0.0.1',port:0,env:{R1_MODE:MODE,
 BUFFALO_IMAGE_SOURCE_SHA:commit,R1_EXPECTED_SHA:commit,R1_RUN_ID:run,R1_KEY:key,
 ALLOW_UNSANDBOXED_FALLBACK:'false'},probe:()=>{calls++;return blocked}});
 t.after(()=>{s.closeAllConnections();return new Promise(r=>s.close(r))});
 if(!s.listening)await once(s,'listening');
 const url='http://127.0.0.1:'+s.address().port;
 assert.equal((await fetch(url+'/health')).status,204);assert.equal(calls,0);
 assert.equal((await fetch(url+'/probe',{method:'POST'})).status,404);
 const h={'x-buffalo-r1-key':key};
 assert.equal((await fetch(url+'/probe',{method:'POST',headers:h,body:'untrusted'})).status,400);
 const r=await fetch(url+'/probe',{method:'POST',headers:h});assert.equal(r.status,200);
 assert.equal((await r.json()).reason_code,'NAMESPACE_CREATION_DENIED');
 assert.equal((await fetch(url+'/probe',{method:'POST',headers:h})).status,409);assert.equal(calls,1);
});

test('expired or excessive arming window prevents any allocation',async()=>{
 const f=fixture();for(const ms of [-1000,23*60000]){
 assert.equal((await runOneShot(f.ctx,{...f.env,R1_EXPIRES_AT:new Date(Date.now()+ms).toISOString()},opts)).status,'R1_DISABLED');
 }assert.equal(f.counts().starts,0);
});

test('terminal UPDATE failure: watchdog reconciles exact stored result without replay',async()=>{
 const f=fixture({failUpdateOnce:true});
 await assert.rejects(runOneShot(f.ctx,f.env,opts),/transient UPDATE failure/);
 const terminal=structuredClone(f.data.get(ID));
 assert.equal(terminal.status,'R1_REMOTE_MINIMAL_PASS');
 assert.equal(f.rows.get(ID).status,'CLAIMED');assert.equal(f.counts().alarm,true);
 await cleanupAlarm(f.ctx,{...f.env,R1_MODE:'DISABLED'});
 assert.deepEqual(f.rows.get(ID).receipt,terminal);
 assert.deepEqual(f.data.get(ID),terminal);
 assert.deepEqual(f.counts(),{starts:1,posts:1,stops:1,alarm:false});
 await cleanupAlarm(f.ctx,f.env);assert.deepEqual(f.rows.get(ID).receipt,terminal);
 assert.equal((await runOneShot(f.ctx,f.env,opts)).status,'R1_ALREADY_CLAIMED_NO_RETRY');
 assert.equal(f.counts().posts,1);
});
test('lost UPDATE acknowledgement: identical terminal is idempotent',async()=>{
 const f=fixture({loseUpdateAck:true,response:blocked});
 await assert.rejects(runOneShot(f.ctx,f.env,opts),/lost UPDATE acknowledgement/);
 const terminal=structuredClone(f.data.get(ID));
 assert.equal(terminal.status,'R1_REMOTE_MINIMAL_BLOCKED');
 await cleanupAlarm(f.ctx,f.env);
 assert.deepEqual(f.rows.get(ID).receipt,terminal);
 assert.deepEqual(f.counts(),{starts:1,posts:1,stops:1,alarm:false});
});
test('conflicting terminal receipt is never overwritten',async()=>{
 const f=fixture({failUpdateOnce:true});
 await assert.rejects(runOneShot(f.ctx,f.env,opts),/transient UPDATE failure/);
 const terminal=f.data.get(ID);
 const conflict={...terminal,phase:'CONFLICT'};
 f.rows.set(ID,{status:conflict.status,receipt:conflict});
 await assert.rejects(cleanupAlarm(f.ctx,f.env),/R1_D1_TERMINAL_CONFLICT_OR_MISSING/);
 assert.deepEqual(f.rows.get(ID).receipt,conflict);
 assert.deepEqual(f.data.get(ID),terminal);
 assert.equal(f.counts().posts,1);
});
test('watchdog recovery never promotes cleanup failure to PASS',async()=>{
 const f=fixture({throwDestroy:true});
 const terminal=await runOneShot(f.ctx,f.env,opts);
 f.ctx.container.destroy=async()=>{f.ctx.container.running=false};
 await cleanupAlarm(f.ctx,f.env);
 assert.equal(terminal.status,'R1_CLEANUP_UNCONFIRMED');
 assert.deepEqual(f.rows.get(ID).receipt,terminal);
 assert.equal(f.counts().alarm,false);assert.equal(f.counts().posts,1);
});
