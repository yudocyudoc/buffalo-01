import {deflateRawSync} from 'node:zlib';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {OFFLINE_KIND,OFFLINE_WORKFLOW} from '../../scripts/control-plane/contract.mjs';
import {ControlPlaneService} from './service.mjs';
import {D1TaskStore} from './store.mjs';
import {acceptOfflineTask} from '../../scripts/control-plane/contract.mjs';
import {handle} from './index.mjs';
import {GitHubOffline,extractSingleStoredZip,verifyOfflineResult} from './github.mjs';
const UUID='123e4567-e89b-42d3-a456-426614174000',HASH='b'.repeat(64),HEAD='a'.repeat(40);
const input={task_id:UUID,kind:OFFLINE_KIND,input_sha256:HASH};
const run={id:100,workflow_id:22,event:'workflow_dispatch',head_branch:'main',head_sha:HEAD,
 display_title:'Buffalo offline echo '+UUID,status:'completed',conclusion:'success',
 repository:{full_name:'yudocyudoc/buffalo-01'},created_at:'2026-11-21T20:00:01Z',run_attempt:1};
class MemoryStore {
 rows=new Map();events=[];
 async read(id){return this.rows.get(id)?{...this.rows.get(id)}:null}
 async create(v){const old=this.rows.get(v.task_id);
  if(old&&(old.input_sha256!==v.input_sha256||old.kind!==v.kind))throw Error('CONTROL_PLANE_TASK_ID_CONFLICT');
  if(!old){this.rows.set(v.task_id,{...v,github_run_id:null,github_artifact_id:null,result_sha256:null});this.events.push('TASK_ADMITTED')}
  return {task:await this.read(v.task_id),created:!old}
 }
 async claim(id,head_sha,github_workflow_id,dispatch_started_at){
  const r=this.rows.get(id);if(r?.state!=='READY')return false;
  Object.assign(r,{state:'DISPATCHING',dispatch_head_sha:head_sha,github_workflow_id,dispatch_started_at});
  this.events.push('DISPATCH_CLAIMED');return true
 }
 async transition(id,from,to,reason,extra={}){
  const r=this.rows.get(id);if(r?.state!==from)return false;
  r.state=to;if(extra.run_id)r.github_run_id=extra.run_id;
  if(extra.artifact_id)r.github_artifact_id=extra.artifact_id;
  if(extra.result_sha256)r.result_sha256=extra.result_sha256;
  this.events.push(reason);return true
 }
 async linkRun(id,runId){const r=this.rows.get(id);
  if(r.github_run_id&&r.github_run_id!==runId)throw Error('CONFLICT');
  r.github_run_id=runId;this.events.push('GITHUB_RUN_LINKED');return true
 }
}
class MockGitHub {
 calls=[];throwDispatch=false;runs=[];run={...run};artifact={artifact_id:300,result_sha256:'d'.repeat(64)};
 async prepare(){this.calls.push('prepare');return {workflow_id:22,head_sha:HEAD}}
 async dispatch(payload){this.calls.push(['dispatch',payload]);if(this.throwDispatch)throw Error('CONNECTION_LOST')}
 async findRuns(){this.calls.push('list');return this.runs}
 async getRun(id){this.calls.push(['get',id]);return this.run}
 checkRun(task,job){this.calls.push('check');if(job.head_sha!==task.dispatch_head_sha||job.workflow_id!==task.github_workflow_id)throw Error('RUN_MISMATCH')}
 async getVerifiedResult(){this.calls.push('artifact');return this.artifact}
}
function fx(){const store=new MemoryStore(),gh=new MockGitHub(),svc=new ControlPlaneService(store,gh,()=> '2026-11-21T20:00:00Z');return{store,gh,svc}}
test('create identical work idempotently but reject collision and paid kind',async()=>{
 const {svc,store}=fx();assert.equal((await svc.create(input)).code,201);
 assert.equal((await svc.create(input)).code,200);assert.equal(store.events.length,1);
 await assert.rejects(()=>svc.create({...input,input_sha256:'e'.repeat(64)}),/TASK_ID_CONFLICT/);
 await assert.rejects(()=>svc.create({...input,kind:'MERLIN_PAID'}),/NOT_ALLOWED/);
});
test('one claim and one POST, fixed workflow and digest',async()=>{
 const {svc,gh,store}=fx();await svc.create(input);
 assert.equal((await svc.dispatch(UUID)).body.state,'SUBMITTED');
 assert.equal((await svc.dispatch(UUID)).code,409);
 assert.equal(gh.calls.filter(x=>Array.isArray(x)&&x[0]==='dispatch').length,1);
 assert.deepEqual(gh.calls.find(x=>Array.isArray(x)&&x[0]==='dispatch')[1],
  {ref:'main',inputs:{task_id:UUID,input_sha256:HASH}});
 assert.deepEqual(store.events,['TASK_ADMITTED','DISPATCH_CLAIMED','GITHUB_DISPATCH_ACCEPTED']);
});
test('ambiguous POST cannot retry; matching authentic run can reconcile',async()=>{
 const {svc,gh}=fx();await svc.create(input);gh.throwDispatch=true;
 assert.equal((await svc.dispatch(UUID)).body.state,'DISPATCH_UNKNOWN');
 assert.equal((await svc.dispatch(UUID)).code,409);
 gh.runs=[run];assert.equal((await svc.reconcile(UUID)).body.state,'SUCCEEDED');
 assert.equal(gh.calls.filter(x=>Array.isArray(x)&&x[0]==='dispatch').length,1);
});
test('no match pending; duplicate and forged run do not create success',async()=>{
 const a=fx();await a.svc.create(input);await a.svc.dispatch(UUID);
 assert.equal((await a.svc.reconcile(UUID)).code,202);
 a.gh.runs=[run,{...run,id:101}];
 assert.equal((await a.svc.reconcile(UUID)).body.error,'MULTIPLE_RUN_MATCHES');
 const b=fx();await b.svc.create(input);await b.svc.dispatch(UUID);
 b.gh.runs=[run];b.gh.run={...run,head_sha:'f'.repeat(40)};
 assert.equal((await b.svc.reconcile(UUID)).body.state,'DISPATCH_UNKNOWN');
 assert.notEqual((await b.svc.inspect(UUID)).body.state,'SUCCEEDED');
});
test('failed job remains failed without an artifact',async()=>{
 const {svc,gh}=fx();await svc.create(input);await svc.dispatch(UUID);
 gh.runs=[run];gh.run={...run,conclusion:'failure'};
 assert.equal((await svc.reconcile(UUID)).body.state,'FAILED');
 assert.equal(gh.calls.includes('artifact'),false);
});
test('invalid artifact blocks success even if GitHub job succeeded',async()=>{
 const {svc,gh}=fx();await svc.create(input);await svc.dispatch(UUID);
 gh.runs=[run];gh.getVerifiedResult=async()=>{throw Error('DIGEST_BAD')};
 assert.equal((await svc.reconcile(UUID)).body.state,'DISPATCH_UNKNOWN');
});
test('Worker demands bearer and denies command input and arbitrary endpoints',async()=>{
 const {store,gh}=fx(),token='X'.repeat(48);
 const env={DB:{},GITHUB_FINE_GRAINED_TOKEN:'fake',CONTROL_API_TOKEN:token};
 const url='https://worker.test/v1/tasks';
 let r=await handle(new Request(url,{method:'POST',body:JSON.stringify(input)}),env,{store,github:gh});
 assert.equal(r.status,401);assert.equal(store.events.length,0);
 const headers={Authorization:'Bearer '+token};
 r=await handle(new Request(url,{method:'POST',headers,body:JSON.stringify({...input,command:'rm -rf /'})}),env,{store,github:gh});
 assert.equal(r.status,400);assert.equal(store.events.length,0);
 r=await handle(new Request(url,{method:'POST',headers,body:JSON.stringify(input)}),env,{store,github:gh});
 assert.equal(r.status,201);
 r=await handle(new Request('https://worker.test/execute-shell',{method:'POST',headers}),env,{store,github:gh});
 assert.equal(r.status,404);
});
function crc32(b){let c=0xffffffff;for(const x of b){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0}
function zipStored(name,data){
 const filename=Buffer.from(name),value=Buffer.from(data),crc=crc32(value);
 const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(filename.length,26);
 local.writeUInt32LE(value.length,18);local.writeUInt32LE(value.length,22);
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt32LE(crc,16);
 central.writeUInt32LE(value.length,20);central.writeUInt32LE(value.length,24);central.writeUInt16LE(filename.length,28);
 const offset=local.length+filename.length+value.length;
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);
 end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+filename.length,12);end.writeUInt32LE(offset,16);
 local.writeUInt32LE(crc,14);return Buffer.concat([local,filename,value,central,filename,end]);
}
test('ZIP stored single member verifies CRC; corrupt and wrong name blocked',()=>{
 const bytes=zipStored('buffalo-offline-result.json','{"test":true}');
 const arr=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
 assert.equal(new TextDecoder().decode(extractSingleStoredZip(arr,'buffalo-offline-result.json')),'{"test":true}');
 const broken=Buffer.from(bytes);broken[40]^=1;
 assert.throws(()=>extractSingleStoredZip(broken.buffer.slice(broken.byteOffset,broken.byteOffset+broken.byteLength),'buffalo-offline-result.json'));
 assert.throws(()=>extractSingleStoredZip(arr,'other.json'),/ZIP_MEMBER_INVALID/);
});
const fixedDigest=createHash('sha256').update('buffalo-offline-echo-v1').digest('hex');
const result={schema:'BUFFALO_OFFLINE_RESULT_V1',task_id:UUID,input_sha256:HASH,
 kind:OFFLINE_KIND,outcome:'SUCCEEDED',commit:HEAD,workflow:OFFLINE_WORKFLOW,
 evidence:{kind:'NO_PROVIDER_NO_SIMULATION',payload_sha256:fixedDigest}};
