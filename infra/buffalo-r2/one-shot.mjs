import {ID,MODE,validCommit,validKey,boundedReceipt} from './receipt.mjs';
import {validArmExpiry} from '../buffalo-r1/timing.mjs';
const CLAIM=ID;
const deny=()=>new Response('Not Found',{status:404});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export const validConfig=e=>e.R2_MODE===MODE&&validCommit(e.R2_EXPECTED_SHA)&&
 typeof e.R2_IMAGE_DIGEST==='string'&&/^sha256:[a-f0-9]{64}$/.test(e.R2_IMAGE_DIGEST)&&
 e.DB?.prepare&&e.R2_CONTAINER?.getByName&&
 validArmExpiry(e.R2_EXPIRES_AT);
const safe=(state)=>({status:state,probe_id:ID});
export {deny};
const TERMINAL=new Set(['R2_REMOTE_ORIGINAL_PROCESS_PASS','R2_REMOTE_ORIGINAL_PROCESS_BLOCKED',
 'R2_RUNTIME_FAILURE','R2_CLEANUP_UNCONFIRMED','R2_INTERRUPTED_NO_RETRY']);
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?
 Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
async function record(db,r){
 if(r?.probe_id!==ID||!TERMINAL.has(r.status)||typeof r.run_id!=='string')
  throw Error('R2_D1_INVALID_TERMINAL');
 // Append-only initial claim is a second one-shot barrier outside DO storage.
 const result=await db.prepare('UPDATE buffalo_stage3b8r1_receipts SET status=?,receipt_json=? WHERE probe_id=? AND run_id=? AND status=?')
  .bind(r.status,JSON.stringify(r),ID,r.run_id,'CLAIMED').run();
 if(result?.meta?.changes===1)return;
 if(result?.meta?.changes!==0)throw Error('R2_D1_TERMINAL_NOT_RECORDED');
 const row=await db.prepare('SELECT run_id,status,receipt_json FROM buffalo_stage3b8r1_receipts WHERE probe_id=?').bind(ID).first();
 if(row?.run_id===r.run_id&&row.status===r.status&&
    JSON.stringify(canonical(JSON.parse(row.receipt_json)))===JSON.stringify(canonical(r)))return;
 throw Error('R2_D1_TERMINAL_CONFLICT_OR_MISSING');
}
export async function runOneShot(ctx,env,{sleep=pause,randomUUID=()=>crypto.randomUUID(),
 randomKey=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('')}={}){
 if(!validConfig(env))return safe('R2_DISABLED');
 const container=ctx.container;
 if(!container?.images?.base||container.running)return safe('R2_CONTAINER_UNAVAILABLE_OR_RUNNING');
 const image=container.images.base;
 if(typeof image!=='string'||!image.endsWith('@'+env.R2_IMAGE_DIGEST))return safe('R2_IMAGE_DIGEST_MISMATCH');
 const commit=env.R2_EXPECTED_SHA,run=randomUUID(),key=randomKey();
 if(!validKey(key))throw Error('R2_BAD_KEY');
 const claim={probe_id:ID,run_id:run,source_commit:commit,image_digest:env.R2_IMAGE_DIGEST,
  status:'CLAIMED',claimed_at:new Date().toISOString()};
 const won=await ctx.storage.transaction(async tx=>{
  if(await tx.get(CLAIM))return false;
  await tx.put(CLAIM,claim);return true;
 });
 if(!won)return safe('R2_ALREADY_CLAIMED_NO_RETRY');
 // No start until D1 initial claim and watchdog are durable.
 const initial=await env.DB.prepare('INSERT INTO buffalo_stage3b8r1_receipts (probe_id,run_id,status,receipt_json) VALUES (?,?,?,?)')
  .bind(ID,run,'CLAIMED',JSON.stringify(claim)).run();
 if(initial?.meta?.changes!==1)throw Error('R2_D1_CLAIM_NOT_RECORDED');
 await ctx.storage.setAlarm(Date.now()+150000);
 if(!validConfig(env))throw Error('R2_AUTHORIZATION_EXPIRED_BEFORE_START');
 let result={...claim,status:'R2_RUNTIME_FAILURE',probe:null,phase:'START'};
 let attempted=false;
 try{
  attempted=true;
  container.start({image,instance:'basic',enableInternet:false,
   env:{R2_MODE:MODE,R2_EXPECTED_SHA:commit,R2_RUN_ID:run,R2_KEY:key,
    ALLOW_UNSANDBOXED_FALLBACK:'false'}});
  await container.setInactivityTimeout(120000);
  const port=container.getTcpPort(8080);
  result.phase='HEALTH';
  let ready=false;
  for(let i=0;i<30;i++){
   try{
    const res=await port.fetch('http://container/health',{signal:AbortSignal.timeout(800)});
    await res.body?.cancel();
    if(res.status===204){ready=true;break}
   }catch{}
   await sleep(200);
  }
  if(!ready)throw Error('R2_HEALTH_TIMEOUT');
  result.phase='IMAGE_INSPECT';
  const info=await container.inspect();
  if(info?.image!==image)throw Error('R2_RUNNING_IMAGE_MISMATCH');
  result.phase='PROBE';
  // Exactly ONE POST. No retry, even on ambiguous network failure.
  const response=await port.fetch('http://container/probe',{method:'POST',
   headers:{'x-buffalo-r2-key':key},signal:AbortSignal.timeout(95000)});
  if(response.status!==200){await response.body?.cancel();throw Error('R2_PROBE_HTTP_FAILED')}
  // Bound the transport body before parsing. No secret or raw stderr persisted.
  const reader=response.body.getReader();let bytes=0;let chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;
   bytes+=value.byteLength;if(bytes>4096)throw Error('R2_RECEIPT_OVERSIZE');chunks.push(value)}}
  finally{await reader.cancel().catch(()=>{})}
  const buf=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buf.set(chunk,offset);offset+=chunk.byteLength}
  const p=boundedReceipt(JSON.parse(new TextDecoder().decode(buf)),commit,run);
  result={...result,probe:p,status:p.status==='ORIGINAL_PROCESS_PASS'?'R2_REMOTE_ORIGINAL_PROCESS_PASS':'R2_REMOTE_ORIGINAL_PROCESS_BLOCKED',phase:'PROBE_RECEIPT'};
 }catch{ /* keep sanitized phase; failed transport cannot become PASS */ }
 finally{
  result={...result,container_start_attempted:attempted,internet_enabled_config:false,
   provider_requests_measured:false,inference_authorized:false,
   destroy_acknowledged:false,container_inspect_null:false,finished_at:new Date().toISOString()};
  try{
   await container.destroy();
   result.destroy_acknowledged=true;
   result.container_inspect_null=(await container.inspect())===null;
   if(!result.container_inspect_null)result.status='R2_CLEANUP_UNCONFIRMED';
  }catch{result.status='R2_CLEANUP_UNCONFIRMED'}
  // Persist evidence even when cleanup did not confirm. Never delete claim.
  const saved=await ctx.storage.transaction(async tx=>{
   const current=await tx.get(CLAIM);
   if(current?.status!=='CLAIMED'||current.run_id!==run)return false;
   await tx.put(CLAIM,result);return true;
  });
  if(!saved)throw Error('R2_TERMINAL_ALREADY_RECORDED');
  await record(env.DB,result);
  if(result.destroy_acknowledged&&result.container_inspect_null)await ctx.storage.deleteAlarm();
  console.log('BUFFALO_R2_RECEIPT='+JSON.stringify(result));
 }
 return result;
}
export async function cleanupAlarm(ctx,env){
 // Recovery only. NEVER starts a container or replays a probe.
 const claim=await ctx.storage.get(CLAIM);
 if(!claim)return;
 if(ctx.container?.running)await ctx.container.destroy();
 const stopped=(await ctx.container.inspect())===null;
 if(!stopped)throw Error('R2_WATCHDOG_CONTAINER_NOT_STOPPED');
 // Reconcile only the stored terminal result; never upgrade a failure.
 const terminal=await ctx.storage.transaction(async tx=>{
  const current=await tx.get(CLAIM);
  if(!current||current.run_id!==claim.run_id)throw Error('R2_WATCHDOG_CLAIM_CHANGED');
  if(current.status!=='CLAIMED')return current;
  const result={...current,status:'R2_INTERRUPTED_NO_RETRY',watchdog_ran:true,
   probe:null,container_inspect_null:true,inference_authorized:false};
  await tx.put(CLAIM,result);return result;
 });
 // Retry the evidence write, not the experiment. D1 CAS is idempotent.
 // Throw on transient failure to allow platform alarm retry.
 await record(env.DB,terminal);
 await ctx.storage.deleteAlarm();
 console.log('BUFFALO_R2_RECONCILED='+JSON.stringify(terminal));
}
