// Shared Node/Workers contract. No network calls, agents, or secrets.
export const ID='one-shot-private-bwrap-r1-v2';
export const MODE='ONE_PRIVATE_NAMESPACE_PROBE_V2_NO_AGENT_NO_INFERENCE';
export const SCHEMA='BUFFALO_STAGE3B8R1_PRIVATE_NAMESPACE_V2';
export const R1_ARGS=Object.freeze([
 '--ro-bind','/usr','/usr','--ro-bind','/lib','/lib','--ro-bind','/lib64','/lib64',
 '--dev','/dev','--proc','/proc','--tmpfs','/tmp',
 '--unshare-pid','--unshare-uts','--hostname','agent','--','/usr/bin/true'
]);
export const FLAGS='6714dc03bb6f440624bbeb5d0e1795f43a29d653fd101dfc8c4b1ed569253d00';
const SHA40=/^[0-9a-f]{40}$/;
const SHA64=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const validCommit=x=>typeof x==='string'&&SHA40.test(x);
export const validRun=x=>typeof x==='string'&&UUID.test(x);
export const validKey=x=>typeof x==='string'&&SHA64.test(x);
const signatures=Object.freeze({
 UNEXPECTED_BWRAP_CAPABILITIES:['UNEXPECTED_CAPABILITIES_IN_NONROOT_BWRAP'],
 BWRAP_LAUNCH_CONTEXT_FAILED:['LAUNCH_CONTEXT_REJECTED','SETPRIV_FAILED'],
 NAMESPACE_CREATION_DENIED:['NO_PERMISSIONS_TO_CREATE_NEW_NAMESPACE','CREATING_NAMESPACE_FAILED','USER_NAMESPACES_DISABLED'],
 MOUNT_OPERATION_DENIED:['MOUNT_SETUP_FAILURE'],
 PERMISSION_DENIED_UNSPECIFIED:['UID_MAP_SETUP_FAILURE','OPERATION_NOT_PERMITTED','PERMISSION_DENIED'],
 COMMAND_UNAVAILABLE:['COMMAND_NOT_FOUND'],
 BWRAP_NOT_FOUND:['BWRAP_EXECUTABLE_MISSING'],
 BWRAP_TIMEOUT:['BWRAP_PROCESS_TIMEOUT'],
 BWRAP_PROCESS_FAILED_OTHER:['BWRAP_OPTION_UNSUPPORTED','BWRAP_DIAGNOSTIC_UNRECOGNIZED','BWRAP_STDERR_EMPTY']
});
export function boundedReceipt(x,commit,run){
 if(!x||x.schema!==SCHEMA||x.source_commit!==commit||!validCommit(commit)||
   x.run_id!==run||!validRun(run)||x.probe_id!==ID||x.flags_sha256!==FLAGS||
   !Number.isInteger(x.exit_code)||x.exit_code<0||x.exit_code>255||
    !validKey(x.stderr_sha256)||typeof x.launch_context_verified!=='boolean'||
    x.agent_executed!==false||x.inference_executed!==false||
   x.raw_stderr_in_receipt!==false||x.sandbox_relaxations!==false)
  throw Error('R1_RECEIPT_INVALID');
 if(x.status==='MINIMAL_BWRAP_PASS'){
  if(x.exit_code!==0||x.reason_code!=='NONE'||x.stderr_signature!=='NONE'||!x.launch_context_verified)
   throw Error('R1_FALSE_PASS');
 }else if(x.status==='MINIMAL_BWRAP_BLOCKED'){
  if(x.exit_code===0||!Object.hasOwn(signatures,x.reason_code)||
     !signatures[x.reason_code].includes(x.stderr_signature))
   throw Error('R1_FALSE_BLOCK');
 }else throw Error('R1_BAD_STATUS');
 // Reconstruct, do not persist arbitrary fields supplied by remote endpoint.
 return {schema:SCHEMA,probe_id:ID,source_commit:commit,run_id:run,
  flags_sha256:FLAGS,status:x.status,reason_code:x.reason_code,
   stderr_signature:x.stderr_signature,stderr_sha256:x.stderr_sha256,
   launch_context_verified:x.launch_context_verified,
  exit_code:x.exit_code,agent_executed:false,inference_executed:false,
  raw_stderr_in_receipt:false,sandbox_relaxations:false,
  egress_independently_measured:false};
}
