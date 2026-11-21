/** No-network safety tests for opt-in latency probe. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {quoteNeurons} from './neuron-budget.mjs';

const script=new URL('./gemma4-stream-ttfb-probe.mjs',import.meta.url).pathname;
const p=spawnSync(process.execPath,[script],{
  encoding:'utf8',
  env:{
    ...process.env,
    BUFFALO_PAID_RUN:'',
    CLOUDFLARE_API_TOKEN:'',
    CLOUDFLARE_ACCOUNT_ID:''
  },
  timeout:5000
});
assert.notEqual(p.status,0);
assert.match(p.stderr,/BUFFALO_CF_PROBE_REQUIRES_MANUAL_PAID_OPT_IN/);
assert.doesNotMatch(p.stdout,/totalMeasuredNeurons|providerModel|http_status/);
const model='@cf/google/gemma-4-26b-a4b-it';
const q=quoteNeurons(model,{
  model, messages:[{role:'user',content:'test'}],
  max_completion_tokens:128,stream:true
});
assert.ok(q.reservedNeurons>0);
assert.ok(q.reservedNeurons*2<=200);
console.log('PASS: latency probe is inert without explicit paid consent (no API)');
console.log('PASS: neuron reservation utility quotes short streaming probes without contacting provider');
