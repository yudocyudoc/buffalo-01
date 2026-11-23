/**
 * Post-deployment activation gate. This is NOT the predeploy gate.
 * It examines an operator-supplied snapshot; a PASS is not proof of live
 * WebSocket connectivity and does not execute any network or Container work.
 */
import {validateStage3B6Release} from './stage3b6-release-evidence.mjs';
const block=code=>({valid:false,code});
const identical=(actual,expected)=>Array.isArray(actual)&&actual.length===expected.length&&
 actual.every((x,i)=>x===expected[i]);

export function checkStage3B6PreHandshake(evidence){
 const release=validateStage3B6Release(evidence);
 if(!release.valid)return release;
 const c=evidence.cloudflare_readback;
 if(c?.account_id!==evidence.account_id||
  c.container_app_count!==1||
  c.container_app_name!=='buffalo-private-origin-lab'||
  c.container_app_policy!=='durable_object'||
  c.container_running_instances!==0||
  c.container_starting_instances!==0||
  c.container_image_preparation_status!=='ready'||
  c.origin_worker_name!=='buffalo-private-origin-router-lab'||
  c.origin_workers_dev_enabled!==false||
  c.origin_previews_enabled!==false||
  c.origin_schedules_count!==0||
  c.origin_public_routes_count!==0||
  c.origin_image_ref!==release.reference||
  c.origin_image_map_proof!=='WRANGLER_DEPLOY_READBACK'||
  c.origin_mode!=='HANDSHAKE_ONLY_NO_AGENT_PROCESS'||
  c.origin_commit_sha!==evidence.source_commit||
  c.origin_model_sha256!==evidence.source_attestation.initial_model_sha256)
  return block('ORIGIN_NOT_READY_OR_IMAGE_MAP_UNPROVEN');
 if(!identical(c.origin_secret_names,[
  'BUFFALO_ORIGIN_AUTH_KEY','BUFFALO_ORIGIN_UPGRADE_TOKEN']))
  return block('ORIGIN_SECRETS_NOT_CONFIGURED');
 if(c.bridge_name!=='buffalo-original-ws-bridge-lab'||
  c.bridge_workers_dev_enabled!==false||
  c.bridge_previews_enabled!==false||
  c.bridge_public_routes_count!==0||
  c.bridge_schedules_count!==0||
  c.bridge_service_binding_target!=='buffalo-private-origin-router-lab'||
  !identical(c.bridge_binding_names,['BUFFALO_ORIGIN','DB'])||
  !identical(c.bridge_secret_names,[
   'BUFFALO_ORIGIN_AUTH_KEY','BUFFALO_ORIGIN_UPGRADE_TOKEN','BUFFALO_WS_LAB_BEARER'])||
  c.bridge_mode!=='HANDSHAKE_ONLY_NO_AGENT_PROCESS'||
  c.bridge_handoff_id!==evidence.handoff_id||
  c.bridge_runtime_commit_sha!==evidence.source_commit)
  return block('PRIVATE_BRIDGE_NOT_READY');
 if(c.d1_live_grant_count!==0||
  c.d1_handoff_id!==evidence.handoff_id||
  c.d1_source_proof_status!=='SOURCE_ATTESTED'||
  c.d1_source_commit_sha!==evidence.source_commit||
  c.production_workers_changed!==false)
  return block('D1_OR_PRODUCTION_SAFETY_NOT_PROVEN');
 return {valid:true,code:'OFFLINE_HANDSHAKE_CONFIG_READY_NOT_CONNECTED',
  image_ref:release.reference,handoff_id:evidence.handoff_id};
}
