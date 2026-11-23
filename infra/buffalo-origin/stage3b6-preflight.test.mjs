import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareStage3B6,STAGE3B6_SCHEMA} from './stage3b6-preflight.mjs';

const sha='c'.repeat(40),acc='a'.repeat(32);
const digest='sha256:'+'b'.repeat(64);
const configDigest='sha256:'+'d'.repeat(64);
const model='e'.repeat(64), manifest='f'.repeat(64);
const evidence=()=>({
 schema:STAGE3B6_SCHEMA,mode:'HANDSHAKE_ONLY_NO_AGENT_PROCESS',
 account_id:acc,source_commit:sha,
 handoff_id:'6bce82ee-d179-4a2e-9317-f7f4708c5be2',
 local_build:{
  schema:'BUFFALO_PRIVATE_ORIGIN_BUILD_RECEIPT_V1',
  status:'CI_BUILD_TESTED_NO_DEPLOY',source_commit:sha,
  image_manifest_digest:digest,image_config_digest:configDigest,
  dockerfile_sha256:'1'.repeat(64),dockerignore_sha256:'2'.repeat(64),
  security_mode:'HANDSHAKE_ONLY_NO_AGENT_PROCESS',
  published_to_registry:false,cloudflare_container_deployed:false,
  agent_turns:0,provider_requests:0
 },
 registry_pull:{
  reference:`registry.cloudflare.com/${acc}/buffalo-private-origin@${digest}`,
  manifest_digest:digest,config_digest:configDigest,image_source_sha:sha,
  proof:'INDEPENDENT_REGISTRY_PULL_AND_INSPECT'
 },
 source_attestation:{
  handoff_id:'6bce82ee-d179-4a2e-9317-f7f4708c5be2',
  proof_status:'SOURCE_ATTESTED',commit_sha:sha,proof_commit_sha:sha,
  agent:'merlin',mode:'sfd',manifest_sha256:manifest,
  proof_manifest_sha256:manifest,initial_model_sha256:model,
  execution_allowed:false
 },
 cloudflare_readback:{
  account_id:acc,container_app_count:0,container_running_instances:0,
  bridge_name:'buffalo-original-ws-bridge-lab',
  bridge_workers_dev_enabled:false,bridge_previews_enabled:false,
  bridge_service_binding_present:false,bridge_secrets_count:0,
  bridge_schedules_count:0,production_workers_changed:false
 },
 limits:{
  fixed_singleton_name:'buffalo-original-handshake-only',
  instance:'lite',enable_internet:false,
  inactivity_timeout_ms:60000,agent_execution_enabled:false
 }
});
test('valid evidence prepares only private Worker/DO config without credentials or deployment',()=>{
 const r=prepareStage3B6(evidence());
 assert.equal(r.valid,true);
 assert.equal(r.code,'OFFLINE_CONFIG_READY_NOT_DEPLOYED');
 assert.equal(r.config.workers_dev,false);
 assert.equal('migrations' in r.config,false);
 assert.deepEqual(r.config.exports,{BuffaloHandshakeContainer:{type:'durable-object',storage:'sqlite'}});
 assert.equal(r.config.preview_urls,false);
 assert.equal('max_instances' in r.config.containers[0],false);
 assert.equal(r.config.containers[0].scheduling_policy,'durable_object');
 assert.equal(r.config.containers[0].images.base.image,
   `registry.cloudflare.com/${acc}/buffalo-private-origin@${digest}`);
 const text=JSON.stringify(r.config);
 for(const field of ['AUTH_KEY','UPGRADE_TOKEN','SECRET','ALLOW_INFERENCE','execution_allowed'])
  assert.equal(text.includes(field),false);
 assert.equal('routes' in r.config,false);
 assert.equal('vars' in r.config,false);
 assert.equal('triggers' in r.config,false);
});
test('no registry digest or only old CI local image is never enough',()=>{
 for(const change of [
  {registry_pull:undefined},
  {registry_pull:{...evidence().registry_pull,proof:'DECLARED'}},
  {registry_pull:{...evidence().registry_pull,manifest_digest:'sha256:'+'9'.repeat(64)}},
  {registry_pull:{...evidence().registry_pull,reference:`registry.cloudflare.com/${acc}/buffalo-private-origin:latest`}},
  {local_build:{...evidence().local_build,source_commit:'3'.repeat(40)}},
  {local_build:{...evidence().local_build,agent_turns:1}},
 ]){
  const r=prepareStage3B6({...evidence(),...change});
  assert.equal(r.valid,false);
 }
});
test('prior handoff attestation cannot be applied to new Container commit',()=>{
 for(const a of [
  {handoff_id:'00000000-0000-4000-8000-000000000000'},
  {proof_commit_sha:'6'.repeat(40)},
  {commit_sha:'6'.repeat(40)},
  {proof_status:'REGISTERED_UNVERIFIED'},
  {initial_model_sha256:'bad'},
  {manifest_sha256:'0'.repeat(64)},
  {execution_allowed:true}
 ]){
  const e=evidence();e.source_attestation={...e.source_attestation,...a};
  assert.equal(prepareStage3B6(e).valid,false);
 }
});
test('public bridge, leaked secrets, existing app, or changed production workers block predeploy',()=>{
 const c=evidence().cloudflare_readback;
 for(const a of [
  {bridge_workers_dev_enabled:true},
  {bridge_previews_enabled:true},
  {bridge_service_binding_present:true},
  {bridge_secrets_count:1},
  {bridge_schedules_count:1},
  {container_app_count:1},
  {container_running_instances:1},
  {production_workers_changed:true}
 ]){
  assert.equal(prepareStage3B6({...evidence(),cloudflare_readback:{...c,...a}}).valid,false);
 }
});
test('only handshake mode, 1 lite instance, no Internet are eligible',()=>{
 for(const a of [
  {mode:'ALLOW_INFERENCE'},
  {limits:{...evidence().limits,fixed_singleton_name:'another-instance'}},
  {limits:{...evidence().limits,instance:'standard-2'}},
  {limits:{...evidence().limits,enable_internet:true}},
  {limits:{...evidence().limits,inactivity_timeout_ms:600000}},
  {limits:{...evidence().limits,agent_execution_enabled:true}}
 ]){
  assert.equal(prepareStage3B6({...evidence(),...a}).valid,false);
 }
});

test('new immutable handoff is eligible only with matching configured ID',()=>{
 const e=evidence();
 e.handoff_id='70000000-0000-4000-8000-000000000777';
 e.source_attestation.handoff_id=e.handoff_id;
 assert.equal(prepareStage3B6(e).valid,true);
 const bad=evidence();
 bad.handoff_id='70000000-0000-4000-8000-000000000777';
 assert.equal(prepareStage3B6(bad).code,'RUNTIME_SOURCE_ATTESTATION_MISSING');
});
