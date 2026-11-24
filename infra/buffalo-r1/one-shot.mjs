import {ID,MODE,validCommit,validKey,boundedReceipt} from './receipt.mjs';
const CLAIM='r1-namespace-claim-v1';
const deny=()=>new Response('Not Found',{status:404});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export const validConfig=e=>e.R1_MODE===MODE&&validCommit(e.R1_EXPECTED_SHA)&&
 typeof e.R1_IMAGE_DIGEST==='string'&&/^sha256:[a-f0-9]{64}$/.test(e.R1_IMAGE_DIGEST)&&
 e.DB?.prepare&&e.R1_CONTAINER?.getByName&&
 typeof e.R1_EXPIRES_AT==='string'&&Number.isFinite(Date.parse(e.R1_EXPIRES_AT))&&
 Date.parse(e.R1_EXPIRES_AT)>Date.now()&&Date.parse(e.R1_EXPIRES_AT)-Date.now()<=15*60_000;
const safe=(state)=>({status:state,probe_id:ID});
export {deny};
async function record(db,r){
 // Append-only initial claim is a second one-shot barrier outside DO storage.
 const result=await db.prepare('UPDATE buffalo_stage3b8r1_receipts SET status=?,receipt_json=? WHERE probe_id=? AND run_id=? AND status=?')
  .bind(r.status,JSON.stringify(r),ID,r.run_id,'CLAIMED').run();
 if(result?.meta?.changes!==1)throw Error('R1_D1_TERMINAL_NOT_RECORDED');
}
export async function runOneShot(ctx,env,{sleep=pause,randomUUID=()=>crypto.randomUUID(),
 randomKey=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('')}={}){
 if(!validConfig(env))return safe('R1_DISABLED');
 const container=ctx.container;
 if(!container?.images?.base||container.running)return safe('R1_CONTAINER_UNAVAILABLE_OR_RUNNING');
 const image=container.images.base;
 if(typeof image!=='string'||!image.endsWith('@'+env.R1_IMAGE_DIGEST))return safe('R1_IMAGE_DIGEST_MISMATCH');
 const commit=env.R1_EXPECTED_SHA,run=randomUUID(),key=randomKey();
 if(!validKey(key))throw Error('R1_BAD_KEY');
 const claim={probe_id:ID,run_id:run,source_commit:commit,image_digest:env.R1_IMAGE_DIGEST,
  status:'CLAIMED',claimed_at:new Date().toISOString()};
 const won=await ctx.storage.transaction(async tx=>{
  if(await tx.get(CLAIM))return false;
  await tx.put(CLAIM,claim);return true;
 });
 if(!won)return safe('R1_ALREADY_CLAIMED_NO_RETRY');
 // No start until D1 initial claim and watchdog are durable.
 const initial=await env.DB.prepare('INSERT INTO buffalo_stage3b8r1_receipts (probe_id,run_id,status,receipt_json) VALUES (?,?,?,?)')
  .bind(ID,run,'CLAIMED',JSON.stringify(claim)).run();
 if(initial?.meta?.changes!==1)throw Error('R1_D1_CLAIM_NOT_RECORDED');
 await ctx.storage.setAlarm(Date.now()+60000);
 if(!validConfig(env))throw Error('R1_AUTHORIZATION_EXPIRED_BEFORE_START');
 let result={...claim,status:'R1_RUNTIME_FAILURE',probe:null,phase:'START'};
 let attempted=false;
 try{
  attempted=true;
  container.start({image,instance:'lite',enableInternet:false,
   env:{R1_MODE:MODE,R1_EXPECTED_SHA:commit,R1_RUN_ID:run,R1_KEY:key,
    ALLOW_UNSANDBOXED_FALLBACK:'false'}});
  await container.setInactivityTimeout(60000);
  const port=container.getTcpPort(8080);
  result.phase='HEALTH';
  let ready=false;
  for(let i=0;i<20;i++){
   try{
    const res=await port.fetch('http://container/health',{signal:AbortSignal.timeout(800)});
    await res.body?.cancel();
    if(res.status===204){ready=true;break}
   }catch{}
   await sleep(200);
  }
  if(!ready)throw Error('R1_HEALTH_TIMEOUT');
  result.phase='IMAGE_INSPECT';
  const info=await container.inspect();
  if(info?.image!==image)throw Error('R1_RUNNING_IMAGE_MISMATCH');
  result.phase='PROBE';
  // Exactly ONE POST. No retry, even on ambiguous network failure.
  const response=await port.fetch('http://container/probe',{method:'POST',
   headers:{'x-buffalo-r1-key':key},signal:AbortSignal.timeout(12000)});
  if(response.status!==200){await response.body?.cancel();throw Error('R1_PROBE_HTTP_FAILED')}
  // Bound the transport body before parsing. No secret or raw stderr persisted.
  const reader=response.body.getReader();let bytes=0;let chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;
   bytes+=value.byteLength;if(bytes>4096)throw Error('R1_RECEIPT_OVERSIZE');chunks.push(value)}}
  finally{await reader.cancel().catch(()=>{})}
  const buf=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buf.set(chunk,offset);offset+=chunk.byteLength}
  const p=boundedReceipt(JSON.parse(new TextDecoder().decode(buf)),commit,run);
  result={...result,probe:p,status:p.status==='MINIMAL_BWRAP_PASS'?'R1_REMOTE_MINIMAL_PASS':'R1_REMOTE_MINIMAL_BLOCKED',phase:'PROBE_RECEIPT'};
 }catch{ /* keep sanitized phase; failed transport cannot become PASS */ }
 finally{
  result={...result,container_start_attempted:attempted,internet_enabled_config:false,
   provider_requests_measured:false,agent_execution_authorized:false,
   destroy_acknowledged:false,container_inspect_null:false,finished_at:new Date().toISOString()};
  try{
   await container.destroy();
   result.destroy_acknowledged=true;
   result.container_inspect_null=(await container.inspect())===null;
   if(!result.container_inspect_null)result.status='R1_CLEANUP_UNCONFIRMED';
  }catch{result.status='R1_CLEANUP_UNCONFIRMED'}
  // Persist evidence even when cleanup did not confirm. Never delete claim.
  const saved=await ctx.storage.transaction(async tx=>{
   const current=await tx.get(CLAIM);
   if(current?.status!=='CLAIMED'||current.run_id!==run)return false;
   await tx.put(CLAIM,result);return true;
  });
  if(!saved)throw Error('R1_TERMINAL_ALREADY_RECORDED');
  await record(env.DB,result);
  if(result.destroy_acknowledged&&result.container_inspect_null)await ctx.storage.deleteAlarm();
  console.log('BUFFALO_R1_RECEIPT='+JSON.stringify(result));
 }
 return result;
}
export async function cleanupAlarm(ctx,env){
 // Recovery only. NEVER starts a container or replays a probe.
 const claim=await ctx.storage.get(CLAIM);
 if(!claim)return;
 if(ctx.container?.running)await ctx.container.destroy();
 const stopped=(await ctx.container.inspect())===null;
 if(!stopped)throw Error('R1_WATCHDOG_CONTAINER_NOT_STOPPED');
 if(claim.status==='CLAIMED'){
  const result={...claim,status:'R1_INTERRUPTED_NO_RETRY',watchdog_ran:true,
   probe:null,container_inspect_null:true,agent_execution_authorized:false};
  const saved=await ctx.storage.transaction(async tx=>{
   const current=await tx.get(CLAIM);
   if(current?.status!=='CLAIMED'||current.run_id!==claim.run_id)return false;
   await tx.put(CLAIM,result);return true;
  });
  if(saved){await record(env.DB,result);console.log('BUFFALO_R1_RECEIPT='+JSON.stringify(result))}
 }
 // Preserve any prior terminal result, including cleanup failures.
}