test('result belongs to exact task, input, workflow, SHA and known echo',()=>{
 assert.equal(verifyOfflineResult(input,run,result),result);
 for(const bad of [{...result,commit:'f'.repeat(40)},{...result,input_sha256:'0'.repeat(64)},
  {...result,kind:'PAID'},{...result,evidence:{...result.evidence,payload_sha256:'0'.repeat(64)}}])
  assert.throws(()=>verifyOfflineResult(input,run,bad),/GITHUB_RESULT_MISMATCH/);
});
test('GitHub API allows only pinned offline workflow, no paid dispatch',async()=>{
 const paths=[],transport=async(url,opts)=>{
  const p=new URL(url).pathname;paths.push([p,opts.method]);
  if(p.endsWith('/actions/workflows/'+OFFLINE_WORKFLOW)&&opts.method==='GET')
   return Response.json({id:22,path:'.github/workflows/'+OFFLINE_WORKFLOW});
  if(p.endsWith('/commits/main'))return Response.json({sha:HEAD});
  if(p.endsWith('/actions/workflows/'+OFFLINE_WORKFLOW+'/dispatches'))return new Response(null,{status:204});
  return Response.json({message:'not found'},{status:404});
 };
 const gh=new GitHubOffline('TEST_PRIVATE_TOKEN',transport);
 assert.deepEqual(await gh.prepare(),{workflow_id:22,head_sha:HEAD});
 await gh.dispatch({ref:'main',inputs:{task_id:UUID,input_sha256:HASH}});
 await assert.rejects(()=>gh.dispatch({ref:'main',inputs:{task_id:UUID,input_sha256:HASH,command:'sh'}}),/DENIED/);
 assert.equal(paths.length,3);assert(paths.every(([p])=>!p.includes('paid-agent-case')));
});
test('artifact ZIP and GitHub digest are checked against actual bytes',async()=>{
 const zip=zipStored('buffalo-offline-result.json',JSON.stringify(result));
 const digest=createHash('sha256').update(zip).digest('hex');
 let corrupt=false;
 const transport=async(url)=>{
  const path=new URL(url).pathname;
  if(path.endsWith('/runs/100/artifacts'))
   return Response.json({total_count:1,artifacts:[{id:300,name:'buffalo-offline-'+UUID,
    expired:false,size_in_bytes:zip.length,digest:'sha256:'+(corrupt?'f'.repeat(64):digest)}]});
  if(path.endsWith('/artifacts/300/zip'))return new Response(zip);
  return new Response(null,{status:404});
 };
 const gh=new GitHubOffline('TEST_PRIVATE_TOKEN',transport);
 const task={...input,github_workflow_id:22,dispatch_head_sha:HEAD,
  dispatch_started_at:'2026-11-21T20:00:00Z',github_run_id:100};
 assert(gh.checkRun(task,run));
 const verified=await gh.getVerifiedResult(task,run);
 assert.equal(verified.artifact_id,300);
 assert.equal(verified.result_sha256,createHash('sha256').update(JSON.stringify(result)).digest('hex'));
 corrupt=true;
 await assert.rejects(()=>gh.getVerifiedResult(task,run),/ARTIFACT_DIGEST_MISMATCH/);
});
test('prior and rerun workflow cannot impersonate current run',()=>{
 const gh=new GitHubOffline('TEST_PRIVATE_TOKEN');
 const task={...input,github_workflow_id:22,dispatch_head_sha:HEAD,
  dispatch_started_at:'2026-11-21T20:00:00Z',github_run_id:null};
 assert.throws(()=>gh.checkRun(task,{...run,created_at:'2026-11-20T20:00:00Z'}),/RUN_ORIGIN_NOT_PROVEN/);
 assert.throws(()=>gh.checkRun(task,{...run,run_attempt:2}),/RUN_ORIGIN_NOT_PROVEN/);
});

