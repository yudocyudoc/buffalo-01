/**
 * Cloudflare-only provider bootstrap for Buffalo; preload BEFORE the original
 * agent/eval modules with node --import ./scripts/cloudflare/bootstrap.mjs ...
 *
 * Preserves all Buffalo engines, agents, evaluators, prompts, and methods.
 * - Agent turns: original OpenAI-compatible manual loop -> CF /ai/v1
 * - Engine tools: original OpenRouter SDK -> proven IGC adapter -> CF /ai/run
 * In offline mode CF network POSTs are intentionally blocked.
 */
import config from '../../config.js';
import { createHash } from 'node:crypto';
import {
  OR_SLUG, EV01_ADAPTER_VERSION, EV01_TIMEOUT_MS, responseToOpenRouter
} from './arena_b_ev01_cf_adapter.mjs';
import {adaptOriginalEngineRequest} from './other-engine-transport.mjs';

const PROVIDER_MODEL = '@cf/zai-org/glm-5.3';
const offline = process.env.BUFFALO_CF_OFFLINE === '1';
const account = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const token = process.env.CLOUDFLARE_API_TOKEN || '';
const maxPosts = Number(process.env.BUFFALO_CF_MAX_POSTS || '12');
const sha = text => 'sha256:' + createHash('sha256').update(text).digest('hex');
const origin = 'https://api.cloudflare.com';
const apiBase = origin + '/client/v4/accounts/' + account + '/ai';
const nativeChat = apiBase + '/v1/chat/completions';
const engineUrl = apiBase + '/run/' + PROVIDER_MODEL;

if (!/^[0-9a-fA-F]{32}$/.test(account))
  throw Error('BUFFALO_CF_INVALID_ACCOUNT_ID');
if (!offline && !token)
  throw Error('BUFFALO_CF_MISSING_API_TOKEN');
if (!Number.isInteger(maxPosts) || maxPosts < 1 || maxPosts > 50)
  throw Error('BUFFALO_CF_INVALID_MAX_POSTS');
if (process.env.CLOUDFLARE_BASE_URL && process.env.CLOUDFLARE_BASE_URL !== apiBase + '/v1')
  throw Error('BUFFALO_CF_BASE_URL_CONFLICT');
if (process.env.OPEN_ROUTER_API_KEY && process.env.OPEN_ROUTER_API_KEY !== 'VIRTUAL_CLOUDFLARE_ONLY')
  throw Error('BUFFALO_CF_REAL_OPENROUTER_KEY_NOT_ALLOWED');

process.env.CLOUDFLARE_BASE_URL = apiBase + '/v1';
process.env.CLOUDFLARE_API_KEY = offline ? 'OFFLINE_NO_NETWORK' : token;
process.env.OPEN_ROUTER_API_KEY = 'VIRTUAL_CLOUDFLARE_ONLY';

config.nativeAgentProviders.cloudflare = {
  displayName: 'Cloudflare Workers AI (GLM-5.3)',
  model: PROVIDER_MODEL,
  summaryModel: PROVIDER_MODEL,
  baseURL: apiBase + '/v1',
};
const toolLane = {
  build: { normal: OR_SLUG, hard: OR_SLUG },
  nonBuild: { normal: OR_SLUG, hard: OR_SLUG },
};
config.agentToolModels.cloudflare = { standard: toolLane };
// Engine aliases intentionally remain those of the proven IGC transport.
// The real Workers AI destination is the newer GLM-5.3 model.

