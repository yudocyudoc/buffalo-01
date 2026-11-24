import {createServer} from 'node:http';
import {timingSafeEqual,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {ID,MODE,SCHEMA,validKey,validRun,validCommit,boundedReceipt} from './receipt.mjs';
const driver=fileURLToPath(new URL('./driver.mjs',import.meta.url));
export function probeR2({commit,spawn=spawnSync}){
 const child=spawn('/usr/bin/setpriv',['--inh-caps=-all','--ambient-caps=-all','--no-new-privs','--',process.execPath,driver],
  {cwd:'/app',encoding:'utf8',timeout:80000,killSignal:'SIGKILL',maxBuffer:1024*1024,
   env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/tmp',LANG:'C',GITHUB_SHA:commit,ALLOW_UNSANDBOXED_FALLBACK:'false',NODE_ENV:'production'}});
 const stdout=String(child.stdout??''),stderr=String(child.stderr??'');
 const log=stdout+'\n'+stderr;
 const base={process_log_sha256:createHash('sha256').update(log).digest('hex'),inference_authorized:false,provider_requests_measured:false,raw_log_in_receipt:false};
 const rows=stdout.split(/\r?\n/).filter(x=>x.startsWith('BUFFALO_R2_PROCESS='));
 if(child.status===0&&!child.error&&!child.signal&&rows.length===1){
  try{return {...base,status:'ORIGINAL_PROCESS_PASS',reason_code:'NONE',exit_code:0,evidence:JSON.parse(rows[0].slice('BUFFALO_R2_PROCESS='.length))}}catch{}
 }
 let reason='ORIGINAL_PROCESS_FAILED';
 if(child.error?.code==='ETIMEDOUT')reason='ORIGINAL_PROCESS_TIMEOUT';
 else if(/LAUNCH_CONTEXT_FAILED|^setpriv:/m.test(stderr))reason='LAUNCH_CONTEXT_FAILED';
 else if(/3B8_REAL_WORKER_IPC_TIMEOUT|BUFFALO_R2_DRIVER_FAILED ORIGINAL_IPC_TIMEOUT/.test(log))reason='ORIGINAL_IPC_TIMEOUT';
 else if(/bwrap sandbox is unavailable|bwrap exited early|BUFFALO_R2_DRIVER_FAILED ORIGINAL_WORKER_START_FAILED/i.test(log))reason='ORIGINAL_WORKER_START_FAILED';
 else if(child.status===0)reason='INVALID_PROCESS_RECEIPT';
 return {...base,status:'ORIGINAL_PROCESS_BLOCKED',reason_code:reason,exit_code:Number.isInteger(child.status)&&child.status>0?child.status:1,evidence:null};
}
// The image source SHA is baked into the OCI image. The controller passes
// expected identity separately. It cannot override the baked variable.
export function startProbeServer({env=process.env,probe=probeR2,port=8080,host='0.0.0.0'}={}){
 const commit=env.BUFFALO_IMAGE_SOURCE_SHA,run=env.R2_RUN_ID,key=env.R2_KEY;
 if(env.R2_MODE!==MODE||!validCommit(commit)||commit!==env.R2_EXPECTED_SHA||
    !validRun(run)||!validKey(key)||env.ALLOW_UNSANDBOXED_FALLBACK!=='false')
  throw Error('R2_ORIGIN_NOT_ARMED');
 // Only these fixed inputs enter the probe. No supplied command or payload.
 let used=false;
 const server=createServer((req,res)=>{
  const end=(status,body='')=>{res.writeHead(status,{'cache-control':'no-store',
   'content-type':'application/json','connection':'close'});res.end(body)};
  if(req.method==='GET'&&req.url==='/health')return end(204);
  const token=req.headers['x-buffalo-r2-key'];
  if(req.method!=='POST'||req.url!=='/probe'||!validKey(token)||
     !timingSafeEqual(Buffer.from(token),Buffer.from(key)))return end(404);
  if(req.headers['transfer-encoding']||
     (req.headers['content-length']!==undefined&&req.headers['content-length']!=='0'))
   return end(400);
  if(used)return end(409);
  used=true; // before synchronous bounded original process launch, never retry after failure
  try{
   const p=probe({commit});
   const receipt=boundedReceipt({...p,schema:SCHEMA,source_commit:commit,run_id:run,probe_id:ID},commit,run);
   // Transport returns only the bounded receipt, never child stdout/stderr.
   end(200,JSON.stringify(receipt));
  }catch{end(500,JSON.stringify({error:'R2_PROBE_FAILED'}))}
 });
 server.requestTimeout=100000;server.headersTimeout=5000;
 return server.listen(port,host);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{startProbeServer()}catch{console.error('R2_ORIGIN_NOT_ARMED');process.exitCode=78}
}