test('D1 store accepts strictly normalized internal task and rejects unnormalized one',async()=>{
 let rows=null;
 const db={
   prepare(sql){return {bind(...args){
     if(sql.startsWith('SELECT * FROM buffalo_tasks'))return {first:async()=>rows};
     return {args,sql};
   }}},
   async batch(stmts){
     assert.equal(stmts.length,2);
     rows={task_id:UUID,kind:OFFLINE_KIND,input_sha256:HASH,state:'READY'};
     return [{meta:{changes:1}},{meta:{changes:1}}];
   }
 };
 const store=new D1TaskStore(db);
 const result=await store.create(acceptOfflineTask(input));
 assert.equal(result.created,true);
 assert.equal(result.task.state,'READY');
 await assert.rejects(()=>store.create(input),/INTERNAL_TASK_NOT_NORMALIZED/);
});

test('GitHub ZIP DEFLATE format verifies payload and rejects tampering',()=>{
 const name='buffalo-offline-result.json',payload=Buffer.from(JSON.stringify(result)),filename=Buffer.from(name);
 const packed=deflateRawSync(payload),crc=crc32(payload);
 const local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
 local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);
 local.writeUInt32LE(packed.length,18);local.writeUInt32LE(payload.length,22);local.writeUInt16LE(filename.length,26);
 central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(8,10);central.writeUInt32LE(crc,16);
 central.writeUInt32LE(packed.length,20);central.writeUInt32LE(payload.length,24);central.writeUInt16LE(filename.length,28);
 const centralOffset=30+filename.length+packed.length;
 end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);
 end.writeUInt32LE(central.length+filename.length,12);end.writeUInt32LE(centralOffset,16);
 const archive=Buffer.concat([local,filename,packed,central,filename,end]);
 const asArrayBuffer=x=>x.buffer.slice(x.byteOffset,x.byteOffset+x.byteLength);
 const content=extractSingleStoredZip(asArrayBuffer(archive),'buffalo-offline-result.json');
 assert.deepEqual(Buffer.from(content),payload);
 const corrupted=Buffer.from(archive);corrupted[30+filename.length+1]^=0x01;
 assert.throws(()=>extractSingleStoredZip(asArrayBuffer(corrupted),'buffalo-offline-result.json'));
});

