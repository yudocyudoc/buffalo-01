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

import {validateStage3B6Release} from './stage3b6-release-evidence.mjs';
export {STAGE3B6_SCHEMA} from './stage3b6-release-evidence.mjs';

const blocked=(code)=>({valid:false,code});
const valid=(config)=>({valid:true,code:'OFFLINE_CONFIG_READY_NOT_DEPLOYED',config});

export function prepareStage3B6(evidence){
  const release=validateStage3B6Release(evidence);
  if(!release.valid)return release;
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
    // Relative to the config file generated under infra/buffalo-origin.
    main:'./container-controller.mjs',
    compatibility_date:'2026-11-22',
    workers_dev:false,
    preview_urls:false,
    durable_objects:{bindings:[{
      name:'BUFFALO_CONTAINER',class_name:'BuffaloHandshakeContainer'
    }]},
    exports:{BuffaloHandshakeContainer:{type:'durable-object',storage:'sqlite'}},
    containers:[{
      name:'buffalo-private-origin-lab',
      class_name:'BuffaloHandshakeContainer',
      scheduling_policy:'durable_object',
      images:{base:{image:release.reference}}
    }]
  };
  return valid(cfg);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2);
  // Deliberately no deploy/push, no default evidence, no implicit output file.
  if(args.length!==4||args[0]!=='--evidence'||args[2]!=='--out'){
    console.error('Usage: node stage3b6-preflight.mjs --evidence evidence.json --out infra/buffalo-origin/wrangler.stage3b6.generated.jsonc');
    process.exitCode=2;
  }else{
    try{
      const result=prepareStage3B6(JSON.parse(readFileSync(args[1],'utf8')));
      if(!result.valid){
        console.error('STAGE3B6_BLOCKED '+result.code);
        process.exitCode=1;
      }else{
        // The Wrangler config must sit alongside the Worker entrypoint.
        // Disallow arbitrary output paths that change relative resolution.
        const safePath=new RegExp('^infra/buffalo-origin/wrangler[.]stage3b6[.][a-z0-9_-]+[.]jsonc
          console.error('STAGE3B6_FAILED_CONFIG_OUTPUT_PATH_UNSAFE');
          process.exitCode=1;
        }else{
          writeFileSync(args[3],JSON.stringify(result.config,null,2)+'\n',{flag:'wx',mode:0o600});
          console.log('STAGE3B6_CONFIG_PREPARED_NO_DEPLOY '+args[3]);
        }
      }
    }catch(e){
      console.error('STAGE3B6_FAILED '+(e?.code==='EEXIST'?'OUTPUT_ALREADY_EXISTS':'INVALID_INPUT_OR_PATH'));
      process.exitCode=1;
    }
  }
}
);
        if(!safePath.test(args[3])){
          console.error('STAGE3B6_FAILED_CONFIG_OUTPUT_PATH_UNSAFE');
          process.exitCode=1;
        }else{
        writeFileSync(args[3],JSON.stringify(result.config,null,2)+'\n',{flag:'wx',mode:0o600});
        console.log('STAGE3B6_CONFIG_PREPARED_NO_DEPLOY '+args[3]);
        }
      }
    }catch(e){
      console.error('STAGE3B6_FAILED '+(e?.code==='EEXIST'?'OUTPUT_ALREADY_EXISTS':'INVALID_INPUT_OR_PATH'));
      process.exitCode=1;
    }
  }
}
);
          console.error('STAGE3B6_FAILED_CONFIG_OUTPUT_PATH_UNSAFE');
          process.exitCode=1;
        }else{
          writeFileSync(args[3],JSON.stringify(result.config,null,2)+'\n',{flag:'wx',mode:0o600});
          console.log('STAGE3B6_CONFIG_PREPARED_NO_DEPLOY '+args[3]);
        }
      }
    }catch(e){
      console.error('STAGE3B6_FAILED '+(e?.code==='EEXIST'?'OUTPUT_ALREADY_EXISTS':'INVALID_INPUT_OR_PATH'));
      process.exitCode=1;
    }
  }
}
);
        if(!safePath.test(args[3])){
          console.error('STAGE3B6_FAILED_CONFIG_OUTPUT_PATH_UNSAFE');
          process.exitCode=1;
        }else{
        writeFileSync(args[3],JSON.stringify(result.config,null,2)+'\n',{flag:'wx',mode:0o600});
        console.log('STAGE3B6_CONFIG_PREPARED_NO_DEPLOY '+args[3]);
        }
      }
    }catch(e){
      console.error('STAGE3B6_FAILED '+(e?.code==='EEXIST'?'OUTPUT_ALREADY_EXISTS':'INVALID_INPUT_OR_PATH'));
      process.exitCode=1;
    }
  }
}
