// Full-runtime-only preload. No actual OpenRouter account or Cloudflare token
// is available in the container. The neutral Buffalo adapter sends requests
// through the project's native binding gateway.
import config from '../../config.js';
import {randomUUID} from 'node:crypto';
import {toBindingRequest,toSdkResponse} from './engine-adapter.mjs';
import {GEMMA} from '../private-merlin/gemma-response.mjs';
import {ENGINE_ALIAS,ENGINE_ENDPOINT} from './engine-protocol.mjs';

if(process.env.BUFFALO_FULL_ENGINE_PROVIDER!=='true'||process.env.BUFFALO_PRIVATE_MERLIN_MODEL!==GEMMA)throw Error('FULL_ENGINE_PROVIDER_NOT_CONFIGURED');
if(process.env.OPEN_ROUTER_API_KEY&&process.env.OPEN_ROUTER_API_KEY!=='VIRTUAL_CLOUDFLARE_ONLY')
  throw Error('FULL_ENGINE_REAL_OPENROUTER_KEY_NOT_ALLOWED');
process.env.OPEN_ROUTER_API_KEY='VIRTUAL_CLOUDFLARE_ONLY';
config.buildDefaultModel=ENGINE_ALIAS;
config.nonBuildDefaultModel=ENGINE_ALIAS;
config.models=[{label:'Workers AI (Gemma)',value:ENGINE_ALIAS},...config.models];
const lane={normal:ENGINE_ALIAS,hard:ENGINE_ALIAS};
config.agentToolModels.cloudflare={build:lane,nonBuild:lane};

// This lane is for the original SDK. The separate agent conversation route
// is untouched. The full-runtime sandbox preloads this same module explicitly.
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
    const wire=toBindingRequest(sdk);
    // New invocation for every SDK request; the identical wire may be used
    // intentionally in another invocation. A replay of this ID is never billed twice.
    const invocationId=randomUUID();
    const response=await nativeFetch(ENGINE_ENDPOINT,{method:'POST',
      headers:{'content-type':'application/json'},body:JSON.stringify({...wire,invocation_id:invocationId}),
      redirect:'error',signal:init.signal??(input instanceof Request?input.signal:undefined)});
    if(!response.ok){await response.body?.cancel();return fail();}
    const result=await response.json();
    return Response.json(toSdkResponse(result,invocationId));
  }catch{
    // A transport failure is terminal for the SDK, including ambiguous
    // consumption. The durable reservation (if any) stays spent.
    return fail();
  }
};