test('preflight failure stays READY, is classified, and never dispatches',async()=>{
 for(const [message,reason] of [
  ['GITHUB_HTTP_403','GITHUB_PREFLIGHT_HTTP_403'],
  ['GITHUB_HTTP_404','GITHUB_PREFLIGHT_HTTP_404'],
  ['GITHUB_WORKFLOW_NOT_ALLOWLISTED','GITHUB_PREFLIGHT_WORKFLOW_NOT_ALLOWLISTED'],
  ['PRIVATE_API_REPLY_WITH_TOKEN','GITHUB_PREFLIGHT_UNKNOWN']
 ]){
  const {store,gh,svc}=fx();
  await svc.create(input);
  gh.prepare=async()=>{throw Error(message)};
  const response=await svc.dispatch(UUID);
  assert.equal(response.code,502);
  assert.deepEqual(response.body,{error:'GITHUB_PREFLIGHT_FAILED',
   reason_code:reason,task_id:UUID,state:'READY',dispatch_attempted:false});
  assert.equal((await store.read(UUID)).state,'READY');
  assert.deepEqual(store.events,['TASK_ADMITTED']);
  assert.equal(gh.calls.length,0);
  assert.equal(JSON.stringify(response).includes('PRIVATE_API_REPLY_WITH_TOKEN'),false);
 }
});

