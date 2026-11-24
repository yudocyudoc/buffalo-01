// Runs Arena's real CLI, binding adapter and Buffalo's persistent task DO in
// local workerd. Only container lifecycle and egress telemetry are test doubles.
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {promisify} from 'node:util';
import {setTimeout as sleep} from 'node:timers/promises';
import {groups} from '../../evals/categories/policyImplementation.js';
import {MODEL} from './protocol.mjs';

const deps=createRequire(join(process.env.MERLIN_TEST_TOOLS,'entry.cjs'));
const {Miniflare}=deps('miniflare');
const {build}=deps('esbuild');
const arena=resolve(process.env.MERLIN_ARENA_PATH);
const root=await mkdtemp(join(tmpdir(),'merlin-arena-e2e-'));
const source=process.env.GITHUB_SHA;
const key=randomBytes(32).toString('hex');
const task=randomUUID();
const deadline=Date.now()+90000;
const model=groups.policyImplementation.find(x=>x.expectations.scenario==='dialysisClinic').currentModel;
const modelPath=join(root,'case.sdjson');
await writeFile(modelPath,JSON.stringify(model));
const child=spawn('/usr/bin/setpriv',['--inh-caps=-all','--ambient-caps=-all','--no-new-privs','--',
  process.execPath,'infra/private-merlin/origin.mjs'],{stdio:'inherit',env:{
    PATH:process.env.PATH,HOME:process.env.HOME,MERLIN_PHASE:'R',MERLIN_KEY:key,MERLIN_SOURCE:source,
    BUFFALO_IMAGE_SOURCE_SHA:source,MERLIN_EXPIRES:String(deadline),ALLOW_UNSANDBOXED_FALLBACK:'false'}});
const exit=once(child,'exit');
const bundle=async file=>(await build({entryPoints:[file],bundle:true,write:false,
  format:'esm',target:'es2022',external:['cloudflare:workers']})).outputFiles[0].text;
const cli=async(...args)=>{
  const {stdout}=await promisify(execFile)('python3',['-m','arena','private-merlin',...args,
    '--phase','R','--task-id',task,'--port','8791'],{cwd:arena,timeout:15000});
  return JSON.parse(stdout);
};
let mf;
try{
  let ready=false;
  for(let i=0;i<300 && child.exitCode===null;i++){
    try{if((await fetch('http://127.0.0.1:8080/health')).status===204){ready=true;break;}}catch{}
    await sleep(100);
  }
  assert(ready,'private origin startup');
  const common={modules:true,compatibilityDate:'2026-11-19'};
  const options={host:'127.0.0.1',port:8791,durableObjectsPersist:join(root,'storage'),workers:[
    {...common,name:'arena',script:await bundle(join(arena,'infra/private-merlin/client.mjs')),
      serviceBindings:{MERLIN:{name:'bridge',entrypoint:'ArenaMerlin'}}},
    {...common,name:'bridge',script:await bundle('infra/private-merlin/bridge.mjs'),
      durableObjects:{TASKS:{className:'MerlinTask',useSQLite:true}},
      serviceBindings:{ROUTER:{name:'fixture',entrypoint:'Router'}},bindings:{
        MERLIN_GRANT:JSON.stringify({phase:'R',project_id:'arena-igc',task_id:task,model_sha256:MODEL,
          source_commit:source,image_digest:'sha256:'+'0'.repeat(64),expires:deadline})}},
    {...common,name:'fixture',bindings:{KEY:key,TASK:task,SOURCE:source},script:`
      import {WorkerEntrypoint} from 'cloudflare:workers';
      export class Router extends WorkerEntrypoint {
        open(){return {deadline:Date.now()+60000};}
        fetch(){return fetch('http://127.0.0.1:8080/api/v1',{headers:{Upgrade:'websocket','x-merlin-key':this.env.KEY}});}
        result(){return null;}
        async finish(phase,transcript){
          const r=await fetch('http://127.0.0.1:8080/proof',{headers:{'x-merlin-key':this.env.KEY}});
          if(!r.ok||!transcript)throw Error('OFFLINE_WS_INCOMPLETE');
          const proof=await r.json();
          if(proof.session_id!==transcript.session_id || proof.exit?.code!==0)throw Error('OFFLINE_IDENTITY');
          return {status:'OFFLINE_ARENA_RECONNECTED',proof,task_id:this.env.TASK,source_commit:this.env.SOURCE,
            image_digest:'sha256:'+'0'.repeat(64),frames:transcript.frames};
        }
      }
      export default {fetch(){return new Response(null,{status:404});}};`}
  ]};
  mf=new Miniflare(options);await mf.ready;
  assert.equal((await cli('submit','--model',modelPath)).status,'QUEUED');
  let result;
  for(let i=0;i<60;i++){
    result=await cli('read');
    if(!['QUEUED','RUNNING'].includes(result.status))break;
    await sleep(500);
  }
  assert.equal(result?.status,'OFFLINE_ARENA_RECONNECTED',JSON.stringify(result));
  assert.deepEqual(result.receipt.proof.worker_frames,['get_current_model','error','agent_complete']);
  assert.equal(result.model_sha256,MODEL);
  await mf.dispose();mf=new Miniflare(options);await mf.ready;
  assert.deepEqual(await cli('read'),result);
  assert.deepEqual(await cli('submit','--model',modelPath),result);
  console.log('ARENA_CLI_REAL_WS_DURABLE_RECEIPT_AFTER_WORKERD_RESTART');
}finally{
  try{await mf?.dispose();}finally{child.kill();await exit;await rm(root,{recursive:true,force:true});}
}
