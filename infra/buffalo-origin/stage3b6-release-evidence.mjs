/**
 * Stage 3B-6: pure OFFLINE release evidence validator.
 * Inputs are evidence CLAIMS; only independent API and artifact readbacks
 * establish truth. No network, no grants, no OCI push or deployment here.
 */
export const STAGE3B6_SCHEMA='BUFFALO_STAGE3B6_PREDEPLOY_EVIDENCE_V1';
const MODE='HANDSHAKE_ONLY_NO_AGENT_PROCESS';
const hex40=/^[a-f0-9]{40}$/;
const hex64=/^[a-f0-9]{64}$/;
const digest=/^sha256:[a-f0-9]{64}$/;
const account=/^[a-f0-9]{32}$/;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const image=/^registry\.cloudflare\.com\/([a-f0-9]{32})\/buffalo-private-origin@(?<digest>sha256:[a-f0-9]{64})$/;
const fail=code=>({valid:false,code});

export function validateStage3B6Release(e){
 if(!e||typeof e!=='object'||Array.isArray(e))return fail('EVIDENCE_MISSING');
 if(e.schema!==STAGE3B6_SCHEMA)return fail('SCHEMA_INVALID');
 if(e.mode!==MODE)return fail('HANDSHAKE_ONLY_REQUIRED');
 if(!hex40.test(e.source_commit??'')||!account.test(e.account_id??''))
  return fail('SOURCE_OR_ACCOUNT_INVALID');
 const b=e.local_build;
 if(b?.schema!=='BUFFALO_PRIVATE_ORIGIN_BUILD_RECEIPT_V1'||
  b.status!=='CI_BUILD_TESTED_NO_DEPLOY'||
  b.source_commit!==e.source_commit||
  !digest.test(b.image_manifest_digest??'')||
  !digest.test(b.image_config_digest??'')||
  !hex64.test(b.dockerfile_sha256??'')||
  !hex64.test(b.dockerignore_sha256??'')||
  b.security_mode!==MODE||
  b.published_to_registry!==false||
  b.cloudflare_container_deployed!==false||
  b.agent_turns!==0||b.provider_requests!==0||
  !Number.isSafeInteger(b.github_run_id)||b.github_run_id<=0||
  !Number.isSafeInteger(b.github_run_attempt)||b.github_run_attempt<1||
  b.node_tests_passed!==4)
  return fail('LOCAL_IMAGE_RECEIPT_NOT_VERIFIED');
 const reg=e.registry_receipt;
 const pull=e.registry_pull;
 const m=image.exec(pull?.reference??'');
 if(reg?.schema!=='BUFFALO_ORIGIN_PRIVATE_REGISTRY_RELEASE_V1'||
  reg.state!=='REGISTRY_IMAGE_PULLED_AND_VERIFIED_NO_DEPLOY'||
  reg.source_commit!==e.source_commit||
  reg.github_run_id!==b.github_run_id||
  reg.github_run_attempt!==b.github_run_attempt||
  reg.local_manifest_digest!==b.image_manifest_digest||
  reg.remote_manifest_digest!==b.image_manifest_digest||
  reg.remote_image_config_digest!==b.image_config_digest||
  reg.remote_ref!==pull?.reference||
  reg.agent_turns!==0||
  reg.cloudflare_container_started!==false||
  reg.signature_proof!==false||
  !m||m[1]!==e.account_id||m.groups.digest!==b.image_manifest_digest||
  pull.manifest_digest!==b.image_manifest_digest||
  pull.config_digest!==b.image_config_digest||
  pull.image_source_sha!==e.source_commit||
  pull.proof!=='INDEPENDENT_REGISTRY_PULL_AND_INSPECT')
  return fail('REGISTRY_IMAGE_IDENTITY_UNPROVEN');
 const s=e.source_attestation;
 if(!uuid.test(e.handoff_id??'')||
  s?.handoff_id!==e.handoff_id||
  s.proof_status!=='SOURCE_ATTESTED'||
  s.commit_sha!==e.source_commit||s.proof_commit_sha!==e.source_commit||
  s.agent!=='merlin'||s.mode!=='sfd'||
  !hex64.test(s.initial_model_sha256??'')||
  !hex64.test(s.manifest_sha256??'')||
  s.proof_manifest_sha256!==s.manifest_sha256||
  s.execution_allowed!==false)
  return fail('RUNTIME_SOURCE_ATTESTATION_MISSING');
 const l=e.limits;
 if(l?.fixed_singleton_name!=='buffalo-original-handshake-only'||
  l.instance!=='lite'||l.enable_internet!==false||
  l.inactivity_timeout_ms!==60000||l.agent_execution_enabled!==false)
  return fail('BUDGET_OR_ISOLATION_UNSAFE');
 return {valid:true,code:'RELEASE_EVIDENCE_SHAPE_OK_NOT_VERIFIED',reference:pull.reference};
}