test('read-only preflight isolates GitHub stage and never mutates D1',async()=>{
 const token='T'.repeat(48),env={DB:{},GITHUB_FINE_GRAINED_TOKEN:'mock-only',CONTROL_API_TOKEN:token};
 const {store,gh}=fx();
 await store.create({...input,workflow:OFFLINE_WORKFLOW,state:'READY',paid:false});
 gh.prepare=async()=>{throw Error('GITHUB_PREFLIGHT_WORKFLOW_HTTP_422')};
 const request=()=>new Request('https://worker.test/v1/diagnostics/github-preflight',{method:'GET',headers:{Authorization:'Bearer '+token}});
 const denied=await handle(new Request('https://worker.test/v1/diagnostics/github-preflight'),env,{store,github:gh});
 assert.equal(denied.status,401);
 const first=await handle(request(),env,{store,github:gh});
 assert.equal(first.status,502);
 assert.deepEqual(await first.json(),{preflight:'FAILED',
  reason_code:'GITHUB_PREFLIGHT_WORKFLOW_HTTP_422',read_only:true,dispatch_attempted:false});
 assert.equal((await store.read(UUID)).state,'READY');
 assert.deepEqual(store.events,['TASK_ADMITTED']);
 gh.prepare=async()=>{throw TypeError('Do not expose a secret: TOKEN_VALUE')};
 const unknown=await handle(request(),env,{store,github:gh});
 assert.equal((await unknown.json()).reason_code,'GITHUB_PREFLIGHT_UNKNOWN');
 gh.prepare=async()=>({workflow_id:22,head_sha:HEAD});
 const ok=await handle(request(),env,{store,github:gh});
 assert.deepEqual(await ok.json(),{preflight:'OK',read_only:true,dispatch_attempted:false});
 assert.equal((await store.read(UUID)).state,'READY');
});
test('GitHub preflight distinguishes workflow fetch, main fetch and type errors',async()=>{
 const token='mock';
 const gh=new GitHubOffline(token,async(url)=>{
  if(url.endsWith('/actions/workflows/buffalo-control-plane-offline.yml'))return new Response('',{status:418});
  return Response.json({sha:HEAD});
 });
 await assert.rejects(()=>gh.prepare(),/GITHUB_PREFLIGHT_WORKFLOW_HTTP_418/);
 const gh2=new GitHubOffline(token,async(url)=>{
  if(url.endsWith('/actions/workflows/buffalo-control-plane-offline.yml'))
   return Response.json({path:'.github/workflows/buffalo-control-plane-offline.yml',id:22});
  return new Response('',{status:422});
 });
 await assert.rejects(()=>gh2.prepare(),/GITHUB_PREFLIGHT_MAIN_HTTP_422/);
 const gh3=new GitHubOffline(token,async()=>{throw new TypeError('private network response');});
 await assert.rejects(()=>gh3.prepare(),/GITHUB_PREFLIGHT_WORKFLOW_NETWORK_TYPE_ERROR/);
});
