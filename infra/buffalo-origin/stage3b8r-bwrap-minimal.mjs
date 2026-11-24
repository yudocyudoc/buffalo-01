/**
 * Stage 3B-8/R0: minimal bubblewrap kernel/namespace probe.
 * Runs INSIDE the same hardened, network-disabled Docker image as the original
 * AgentWorker probe. Does not import Buffalo or start an agent.
 *
 * Emits ONE sanitized receipt; never prints bwrap stderr or host information.
 */
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

export const MINIMAL_SCHEMA='BUFFALO_STAGE3B8R0_BWRAP_MINIMAL_V1';
export const MINIMAL_ARGS=Object.freeze([
  '--ro-bind','/usr','/usr',
  '--dev','/dev','--proc','/proc','--tmpfs','/tmp',
  '--unshare-pid','--unshare-uts','--hostname','agent',
  '--','/usr/bin/true'
]);
const sha=s=>createHash('sha256').update(s).digest('hex');
const allowedCodes=new Set([
 'BWRAP_NOT_FOUND','NAMESPACE_CREATION_DENIED','MOUNT_OPERATION_DENIED',
 'PERMISSION_DENIED_UNSPECIFIED','COMMAND_UNAVAILABLE','BWRAP_TIMEOUT',
 'BWRAP_PROCESS_FAILED_OTHER'
]);
export function diagnoseBwrap({stderr='',error=null,status=null,signal=null}={}){
 const msg=String(stderr).slice(0,16384);
 if(error?.code==='ENOENT')return 'BWRAP_NOT_FOUND';
 if(error?.code==='ETIMEDOUT'||signal==='SIGTERM')return 'BWRAP_TIMEOUT';
 if(/(creating|create|new)\s+(user\s+|pid\s+|mount\s+)?namespace\s+failed/i.test(msg)||
    /user namespaces.*(disabled|not permitted)/i.test(msg))return 'NAMESPACE_CREATION_DENIED';
 if(/(mount|bind).*?(operation not permitted|permission denied|failed)/i.test(msg))
   return 'MOUNT_OPERATION_DENIED';
 if(/operation not permitted|permission denied|not enough privileges/i.test(msg))
   return 'PERMISSION_DENIED_UNSPECIFIED';
 if(/no such file or directory|executable file not found/i.test(msg))
   return 'COMMAND_UNAVAILABLE';
 return 'BWRAP_PROCESS_FAILED_OTHER';
}
export function validateMinimalReceipt(x,expectedSha){
 if(!x||typeof x!=='object'||Array.isArray(x)||
    x.schema!==MINIMAL_SCHEMA||x.source_commit!==expectedSha||
    x.flags_sha256!==sha(JSON.stringify(MINIMAL_ARGS))||
    x.network_disabled!==true||x.sandbox_relaxations===true||
    x.agent_executed!==false||x.inference_executed!==false||
    x.raw_stderr_in_receipt!==false||
    !Number.isInteger(x.exit_code)||x.exit_code<0||x.exit_code>255||
    typeof x.stderr_sha256!=='string'||!/^[a-f0-9]{64}$/.test(x.stderr_sha256))
  throw Error('3B8R0_MINIMAL_RECEIPT_INVALID');
 if(x.status==='MINIMAL_BWRAP_PASS'){
  if(x.exit_code!==0||x.reason_code!=='NONE')throw Error('3B8R0_MINIMAL_FALSE_PASS');
 }else if(x.status==='MINIMAL_BWRAP_BLOCKED'){
  if(x.exit_code===0||!allowedCodes.has(x.reason_code))
    throw Error('3B8R0_MINIMAL_FALSE_BLOCK');
 }else throw Error('3B8R0_MINIMAL_STATUS_INVALID');
 return x;
}
export function probeMinimal({commit,spawn=spawnSync,env=process.env}={}){
 if(!/^[a-f0-9]{40}$/.test(commit??'')||commit!==env.GITHUB_SHA)
  throw Error('3B8R0_SOURCE_IDENTITY_REQUIRED');
 if(process.platform!=='linux'||env.ALLOW_UNSANDBOXED_FALLBACK!=='false')
  throw Error('3B8R0_STRICT_LINUX_SANDBOX_REQUIRED');
 const res=spawn('bwrap',MINIMAL_ARGS,{encoding:'utf8',timeout:8000,
   maxBuffer:16384,env:{PATH:'/usr/bin:/bin',HOME:'/tmp',LANG:'C'}});
 const code=Number.isInteger(res.status)?res.status:res.error?.code==='ENOENT'?127:124;
 const ok=code===0&&!res.signal&&!res.error;
 const data={
  schema:MINIMAL_SCHEMA,source_commit:commit,
  flags_sha256:sha(JSON.stringify(MINIMAL_ARGS)),
  status:ok?'MINIMAL_BWRAP_PASS':'MINIMAL_BWRAP_BLOCKED',
  reason_code:ok?'NONE':diagnoseBwrap(res),
  exit_code:code,stderr_sha256:sha(String(res.stderr??'')),
  network_disabled:true,sandbox_relaxations:false,
  agent_executed:false,inference_executed:false,
  raw_stderr_in_receipt:false
 };
 validateMinimalReceipt(data,commit);
 return data;
}
if(process.argv[1]?.endsWith('/stage3b8r-bwrap-minimal.mjs')){
 try{
  if(process.argv.length!==4||process.argv[2]!=='--commit')
   throw Error('3B8R0_INVALID_ARGUMENTS');
  const result=probeMinimal({commit:process.argv[3]});
  console.log('BUFFALO_3B8R0_MINIMAL='+JSON.stringify(result));
  if(result.status!=='MINIMAL_BWRAP_PASS')process.exitCode=2;
 }catch(error){console.error('3B8R0_MINIMAL_PREFLIGHT_INVALID',error.message);
  process.exitCode=3}
}
