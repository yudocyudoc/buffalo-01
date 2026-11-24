// Fixed child entrypoint. The genuine WorkerSpawner is imported only after
// the Linux security context has been checked. No supplied commands or tools.
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,readdirSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
export function verifyLaunchContext(status){
 const read=name=>{const rows=status.split('\n').filter(x=>x.startsWith(name+':'));assert.equal(rows.length,1,'R2_LAUNCH_CONTEXT_FAILED');return rows[0].split(':')[1].trim()};
 const ids=read('Uid').split(/\s+/);
 assert(ids.length===4&&ids.every(x=>/^\d+$/.test(x)&&Number(x)>0&&x===ids[0]),'R2_LAUNCH_CONTEXT_FAILED');
 assert.equal(read('NoNewPrivs'),'1','R2_LAUNCH_CONTEXT_FAILED');
 for(const k of ['CapInh','CapPrm','CapEff','CapAmb'])assert.match(read(k),/^0+$/,'R2_LAUNCH_CONTEXT_FAILED');
 return true;
}
export async function checkImageImports(){
 assert.equal(process.platform,'linux');verifyLaunchContext(readFileSync('/proc/self/status','utf8'));
 assert.equal(process.env.ALLOW_UNSANDBOXED_FALLBACK,'false');
 const {originalCase}=await import('../../scripts/full-integration/original-merlin-worker-boundary.mjs');
 // Import the real worker's dependencies, not AgentWorker.js itself (which starts IPC).
 await import('../../agent/AgentOrchestrator.js');
 await import('../../agent/utilities/RagStore.js');
 await import('../../agent/utilities/TurnGate.js');
 const original=originalCase();
 assert.equal(original.scenario,'dialysisClinic');assert.match(original.configSha,/^[a-f0-9]{64}$/);
 return true;
}
export async function drive(){
 assert.equal(process.platform,'linux');verifyLaunchContext(readFileSync('/proc/self/status','utf8'));
 assert.equal(process.env.ALLOW_UNSANDBOXED_FALLBACK,'false');
 assert.match(process.env.GITHUB_SHA??'',/^[a-f0-9]{40}$/);
 const root=mkdtempSync(join('/tmp','buffalo-r2-'));
 process.env.TMPDIR=root;
 try{
  const {originalMerlinProcessProbe}=await import('../../scripts/full-integration/original-merlin-worker-boundary.mjs');
  const {default:proxy}=await import('../../agent/utilities/CredentialProxy.js');
  const p=await originalMerlinProcessProbe({commit:process.env.GITHUB_SHA});
  assert.throws(()=>proxy.origin,/has not completed/);
  assert.deepEqual(readdirSync(root),[],'R2_SESSION_DIRECTORY_NOT_REMOVED');
  rmSync(root,{recursive:true,force:true});
  assert(!existsSync(root));
  return {...p,launch_context_verified:true,proxy_stopped:true,session_directory_removed:true,inference_authorized:false};
 }finally{rmSync(root,{recursive:true,force:true})}
}
if(process.argv[1]?.endsWith('/driver.mjs')){
 if(process.argv[2]==='--check-context'){
  try{verifyLaunchContext(readFileSync('/proc/self/status','utf8'));console.log('R2_LAUNCH_CONTEXT_VERIFIED')}catch{process.exitCode=77}
 }else if(process.argv.length===3&&process.argv[2]==='--check-image'){
  try{await checkImageImports();console.log('R2_IMAGE_IMPORTS_MODEL_CONFIG_VERIFIED')}catch(e){console.error('R2_IMAGE_PREFLIGHT_FAILED',e?.message);process.exitCode=1}
 }else if(process.argv.length===2){
  try{const result=await drive();console.log('BUFFALO_R2_PROCESS='+JSON.stringify(result))}
  catch(e){const m=String(e?.message??'');const code=m.includes('R2_LAUNCH_CONTEXT_FAILED')?'LAUNCH_CONTEXT_FAILED':m.includes('3B8_REAL_WORKER_IPC_TIMEOUT')?'ORIGINAL_IPC_TIMEOUT':/bwrap sandbox is unavailable/i.test(m)?'ORIGINAL_WORKER_START_FAILED':'ORIGINAL_PROCESS_FAILED';console.error('BUFFALO_R2_DRIVER_FAILED '+code);process.exitCode=1}
 }else process.exitCode=78;
}
