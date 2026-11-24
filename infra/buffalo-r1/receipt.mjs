// Shared Node/Workers contract. No network calls, agents, or secrets.
export const ID='one-shot-private-bwrap-r1-v1';
export const MODE='ONE_PRIVATE_NAMESPACE_PROBE_NO_AGENT_NO_INFERENCE';
export const SCHEMA='BUFFALO_STAGE3B8R1_PRIVATE_NAMESPACE_V1';
export const FLAGS='276c577ff4856218d30aa7fc53458b49e5827c2a0d6ccde19a5d9b530d1d1e32';
const SHA40=/^[0-9a-f]{40}$/;
const SHA64=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const validCommit=x=>typeof x==='string'&&SHA40.test(x);
export const validRun=x=>typeof x==='string'&&UUID.test(x);
export const validKey=x=>typeof x==='string'&&SHA64.test(x);
const signatures=Object.freeze({
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
   !validKey(x.stderr_sha256)||x.agent_executed!==false||x.inference_executed!==false||
   x.raw_stderr_in_receipt!==false||x.sandbox_relaxations!==false)
  throw Error('R1_RECEIPT_INVALID');
 if(x.status==='MINIMAL_BWRAP_PASS'){
  if(x.exit_code!==0||x.reason_code!=='NONE'||x.stderr_signature!=='NONE')
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
  exit_code:x.exit_code,agent_executed:false,inference_executed:false,
  raw_stderr_in_receipt:false,sandbox_relaxations:false,
  egress_independently_measured:false};
}
