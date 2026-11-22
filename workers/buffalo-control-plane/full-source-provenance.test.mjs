import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SOURCE_PROOF_WORKFLOW,SOURCE_PROOF_MEMBER,sourceProofFor,
 checkSourceProof} from '../../scripts/full-integration/source-proof-contract.mjs';
import {produceSourceProof} from '../../scripts/full-integration/create-source-proof.mjs';
import {digestHandoff,HANDOFF_KIND,HANDOFF_SCHEMA} from
 '../../scripts/full-integration/handoff-contract.mjs';
import {GitHubFullSourceProof} from './full-provenance-github.mjs';
import {FullSourceAttestationService} from './full-source-attestation-service.mjs';
import {sourceAttestationReceipt,D1FullSourceAttestationStore} from
 './full-source-attestation-store.mjs';
import {handle} from './index.mjs';

const SHA=v=>createHash('sha256').update(v).digest('hex');
const UUID='123e4567-e89b-42d3-a456-426614174601',HEAD='a'.repeat(40);
const input={
 schema_version:HANDOFF_SCHEMA,handoff_id:UUID,kind:HANDOFF_KIND,agent:'merlin',
 benchmark:'policyImplementation',scenario_id:'dialysisClinic',case_index:0,mode:'sfd',
 commit_sha:HEAD,source_sha256:'b'.repeat(64),
 agent_config_sha256:'c'.repeat(64),prompt_sha256:'d'.repeat(64),
 initial_model_sha256:'e'.repeat(64),parameters_sha256:'f'.repeat(64)
};
let row,good;
async function setup(){
 const digest=await digestHandoff(input);
 row={...input,state:'REGISTERED_UNVERIFIED',execution_allowed:0,
  provenance_verified:0,github_run_id:null,manifest_sha256:digest};
 good=sourceProofFor(input,digest);
}
function crc32(b){let c=0xffffffff;for(const x of b){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0}
function zipStored(name,data){
 const filename=Buffer.from(name),value=Buffer.from(data),crc=crc32(value);
 const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);
 local.writeUInt16LE(filename.length,26);local.writeUInt32LE(crc,14);
 local.writeUInt32LE(value.length,18);local.writeUInt32LE(value.length,22);
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);
 central.writeUInt32LE(crc,16);central.writeUInt32LE(value.length,20);
 central.writeUInt32LE(value.length,24);central.writeUInt16LE(filename.length,28);
 const offset=local.length+filename.length+value.length;
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);
 end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);
 end.writeUInt32LE(central.length+filename.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([local,filename,value,central,filename,end]);
}
const baseRun=()=>{
 return {id:100,workflow_id:95,event:'workflow_dispatch',
  head_branch:'main',head_sha:HEAD,display_title:'Buffalo full source proof '+UUID,
  repository:{full_name:'yudocyudoc/buffalo-01'},
  head_repository:{full_name:'yudocyudoc/buffalo-01'},
  status:'completed',conclusion:'success',
  created_at:'2026-11-21T20:20:00Z',run_attempt:1};
};
function githubMock(overrides={}){
 const run={...baseRun(),...(overrides.run||{})};
 const proof=overrides.proof??good;
 const zip=overrides.zip??zipStored(SOURCE_PROOF_MEMBER,JSON.stringify(proof));
 const artifact={id:300,name:'buffalo-full-source-'+UUID,expired:false,
  size_in_bytes:zip.length,digest:'sha256:'+SHA(zip),...(overrides.artifact||{})};
 const workflow={id:95,path:'.github/workflows/'+SOURCE_PROOF_WORKFLOW,
  ...(overrides.workflow||{})};
 const calls=[];
 const transport=async (url,options)=>{
  const path=new URL(url).pathname;
  calls.push([path,options.method]);
  if(path.endsWith('/actions/workflows/'+SOURCE_PROOF_WORKFLOW))
   return Response.json(workflow);
  if(path.endsWith('/actions/runs/100'))return Response.json(run);
  if(path.endsWith('/actions/runs/100/artifacts'))
   return Response.json({total_count:overrides.total_count??1,
    artifacts:overrides.artifacts??[artifact]});
  if(path.endsWith('/actions/artifacts/300/zip'))return new Response(zip);
  return Response.json({message:'missing'},{status:404});
 };
 return {github:new GitHubFullSourceProof('TEST_MOCK_TOKEN',transport),calls,artifact};
}
test.beforeEach(setup);

