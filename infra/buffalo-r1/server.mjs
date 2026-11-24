import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {probeMinimal} from './stage3b8r-bwrap-minimal.mjs';
import {ID,MODE,SCHEMA,validKey,validRun,validCommit,boundedReceipt} from './receipt.mjs';

// The image source SHA is baked into the OCI image. The controller passes
// expected identity separately. It cannot override the baked variable.
export function startProbeServer({env=process.env,probe=probeMinimal,port=8080,host='0.0.0.0'}={}){
 const commit=env.BUFFALO_IMAGE_SOURCE_SHA,run=env.R1_RUN_ID,key=env.R1_KEY;
 if(env.R1_MODE!==MODE||!validCommit(commit)||commit!==env.R1_EXPECTED_SHA||
    !validRun(run)||!validKey(key)||env.ALLOW_UNSANDBOXED_FALLBACK!=='false')
  throw Error('R1_ORIGIN_NOT_ARMED');
 // Only these fixed inputs enter the probe. No supplied command or payload.
 let used=false;
 const server=createServer((req,res)=>{
  const end=(status,body='')=>{res.writeHead(status,{'cache-control':'no-store',
   'content-type':'application/json','connection':'close'});res.end(body)};
  if(req.method==='GET'&&req.url==='/health')return end(204);
  const token=req.headers['x-buffalo-r1-key'];
  if(req.method!=='POST'||req.url!=='/probe'||!validKey(token)||
     !timingSafeEqual(Buffer.from(token),Buffer.from(key)))return end(404);
  if(req.headers['transfer-encoding']||
     (req.headers['content-length']!==undefined&&req.headers['content-length']!=='0'))
   return end(400);
  if(used)return end(409);
  used=true; // before synchronous bwrap launch, never retry after failure
  try{
   const p=probe({commit,env:{GITHUB_SHA:commit,ALLOW_UNSANDBOXED_FALLBACK:'false'}});
   const receipt=boundedReceipt({...p,schema:SCHEMA,run_id:run,probe_id:ID},commit,run);
   // The R0 receipt's network_disabled field is intentionally NOT forwarded:
   // in R1 enableInternet:false is controller configuration, not measured egress.
   end(200,JSON.stringify(receipt));
  }catch{end(500,JSON.stringify({error:'R1_PROBE_FAILED'}))}
 });
 server.requestTimeout=12000;server.headersTimeout=5000;
 return server.listen(port,host);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{startProbeServer()}catch{console.error('R1_ORIGIN_NOT_ARMED');process.exitCode=78}
}
