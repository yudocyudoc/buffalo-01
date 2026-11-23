import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareStage3B6,STAGE3B6_SCHEMA} from './stage3b6-preflight.mjs';

import {syntheticStage3B6Evidence,testSha as sha,testAccount as acc,
 testDigest as digest,testConfigDigest as configDigest,testModel as model,
 testManifest as manifest} from './stage3b6-test-fixture.mjs';
const evidence=syntheticStage3B6Evidence;
test('valid evidence prepares only private Worker/DO config without credentials or deployment',()=>{
 const r=prepareStage3B6(evidence());
 assert.equal(r.valid,true);
 assert.equal(r.code,'OFFLINE_CONFIG_READY_NOT_DEPLOYED');
 assert.equal(r.config.workers_dev,false);
 assert.equal(r.config.main,'./container-controller.mjs');
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
  {local_build:{...evidence().local_build,github_run_id:500}},
  {registry_receipt:undefined},
  {registry_receipt:{...evidence().registry_receipt,github_run_id:999}},
  {registry_receipt:{...evidence().registry_receipt,remote_image_config_digest:'sha256:'+'9'.repeat(64)}},
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
test('only handshake mode, fixed singleton, lite and no Internet are eligible',()=>{
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
