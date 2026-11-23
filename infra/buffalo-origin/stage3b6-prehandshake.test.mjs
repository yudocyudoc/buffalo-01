import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareStage3B6} from './stage3b6-preflight.mjs';
import {checkStage3B6PreHandshake} from './stage3b6-prehandshake.mjs';
import {syntheticStage3B6Evidence as sample,testSha,testDigest,testModel,testHandoff,testAccount} from './stage3b6-test-fixture.mjs';

const active=()=>{
 const e=sample();
 e.cloudflare_readback={
  account_id:testAccount,container_app_count:1,
  container_app_name:'buffalo-private-origin-lab',
  container_app_policy:'durable_object',
  container_running_instances:0,container_starting_instances:0,
  container_image_preparation_status:'ready',
  origin_worker_name:'buffalo-private-origin-router-lab',
  origin_workers_dev_enabled:false,origin_previews_enabled:false,
  origin_public_routes_count:0,origin_schedules_count:0,
  origin_image_ref:e.registry_pull.reference,
  origin_image_map_proof:'WRANGLER_DEPLOY_READBACK',
  origin_mode:'HANDSHAKE_ONLY_NO_AGENT_PROCESS',
  origin_commit_sha:testSha,origin_model_sha256:testModel,
  origin_secret_names:['BUFFALO_ORIGIN_AUTH_KEY','BUFFALO_ORIGIN_UPGRADE_TOKEN'],
  bridge_name:'buffalo-original-ws-bridge-lab',
  bridge_workers_dev_enabled:false,bridge_previews_enabled:false,
  bridge_public_routes_count:0,bridge_schedules_count:0,
  bridge_service_binding_target:'buffalo-private-origin-router-lab',
  bridge_binding_names:['BUFFALO_ORIGIN','DB'],
  bridge_secret_names:[
   'BUFFALO_ORIGIN_AUTH_KEY','BUFFALO_ORIGIN_UPGRADE_TOKEN','BUFFALO_WS_LAB_BEARER'
  ],
  bridge_mode:'HANDSHAKE_ONLY_NO_AGENT_PROCESS',
  bridge_handoff_id:testHandoff,bridge_runtime_commit_sha:testSha,
  d1_live_grant_count:0,d1_handoff_id:testHandoff,
  d1_source_proof_status:'SOURCE_ATTESTED',d1_source_commit_sha:testSha,
  production_workers_changed:false
 };
 return e;
};
test('predeploy rejects an existing Container application even when valid',()=>{
 assert.equal(prepareStage3B6(active()).code,'CLOUDFLARE_BASELINE_NOT_ISOLATED');
});
test('postdeploy gate accepts only correctly attested, configured private topology',()=>{
 const e=active();
 const r=checkStage3B6PreHandshake(e);
 assert.equal(r.valid,true);
 assert.equal(r.code,'OFFLINE_HANDSHAKE_CONFIG_READY_NOT_CONNECTED');
 assert.equal(r.image_ref,e.registry_pull.reference);
 assert.equal(r.handoff_id,testHandoff);
});
test('no image map, not-ready image, or wrong registry pin block postdeploy gate',()=>{
 for(const modify of [
  {origin_image_map_proof:'DECLARED'},
  {origin_image_ref:'registry.cloudflare.com/'+testAccount+'/buffalo-private-origin@sha256:'+'f'.repeat(64)},
  {container_image_preparation_status:'pending'},
  {container_app_count:0},
  {container_running_instances:1},
  {container_starting_instances:1},
  {origin_workers_dev_enabled:true},
  {origin_previews_enabled:true},
  {origin_public_routes_count:1},
  {origin_model_sha256:'a'.repeat(64)},
  {origin_commit_sha:'f'.repeat(40)}
 ]){
  const e=active();Object.assign(e.cloudflare_readback,modify);
  assert.equal(checkStage3B6PreHandshake(e).valid,false,JSON.stringify(modify));
 }
});
test('no secrets, origin binding, or mismatched handoff block',()=>{
 for(const modify of [
  {origin_secret_names:[]},
  {origin_secret_names:['BUFFALO_ORIGIN_AUTH_KEY','BUFFALO_ORIGIN_UPGRADE_TOKEN','EXTRA']},
  {bridge_binding_names:['DB']},
  {bridge_service_binding_target:'unrelated-service'},
  {bridge_secret_names:[]},
  {bridge_handoff_id:'6bce82ee-d179-4a2e-9317-f7f4708c5be2'.replace(/.$/,'1')},
  {bridge_runtime_commit_sha:'a'.repeat(40)},
  {bridge_workers_dev_enabled:true},
  {bridge_public_routes_count:1},
  {d1_live_grant_count:1},
  {d1_source_proof_status:'REGISTERED_UNVERIFIED'},
  {production_workers_changed:true}
 ]){
  const e=active();Object.assign(e.cloudflare_readback,modify);
  assert.equal(checkStage3B6PreHandshake(e).valid,false,JSON.stringify(modify));
 }
});
test('same-run receipt and source proof stay mandatory after deployment',()=>{
 for(const change of [
  {registry_receipt:undefined},
  {registry_receipt:{...sample().registry_receipt,github_run_id:77}},
  {source_attestation:{...sample().source_attestation,proof_status:'UNVERIFIED'}},
  {local_build:{...sample().local_build,node_tests_passed:3}}
 ]){
  const e=active();Object.assign(e,change);
  assert.equal(checkStage3B6PreHandshake(e).valid,false);
 }
});
