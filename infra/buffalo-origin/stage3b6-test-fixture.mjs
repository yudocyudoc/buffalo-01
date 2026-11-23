/**
 * Synthetic test-only fixture. Never use as live Cloudflare or GitHub evidence.
 * The values are invented on purpose: only Wrangler build/dry-run validation.
 */
import {STAGE3B6_SCHEMA} from './stage3b6-release-evidence.mjs';
export const testSha='c'.repeat(40);
export const testAccount='a'.repeat(32);
export const testDigest='sha256:'+'b'.repeat(64);
export const testConfigDigest='sha256:'+'d'.repeat(64);
export const testModel='e'.repeat(64);
export const testManifest='f'.repeat(64);
export const testHandoff='6bce82ee-d179-4a2e-9317-f7f4708c5be2';
export function syntheticStage3B6Evidence(){
 const reference=`registry.cloudflare.com/${testAccount}/buffalo-private-origin@${testDigest}`;
 return {
  schema:STAGE3B6_SCHEMA,mode:'HANDSHAKE_ONLY_NO_AGENT_PROCESS',
  account_id:testAccount,source_commit:testSha,handoff_id:testHandoff,
  local_build:{
   schema:'BUFFALO_PRIVATE_ORIGIN_BUILD_RECEIPT_V1',
   status:'CI_BUILD_TESTED_NO_DEPLOY',source_commit:testSha,
   github_run_id:12345,github_run_attempt:1,node_tests_passed:4,
   image_manifest_digest:testDigest,image_config_digest:testConfigDigest,
   dockerfile_sha256:'1'.repeat(64),dockerignore_sha256:'2'.repeat(64),
   security_mode:'HANDSHAKE_ONLY_NO_AGENT_PROCESS',
   published_to_registry:false,cloudflare_container_deployed:false,
   agent_turns:0,provider_requests:0
  },
  registry_receipt:{
   schema:'BUFFALO_ORIGIN_PRIVATE_REGISTRY_RELEASE_V1',
   state:'REGISTRY_IMAGE_PULLED_AND_VERIFIED_NO_DEPLOY',
   source_commit:testSha,github_run_id:12345,github_run_attempt:1,
   local_manifest_digest:testDigest,remote_manifest_digest:testDigest,
   remote_image_config_digest:testConfigDigest,remote_ref:reference,
   agent_turns:0,cloudflare_container_started:false,signature_proof:false
  },
  registry_pull:{
   reference,manifest_digest:testDigest,config_digest:testConfigDigest,
   image_source_sha:testSha,proof:'INDEPENDENT_REGISTRY_PULL_AND_INSPECT'
  },
  source_attestation:{
   handoff_id:testHandoff,proof_status:'SOURCE_ATTESTED',
   commit_sha:testSha,proof_commit_sha:testSha,
   agent:'merlin',mode:'sfd',manifest_sha256:testManifest,
   proof_manifest_sha256:testManifest,initial_model_sha256:testModel,
   execution_allowed:false
  },
  cloudflare_readback:{
   account_id:testAccount,container_app_count:0,
   container_running_instances:0,
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
 };
}
