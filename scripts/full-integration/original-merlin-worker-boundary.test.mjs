import test from 'node:test';
import assert from 'node:assert/strict';
import {assertProcessProbeEnvironment,PROCESS_SCHEMA,DENIED_PROVIDER}
 from './original-merlin-worker-boundary.mjs';

const good={platform:'linux',env:{GITHUB_SHA:'a'.repeat(40)},
 commit:'a'.repeat(40),bwrapAvailable:true};
test('boundary schema and unregistered provider cannot be mistaken for an inference run',()=>{
 assert.equal(PROCESS_SCHEMA,'BUFFALO_STAGE3B8_ORIGINAL_MERLIN_PROCESS_OFFLINE_V1');
 assert.equal(DENIED_PROVIDER,'buffalo_stage3_provider_denied');
 assert.equal(assertProcessProbeEnvironment(good),true);
});
test('refuses no-bwrap or non-Linux environment before any process can spawn',()=>{
 for(const x of [{bwrapAvailable:false},{platform:'darwin'}, {platform:'win32'}])
  assert.throws(()=>assertProcessProbeEnvironment({...good,...x}),/3B8_SANDBOX_NOT_AVAILABLE/);
});
test('refuses unsandboxed fallback, paid run and provider secrets',()=>{
 for(const env of [
  {...good.env,ALLOW_UNSANDBOXED_FALLBACK:'true'},
  {...good.env,BUFFALO_PAID_RUN:'I_ACCEPT_CLOUDFLARE_AI_COSTS'},
  {...good.env,CLOUDFLARE_API_TOKEN:'secret'},
  {...good.env,OPENAI_API_KEY:'secret'},
  {...good.env,ANTHROPIC_API_KEY:'secret'},
  {...good.env,GOOGLE_API_KEY:'secret'},
 ])assert.throws(()=>assertProcessProbeEnvironment({...good,env}),
   /3B8_UNSANDBOXED_FALLBACK_FORBIDDEN|3B8_PROVIDER_OR_PAID_SECRET_PRESENT/);
});
test('requires exact CI checkout identity; a PR source SHA is not substituted',()=>{
 for(const x of [{commit:'b'.repeat(40)},
  {commit:'invalid'},{env:{GITHUB_SHA:'bad'}},{env:{}}])
  assert.throws(()=>assertProcessProbeEnvironment({...good,...x}),
   /3B8_CHECKOUT_COMMIT_IDENTITY_REQUIRED/);
});
