/**
 * Stage 3B-6. Pure OFFLINE release gate. It never invokes Cloudflare,
 * grants access, pushes OCI images or starts Containers.
 *
 * Input is a supplied evidence snapshot, NOT an authoritative Cloudflare read.
 * A PASS means a constrained Wrangler configuration can be prepared for review,
 * not that any deployment or paid start has been authorized.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export const STAGE3B6_SCHEMA='BUFFALO_STAGE3B6_PREDEPLOY_EVIDENCE_V1';
const MODE='HANDSHAKE_ONLY_NO_AGENT_PROCESS';
const hex40=/^[a-f0-9]{40}$/;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hex64=/^[a-f0-9]{64}$/;
const dig=/^sha256:[a-f0-9]{64}$/;
const account=/^[a-f0-9]{32}$/;
const REGISTRY=/^registry\.cloudflare\.com\/([a-f0-9]{32})\/buffalo-private-origin@(?<digest>sha256:[a-f0-9]{64})$/;
const blocked=(message)=>({valid:false,code:message});
const valid=(config)=>({valid:true,code:'OFFLINE_CONFIG_READY_NOT_DEPLOYED',config});

export function prepareStage3B6(evidence){
  if(!evidence||typeof evidence!=='object'||Array.isArray(evidence))
    return blocked('EVIDENCE_MISSING');
  if(evidence.schema!==STAGE3B6_SCHEMA) return blocked('SCHEMA_INVALID');
  if(evidence.mode!==MODE) return blocked('HANDSHAKE_ONLY_REQUIRED');
  const sha=evidence.source_commit;
  if(!hex40.test(sha??'')||!account.test(evidence.account_id??''))
    return blocked('SOURCE_OR_ACCOUNT_INVALID');
  const built=evidence.local_build;
  if(built?.schema!=='BUFFALO_PRIVATE_ORIGIN_BUILD_RECEIPT_V1'||
    built.status!=='CI_BUILD_TESTED_NO_DEPLOY'||
    built.source_commit!==sha||
    !dig.test(built.image_manifest_digest??'')||
    !dig.test(built.image_config_digest??'')||
    !hex64.test(built.dockerfile_sha256??'')||
    !hex64.test(built.dockerignore_sha256??'')||
    built.security_mode!==MODE||
    built.published_to_registry!==false||
    built.cloudflare_container_deployed!==false||
    built.agent_turns!==0||built.provider_requests!==0)
    return blocked('LOCAL_IMAGE_RECEIPT_NOT_VERIFIED');
  const registry=evidence.registry_pull;
  const m=REGISTRY.exec(registry?.reference??'');
  if(!m||m[1]!==evidence.account_id||
    m.groups.digest!==built.image_manifest_digest||
    registry.manifest_digest!==built.image_manifest_digest||
    registry.config_digest!==built.image_config_digest||
    registry.image_source_sha!==sha||
    registry.proof!=='INDEPENDENT_REGISTRY_PULL_AND_INSPECT')
    return blocked('REGISTRY_IMAGE_IDENTITY_UNPROVEN');
  const source=evidence.source_attestation;
  if(!uuid.test(evidence.handoff_id??'')||
    source?.handoff_id!==evidence.handoff_id||
    source?.proof_status!=='SOURCE_ATTESTED'||
    source.commit_sha!==sha||source.proof_commit_sha!==sha||
    source.agent!=='merlin'||source.mode!=='sfd'||
    !hex64.test(source.initial_model_sha256??'')||
    !hex64.test(source.manifest_sha256??'')||
    source.proof_manifest_sha256!==source.manifest_sha256||
    source.execution_allowed!==false)
    return blocked('RUNTIME_SOURCE_ATTESTATION_MISSING');
  const cloud=evidence.cloudflare_readback;
  if(cloud?.account_id!==evidence.account_id||
    cloud.container_app_count!==0||
    cloud.container_running_instances!==0||
    cloud.bridge_name!=='buffalo-original-ws-bridge-lab'||
    cloud.bridge_workers_dev_enabled!==false||
    cloud.bridge_previews_enabled!==false||
    cloud.bridge_service_binding_present!==false||
    cloud.bridge_secrets_count!==0||
    cloud.bridge_schedules_count!==0||
    cloud.production_workers_changed!==false)
    return blocked('CLOUDFLARE_BASELINE_NOT_ISOLATED');
  const limit=evidence.limits;
  if(limit?.fixed_singleton_name!=='buffalo-original-handshake-only'||
    limit?.instance!=='lite'||
    limit?.enable_internet!==false||limit?.inactivity_timeout_ms!==60000||
    limit?.agent_execution_enabled!==false)
    return blocked('BUDGET_OR_ISOLATION_UNSAFE');
  // No credentials, source model, grants or enable flags are emitted to config.
  const cfg={
    name:'buffalo-private-origin-router-lab',
    main:'infra/buffalo-origin/container-controller.mjs',
    compatibility_date:'2026-11-22',
    workers_dev:false,
    preview_urls:false,
    durable_objects:{bindings:[{
      name:'BUFFALO_CONTAINER',class_name:'BuffaloHandshakeContainer'
    }]},
    migrations:[{tag:'buffalo-private-origin-3b6-v1',
      new_sqlite_classes:['BuffaloHandshakeContainer']}],
    containers:[{
      name:'buffalo-private-origin-lab',
      class_name:'BuffaloHandshakeContainer',
      scheduling_policy:'durable_object',
      images:{base:{image:registry.reference}}
    }]
  };
  return valid(cfg);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2);
  // Deliberately no deploy/push, no default evidence, no implicit output file.
  if(args.length!==4||args[0]!=='--evidence'||args[2]!=='--out'){
    console.error('Usage: node stage3b6-preflight.mjs --evidence evidence.json --out /tmp/wrangler.buffalo.json');
    process.exitCode=2;
  }else{
    try{
      const result=prepareStage3B6(JSON.parse(readFileSync(args[1],'utf8')));
      if(!result.valid){
        console.error('STAGE3B6_BLOCKED '+result.code);
        process.exitCode=1;
      }else{
        writeFileSync(args[3],JSON.stringify(result.config,null,2)+'\n',{flag:'wx',mode:0o600});
        console.log('STAGE3B6_CONFIG_PREPARED_NO_DEPLOY '+args[3]);
      }
    }catch(e){
      console.error('STAGE3B6_FAILED '+(e?.code==='EEXIST'?'OUTPUT_ALREADY_EXISTS':'INVALID_INPUT_OR_PATH'));
      process.exitCode=1;
    }
  }
}
