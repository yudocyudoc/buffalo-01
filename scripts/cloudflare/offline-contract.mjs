/**
 * Zero-network assertions for the original Buffalo agent + engine Cloudflare bootstrap.
 * Invoked with BUFFALO_CF_OFFLINE=1 and dummy account ID. No AI calls.
 */
import assert from 'node:assert/strict';
import config from '../../config.js';
import { ModelCapabilities, ModelType } from '../../utilities/LLMWrapper.js';
import { OPENAI_COMPATIBLE_PROVIDERS, openAiCompatibleClientOptions } from '../../agent/utilities/nativeProviders.js';
import { resolveToolLane } from '../../agent/utilities/intelligenceLevels.js';
import { OR_SLUG, CF_MODEL, EV01_CAP, requestToCloudflareEV01, EV01_BUDGET_AUTH } from './arena_b_ev01_cf_adapter.mjs';
import {adaptOriginalEngineRequest} from './other-engine-transport.mjs';
import {BUFFALO_CF_MODEL} from './active-model.mjs';

assert.equal(process.env.BUFFALO_CF_OFFLINE,'1');
assert.equal(globalThis.__buffaloCloudflare?.provider,'cloudflare');
assert.equal(BUFFALO_CF_MODEL,'@cf/thinkingmachines/inkling-2-small');
assert.equal(config.nativeAgentProviders.cloudflare.model,BUFFALO_CF_MODEL);
assert.equal(config.nativeAgentProviders.cloudflare.summaryModel,BUFFALO_CF_MODEL);
assert.equal(globalThis.__buffaloCloudflare.engineTarget.endsWith('/run/'+BUFFALO_CF_MODEL),true);
assert.equal(globalThis.__buffaloCloudflare.agentTarget.endsWith('/ai/v1/chat/completions'),true);
assert.ok(config.agentProviders.includes('cloudflare'));
assert.ok(OPENAI_COMPATIBLE_PROVIDERS.has('cloudflare'));
assert.equal(new ModelCapabilities(OR_SLUG).kind,ModelType.OPEN_ROUTER);
const client=openAiCompatibleClientOptions('cloudflare');
assert.equal(client.baseURL,
  'https://api.cloudflare.com/client/v4/accounts/'+process.env.CLOUDFLARE_ACCOUNT_ID+'/ai/v1');
assert.equal(client.apiKey,'OFFLINE_NO_NETWORK');
const lane=resolveToolLane('cloudflare','standard');
assert.deepEqual(
  [lane.build.normal,lane.build.hard,lane.nonBuild.normal,lane.nonBuild.hard],
  [OR_SLUG,OR_SLUG,OR_SLUG,OR_SLUG]);
console.log('PASS: original Buffalo agent provider registry and all four tool lanes point to Cloudflare');

const sample = {
  model: OR_SLUG,
  messages:[{role:'system',content:'System dynamics task'},{role:'user',content:'Model inventories'}],
  response_format:{type:'json_schema',json_schema:{
    name:'sd_model',schema:{type:'object',properties:{
      variables:{type:'array'},relationships:{type:'array'}
    }}}},
  max_completion_tokens:EV01_CAP
};
const mapped=requestToCloudflareEV01(sample,{authorization:EV01_BUDGET_AUTH});
assert.equal(mapped.max_completion_tokens,16000);
assert.equal(mapped.reasoning_effort,'low');
assert.equal(mapped.response_format.type,'json_schema');
assert.equal(mapped.response_format.json_schema.type,'object');
assert.equal(CF_MODEL,'@cf/zai-org/glm-5.3-flash'); // Proven adapter historical ID
assert.equal(globalThis.__buffaloCloudflare.model,BUFFALO_CF_MODEL); // Actual current target
console.log('PASS: preserved IGC 16k JSON-schema adapter, explicit newer Cloudflare destination');

await assert.rejects(
  () => fetch('https://api.cloudflare.com/client/v4/accounts/'+process.env.CLOUDFLARE_ACCOUNT_ID+
    '/ai/v1/chat/completions', {
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
        model:BUFFALO_CF_MODEL,
        messages:[{role:'user',content:'simple arithmetic'}],
        tools:[{type:'function',function:{name:'test_tool',parameters:{type:'object'}}}]
      })
    }),
  /BUFFALO_CF_OFFLINE_POST_BLOCKED/
);
await assert.rejects(
  () => fetch('https://openrouter.ai/api/v1/chat/completions', {
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(sample)
  }),
  /BUFFALO_CF_OFFLINE_POST_BLOCKED/
);
const other = {...sample,
  response_format:{type:'json_schema',json_schema:{
    name:'analysis',schema:{type:'object',properties:{analysis:{type:'string'}}}}}};
assert.equal(adaptOriginalEngineRequest(other).category,
  'other-original-engine-transport-not-live-validated');
await assert.rejects(
  () => fetch('https://openrouter.ai/api/v1/chat/completions', {
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(other)
  }),
  /BUFFALO_CF_OFFLINE_POST_BLOCKED/
);
assert.deepEqual(globalThis.__buffaloCloudflare.receipts.map(r=>r.channel),
  ['original-agent-chat-tools','original-engine-sdk-to-workers-ai',
   'original-engine-sdk-to-workers-ai']);
assert.equal(globalThis.__buffaloCloudflare.receipts.length,3);
assert.equal(globalThis.__buffaloCloudflare.receipts[1].engine_schema_category,
  'original-quantitative-igc-adapter');
assert.equal(globalThis.__buffaloCloudflare.receipts[2].engine_schema_category,
  'other-original-engine-transport-not-live-validated');
assert.equal(globalThis.__buffaloCloudflare.receipts.every(r=>r.source==='offline-no-network'),true);
assert.ok(globalThis.__buffaloCloudflare.receipts.every(r=>r.model===BUFFALO_CF_MODEL),
  'Every route must record only the active Inkling 2 Small model');
assert.ok(!globalThis.__buffaloCloudflare.engineTarget.includes('glm-5.3'),
  'Historical alias is not a real Cloudflare inference destination');
// Fill the last offline slot, then deliberately attempt a fifth POST.
const probe = label => fetch(
  'https://api.cloudflare.com/client/v4/accounts/'+process.env.CLOUDFLARE_ACCOUNT_ID+
  '/ai/v1/chat/completions', {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({
      model:BUFFALO_CF_MODEL,
      messages:[{role:'user',content:label}]
    })
  }
);
assert.equal(globalThis.__buffaloCloudflare.maxPosts,4,
  'Test is intentionally configured with a hard cap of four');
await assert.rejects(() => probe('last available offline slot'),
  /BUFFALO_CF_OFFLINE_POST_BLOCKED/);
await assert.rejects(() => probe('one too many'),
  /BUFFALO_CF_POST_BUDGET_EXHAUSTED/);
const diagnostics = globalThis.__buffaloCloudflare.diagnostics();
assert.deepEqual(
  [diagnostics.maxPosts, diagnostics.reservedPosts, diagnostics.budgetBlockedAttempts, diagnostics.exhausted],
  [4,4,1,true]
);
assert.equal(globalThis.__buffaloCloudflare.receipts.length,4,
  'Blocked fifth request must not create a billable receipt');
console.log('PASS: exhausted budget reports explicit guard reason with zero network requests');
console.log('PASS: original agent, quantitative and other engine schemas each blocked before network (zero POST)');