const nativeFetch = globalThis.fetch;
const receipts = [];
const seen = new Set();
function postReceipt(channel, url, body, metadata = {}) {
  const hash = sha(body);
  if (receipts.length >= maxPosts) throw Error('BUFFALO_CF_POST_BUDGET_EXHAUSTED');
  if (seen.has(hash)) throw Error('BUFFALO_CF_DUPLICATE_POST_BLOCKED');
  seen.add(hash);
  const r = { post: receipts.length + 1, channel, model: PROVIDER_MODEL,
    request_sha256: hash, status: 'RESERVED_BEFORE_HTTP', http_status: null,
    usage: null, source: offline ? 'offline-no-network' : url, ...metadata };
  receipts.push(r);
  if (offline) throw Error('BUFFALO_CF_OFFLINE_POST_BLOCKED');
  return r;
}
async function parseRequestBody(input, init) {
  const body = init?.body ?? (input instanceof Request ? await input.clone().text() : null);
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8');
  throw Error('BUFFALO_CF_SDK_BODY_UNSUPPORTED');
}
function responseHeaders() {return {'content-type':'application/json'};}
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
  const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

  // IGC's original Buffalo/OpenRouter engine transport, kept as-is.
  if (url.origin === 'https://openrouter.ai' && url.pathname.endsWith('/chat/completions')) {
    if (method !== 'POST') throw Error('BUFFALO_CF_OPENROUTER_POST_ONLY');
    const requestText = await parseRequestBody(input, init);
    const sdk = JSON.parse(requestText);
    const adapted = adaptOriginalEngineRequest(sdk);
    const rawWire = JSON.stringify(adapted.wire);
    const receipt = postReceipt('original-engine-sdk-to-workers-ai', engineUrl, rawWire, {
      engine_schema_category: adapted.category,
      requested_max_completion_tokens: adapted.requestedMax
    });
    try {
      const response = await nativeFetch(engineUrl, {
        method: 'POST', headers: {
          authorization: 'Bearer ' + token, 'content-type': 'application/json'
        }, body: rawWire, signal: AbortSignal.timeout(EV01_TIMEOUT_MS)
      });
      receipt.http_status = response.status;
      const raw = await response.json();
      receipt.usage = raw?.result?.usage ?? raw?.usage ?? null;
      if (!response.ok) throw Error('BUFFALO_CF_ENGINE_HTTP_' + response.status);
      const envelope = responseToOpenRouter(raw, sha(requestText));
      receipt.status = 'COMPLETE';
      return new Response(JSON.stringify(envelope), {status:200, headers:responseHeaders()});
    } catch (error) {
      receipt.status = 'FAILED_OR_CONSUMPTION_UNKNOWN';
      throw error;
    }
  }

  // Original Buffalo OpenAI-compatible function-tool agent loop, not Engine.generate.
  if (url.href === nativeChat) {
    if (method !== 'POST') throw Error('BUFFALO_CF_NATIVE_POST_ONLY');
    const text = await parseRequestBody(input, init);
    const request = JSON.parse(text);
    if (request.model !== PROVIDER_MODEL || !Array.isArray(request.messages))
      throw Error('BUFFALO_CF_NATIVE_REQUEST_MISMATCH');
    const receipt = postReceipt('original-agent-chat-tools', nativeChat, text);
    try {
      const response = await nativeFetch(input, init);
      receipt.http_status = response.status;
      // Non-streaming original Buffalo manual loop. Clone without mutating what
      // the original OpenAI-compatible SDK will parse for function tool calls.
      try {
        const body = await response.clone().json();
        receipt.response_sha256 = sha(JSON.stringify(body));
        receipt.usage = body?.usage ?? null;
        receipt.finish_reason = body?.choices?.[0]?.finish_reason ?? null;
        receipt.tool_calls_count = body?.choices?.[0]?.message?.tool_calls?.length ?? 0;
      } catch { receipt.response_parse = 'unavailable'; }
      receipt.status = response.ok ? 'HTTP_SUCCESS' : 'HTTP_FAILURE_OR_CONSUMPTION_UNKNOWN';
      return response;
    } catch (error) {
      receipt.status = 'FAILED_OR_CONSUMPTION_UNKNOWN';
      throw error;
    }
  }
  return nativeFetch(input, init);
};

globalThis.__buffaloCloudflare = {
  provider: 'cloudflare', model: PROVIDER_MODEL, engineAlias: OR_SLUG,
  adapter: EV01_ADAPTER_VERSION, maxPosts, offline, receipts,
  serialize: () => JSON.parse(JSON.stringify(receipts)),
};