test('derived metadata proof binds all original manifest fields and can be independently compared',async()=>{
 assert.deepEqual(await checkSourceProof(row,baseRun(),good),good);
 for(const pair of [
  ['agent','themis'],['scenario_id','otherScenario'],['case_index',1],
  ['commit','f'.repeat(40)],['source_sha256','0'.repeat(64)],
  ['agent_config_sha256','0'.repeat(64)],['prompt_sha256','0'.repeat(64)],
  ['initial_model_sha256','0'.repeat(64)],['parameters_sha256','0'.repeat(64)],
  ['manifest_sha256','0'.repeat(64)],['workflow','paid-agent-case.yml']
 ])await assert.rejects(()=>checkSourceProof(row,baseRun(),{...good,[pair[0]]:pair[1]}),
  /SOURCE_PROOF_/);
 await assert.rejects(()=>checkSourceProof(row,baseRun(),{...good,paid:true}),/SOURCE_PROOF_RESULT_FIELDS/);
 await assert.rejects(()=>checkSourceProof(row,baseRun(),{...good,evidence:{kind:'MODEL_PASSED'}}),/SOURCE_PROOF_EVIDENCE_KIND/);
 await assert.rejects(()=>checkSourceProof({...row,manifest_sha256:'0'.repeat(64)},baseRun(),good),
  /SOURCE_PROOF_HANDOFF_DB_DIGEST_DRIFT/);
});
test('one authenticated GitHub workflow_dispatch run and ZIP prove declared source metadata only',async()=>{
 const {github,calls}=githubMock();
 const verified=await github.verify(row,100);
 assert.equal(verified.github_run_id,100);
 assert.equal(verified.github_artifact_id,300);
 assert.equal(verified.manifest_sha256,row.manifest_sha256);
 assert.equal(verified.artifact_sha256,SHA(zipStored(SOURCE_PROOF_MEMBER,JSON.stringify(good))));
 assert.equal(calls.length,4);
 assert(calls.every(([,verb])=>verb==='GET'));
 assert(calls.every(([path])=>!path.includes('paid-agent-case')));
});
test('rejects wrong GitHub run identity, branch, commit, rerun and unsuccessful run',async()=>{
 const modified=[
  {workflow_id:96},{event:'push'},{head_branch:'fake'},
  {head_sha:'f'.repeat(40)},{display_title:'Unrelated handoff'},
  {repository:{full_name:'stranger/repo'}},{head_repository:{full_name:'stranger/repo'}},
  {run_attempt:2},{status:'in_progress'},{conclusion:'failure'},
  {created_at:'bad time'}
 ];
 for(const run of modified){
  await assert.rejects(()=>githubMock({run}).github.verify(row,100),/SOURCE_PROOF_/);
 }
 await assert.rejects(()=>githubMock({workflow:{path:'.github/workflows/paid-agent-case.yml'}})
  .github.verify(row,100),/SOURCE_PROOF_BAD_WORKFLOW/);
});
test('rejects multiple, missing, forged, expired or corrupted GitHub artifacts',async()=>{
 for(const options of [
  {total_count:2},
  {artifact:{name:'evil.zip'}},
  {artifact:{expired:true}},
  {artifact:{size_in_bytes:999999}},
  {artifact:{digest:'sha256:'+'0'.repeat(64)}},
  {proof:{...good,scenario_id:'wrongScenario'}},
  {proof:{...good,manifest_sha256:'0'.repeat(64)}},
  {zip:zipStored('some-other.json',JSON.stringify(good))}
 ]){
  await assert.rejects(()=>githubMock(options).github.verify(row,100),/SOURCE_PROOF_|ZIP_/);
 }
});
test('metadata producer recomputes digest from original DEV case and refuses caller-only forged hashes',async()=>{
 const sourceManifest={
  status:'PASS',mode:'SOURCE_READ_ONLY',source_sha256:input.source_sha256,
  agents:[{id:'merlin',config:'agent/config/merlin.md'}],
  components:[{path:'agent/config/merlin.md',sha256:input.agent_config_sha256}]
 };
 const model={variables:[{name:'A'}],relationships:[]},params={mode:'sfd'};
 const groups={policyImplementation:['meetsGoal','intact','sensible'].map(criterion=>({
  prompt:'source prompt',currentModel:model,additionalParameters:params,
  heldOut:false,expectations:{scenario:'dialysisClinic',criterion}
 }))};
 const common={handoff_id:UUID,agent:'merlin',case_index:0,commit_sha:HEAD,groups,sourceManifest};
 const {buildHandoff}=await import('../../scripts/full-integration/prepare-handoff.mjs');
 const derived=await buildHandoff(common);
 const proof=await produceSourceProof({...common,expected_manifest_sha256:derived.manifest_sha256});
 assert.equal(proof.manifest_sha256,derived.manifest_sha256);
 assert.equal(proof.evidence.kind,'GITHUB_SOURCE_METADATA_ONLY');
 await assert.rejects(()=>produceSourceProof({...common,expected_manifest_sha256:'0'.repeat(64)}),
  /FULL_SOURCE_PROOF_MANIFEST_MISMATCH/);
 await assert.rejects(()=>produceSourceProof({...common,agent:'INVALID',
  expected_manifest_sha256:derived.manifest_sha256}),/FULL_SOURCE_PROOF_AGENT_NOT_ALLOWED/);
});
test('service saves evidence once after authenticated proof, never dispatches, and blocks conflicting run IDs',async()=>{
 const {github,calls}=githubMock();
 const handoffs={read:async id=>id===UUID?row:null};
 const events=[],attestations={
  saved:null,
  async read(){return this.saved},
  async save(r,e){
   assert.equal(r.handoff_id,UUID);assert.equal(e.github_run_id,100);
   if(!this.saved){this.saved={...e,proof_schema:'BUFFALO_FULL_SOURCE_PROOF_V1',
    proof_status:'SOURCE_ATTESTED',workflow:SOURCE_PROOF_WORKFLOW,execution_allowed:0,
    created_at:'2026-11-21T22:00:00Z'};events.push('SOURCE_ATTESTED')}
   return {created:events.length===1&&events[0]==='SOURCE_ATTESTED',row:this.saved};
  }
 };
 const svc=new FullSourceAttestationService(handoffs,attestations,github);
 assert.equal((await svc.inspect(UUID)).body.attested,false);
 assert.equal((await svc.attest(UUID,100)).code,201);
 const seen=calls.length;
 assert.equal((await svc.attest(UUID,100)).code,200);
 assert.equal(calls.length,seen);
 assert.equal((await svc.attest(UUID,200)).body.error,'SOURCE_PROOF_ALREADY_BOUND');
 assert.equal((await svc.inspect(UUID)).body.attested,true);
 assert.equal(events.length,1);
});
test('service refuses fake evidence and creates no positive D1 receipt',async()=>{
 const handoffs={read:async()=>row};
 const attestations={read:async()=>null,save:async()=>{throw Error('SHOULD_NEVER_SAVE')}};
 const github=githubMock({run:{run_attempt:2}}).github;
 const svc=new FullSourceAttestationService(handoffs,attestations,github);
 assert.deepEqual((await svc.attest(UUID,100)).body,{error:'SOURCE_PROOF_NOT_VERIFIED',attested:false});
 assert.equal((await svc.attest(UUID,0)).body.error,'INVALID_RUN_ID');
});
test('API restricts source verification route, permits only run ID and preserves old task route',async()=>{
 const token='x'.repeat(48),env={DB:{},CONTROL_API_TOKEN:token,GITHUB_FINE_GRAINED_TOKEN:'test'};
 const source={
  attest:async(id,runId)=>({code:200,body:{id,runId,attested:false}}),
  inspect:async()=>({code:200,body:{attested:false}})
 };
 const deps={store:{},github:{},fullSourceAttestationService:source};
 const req=(suffix,method='GET',body,auth=true)=>new Request('https://fake.invalid/v1/full/handoffs/'+UUID+'/'+suffix,{
  method,headers:{...(auth?{authorization:'Bearer '+token}:{}),'content-type':'application/json'},
  ...(body?{body:JSON.stringify(body)}:{})
 });
 const ok=await handle(req('verify-source','POST',{github_run_id:100}),env,deps);
 assert.equal(ok.status,200);
 const body=await ok.json();assert.equal(body.runId,100);
 assert.equal((await handle(req('source-proof'),env,deps)).status,200);
 assert.equal((await handle(req('verify-source','POST',{github_run_id:100},false),env,deps)).status,401);
 for(const bad of [{github_run_id:100,command:'x'},{github_run_id:100,paid:true},{}]){
  assert.equal((await handle(req('verify-source','POST',bad),env,deps)).status,400);
 }
 assert.equal((await handle(req('dispatch','POST',{github_run_id:100}),env,deps)).status,404);
});
test('D1 provenance store requires binding and source receipt always disables execution',()=>{
 assert.throws(()=>new D1FullSourceAttestationStore({}),/D1_BINDING_REQUIRED/);
 const receipt=sourceAttestationReceipt({...row,
  proof_schema:'BUFFALO_FULL_SOURCE_PROOF_V1',proof_status:'SOURCE_ATTESTED',
  workflow:SOURCE_PROOF_WORKFLOW,github_run_id:100,created_at:'2026-11-21'});
 assert.equal(receipt.execution_allowed,false);
});
