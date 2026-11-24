import test from 'node:test';
import assert from 'node:assert/strict';
import {probeMinimal,diagnoseBwrap,validateMinimalReceipt,MINIMAL_ARGS} from './stage3b8r-bwrap-minimal.mjs';
const commit='a'.repeat(40);
const env={GITHUB_SHA:commit,ALLOW_UNSANDBOXED_FALLBACK:'false'};
const fake=(status,stderr='')=>()=>({status,stderr,stdout:'',signal:null,error:null});
test('minimal probe reports success without claiming agent or cloud execution',()=>{
 const r=probeMinimal({commit,env,spawn:fake(0)});
 assert.equal(r.status,'MINIMAL_BWRAP_PASS');
 assert.equal(r.reason_code,'NONE');
 assert.equal(r.raw_stderr_in_receipt,false);
 assert.equal(r.agent_executed,false);
 assert.equal(r.inference_executed,false);
 assert.equal(r.network_disabled,true);
 assert(!JSON.stringify(r).includes('proprietary'));
 assert(MINIMAL_ARGS.includes('--unshare-pid'));
});
test('namespace denial is an explicit sanitized cause; raw stderr never leaves receipt',()=>{
 const secret='private/token/secret-abc';
 const r=probeMinimal({commit,env,spawn:fake(1,
   'bwrap: Creating new namespace failed: Operation not permitted '+secret)});
 assert.equal(r.status,'MINIMAL_BWRAP_BLOCKED');
 assert.equal(r.reason_code,'NAMESPACE_CREATION_DENIED');
 assert(!JSON.stringify(r).includes(secret));
 assert.match(r.stderr_sha256,/^[0-9a-f]{64}$/);
});
test('missing bwrap is blocked regardless of ALLOW_UNSANDBOXED_FALLBACK',()=>{
 const missing=()=>({status:null,stderr:'',error:{code:'ENOENT'},signal:null});
 const r=probeMinimal({commit,env,spawn:missing});
 assert.equal(r.reason_code,'BWRAP_NOT_FOUND');
 assert.equal(r.exit_code,127);
 assert.throws(()=>probeMinimal({commit,env:{...env,ALLOW_UNSANDBOXED_FALLBACK:'true'},spawn:missing}),
  /3B8R0_STRICT_LINUX_SANDBOX_REQUIRED/);
});
test('does not confuse mount failure with namespace denial',()=>{
 assert.equal(diagnoseBwrap({stderr:'bwrap: bind mount failed: Operation not permitted'}),
   'MOUNT_OPERATION_DENIED');
 assert.equal(diagnoseBwrap({stderr:'bwrap exited early, no diagnostics'}),
   'BWRAP_PROCESS_FAILED_OTHER');
 assert.equal(diagnoseBwrap({stderr:'operation not permitted'}),
   'PERMISSION_DENIED_UNSPECIFIED');
});
test('incorrect receipt, identities and forged pass are rejected',()=>{
 const r=probeMinimal({commit,env,spawn:fake(0)});
 for(const change of [
  {network_disabled:false},{raw_stderr_in_receipt:true},{agent_executed:true},
  {exit_code:2},{flags_sha256:'0'.repeat(64)},
  {status:'MINIMAL_BWRAP_BLOCKED',exit_code:0,reason_code:'NAMESPACE_CREATION_DENIED'}
 ])assert.throws(()=>validateMinimalReceipt({...r,...change},commit),/3B8R0_/);
 assert.throws(()=>probeMinimal({commit:'b'.repeat(40),env,spawn:fake(0)}),
  /3B8R0_SOURCE_IDENTITY_REQUIRED/);
});
