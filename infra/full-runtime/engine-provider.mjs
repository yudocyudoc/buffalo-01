// Full-runtime-only preload. No actual OpenRouter account or Cloudflare token
// is available in the container. Reuse the historical SDK protocol adapters,
// but send the effective request through the project's native binding gateway.
import config from '../../config.js';
import {adaptOriginalEngineRequest} from '../../scripts/cloudflare/other-engine-transport.mjs';
import {OR_SLUG,responseToOpenRouter,digest} from '../../scripts/cloudflare/arena_b_ev01_cf_adapter.mjs';
import {configureModelWire} from '../../scripts/cloudflare/completion-policy.mjs';
import {GEMMA} from '../private-merlin/gemma-response.mjs';
import {ENGINE_ALIAS,ENGINE_ENDPOINT,ENGINE_MAX_TOKENS} from './engine-protocol.mjs';

if(process.env.BUFFALO_FULL_ENGINE_PROVIDER!=='true'||process.env.BUFFALO_PRIVATE_MERLIN_MODEL!==GEMMA||
  ENGINE_ALIAS!==OR_SLUG)throw Error('FULL_ENGINE_PROVIDER_NOT_CONFIGURED');
if(process.env.OPEN_ROUTER_API_KEY&&process.env.OPEN_ROUTER_API_KEY!=='VIRTUAL_CLOUDFLARE_ONLY')
  throw Error('FULL_ENGINE_REAL_OPENROUTER_KEY_NOT_ALLOWED');
process.env.OPEN_ROUTER_API_KEY='VIRTUAL_CLOUDFLARE_ONLY';
config.buildDefaultModel=ENGINE_ALIAS;
config.nonBuildDefaultModel=ENGINE_ALIAS;
config.models=[{label:'Workers AI (Gemma)',value:ENGINE_ALIAS},...config.models];

// This lane is for the original SDK. The separate agent conversation route
// is untouched. The full runtime currently enables engine generation via REST;
// sandboxed agent engine tools must be integrated and tested separately.
const nativeFetch=globalThis.fetch;
const fail=()=>Response.json({error:{code:422,message:'FULL_ENGINE_INFERENCE_REJECTED'}},{status:422});
globalThis.fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url);
  if(url.origin!=='https://openrouter.ai')return nativeFetch(input,init);
  if(url.href!=='https://openrouter.ai/api/v1/chat/completions'||
    String(init.method??(input instanceof Request?input.method:'GET')).toUpperCase()!=='POST')return fail();
  try{
    let raw=init.body??(input instanceof Request?await input.clone().text():null);
    if(raw instanceof Uint8Array)raw=Buffer.from(raw).toString('utf8');
    if(typeof raw!=='string')return fail();
    const sdk=JSON.parse(raw);
    // No silent discarding of caller-selected sampling settings in this lane.
    if(sdk.top_p!=null||sdk.seed!=null)return fail();
    const adapted=adaptOriginalEngineRequest(sdk);
    const wire=configureModelWire(GEMMA,{...adapted.wire,
      max_completion_tokens:Math.min(adapted.requestedMax,ENGINE_MAX_TOKENS)});
    const response=await nativeFetch(ENGINE_ENDPOINT,{method:'POST',
      headers:{'content-type':'application/json'},body:JSON.stringify({model:ENGINE_ALIAS,...wire}),
      redirect:'error',signal:init.signal??(input instanceof Request?input.signal:undefined)});
    if(!response.ok){await response.body?.cancel();return fail();}
    const result=await response.json();
    const envelope=responseToOpenRouter({success:true,result},digest(raw));
    // OpenRouter SDK requires total_tokens; derive only this SDK envelope field
    // from known input/output counters. Durable receipts remain provider-observed.
    if(envelope.usage?.total_tokens==null){
      const {prompt_tokens,completion_tokens}=envelope.usage??{};
      const total=prompt_tokens+completion_tokens;
      if(!Number.isSafeInteger(prompt_tokens)||!Number.isSafeInteger(completion_tokens)||
        !Number.isSafeInteger(total)||prompt_tokens<0||completion_tokens<0)return fail();
      envelope.usage={...envelope.usage,total_tokens:total};
    }
    return Response.json(envelope);
  }catch{
    // A transport failure is terminal for the SDK, including ambiguous
    // consumption. The durable reservation (if any) stays spent.
    return fail();
  }
};
