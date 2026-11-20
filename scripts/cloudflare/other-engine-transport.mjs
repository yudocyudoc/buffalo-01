/**
 * Transport extension for Buffalo's OTHER original engine tools (Seldon,
 * qualitative, discussion). Historical quantitative IGC adapter stays untouched.
 *
 * No equation, prompt, output or tool modification. The exact OpenRouter
 * messages/schema are mapped into Workers AI REST wire syntax, with a common
 * 16k output limit. Live compatibility is NOT yet demonstrated for these tools.
 */
import {OR_SLUG, EV01_CAP, EV01_BUDGET_AUTH, requestToCloudflareEV01} from './arena_b_ev01_cf_adapter.mjs';

function common(request) {
  if(request?.model !== OR_SLUG) throw Error('BUFFALO_CF_ENGINE_MODEL_MISMATCH');
  if(!Array.isArray(request.messages)||request.messages.length<1) throw Error('BUFFALO_CF_ENGINE_MESSAGES_MISSING');
  if(request.messages.some(m=>!['system','user','assistant'].includes(m.role)||typeof m.content!=='string'))
    throw Error('BUFFALO_CF_ENGINE_MESSAGES_UNSUPPORTED');
  if(request.stream===true) throw Error('BUFFALO_CF_ENGINE_STREAM_NOT_SUPPORTED');
  const n=request.max_completion_tokens ?? EV01_CAP;
  if(!Number.isInteger(n)||n<1) throw Error('BUFFALO_CF_ENGINE_INVALID_MAX_COMPLETION');
  return {requested:n,effective:Math.min(n,EV01_CAP)};
}

/** Convert one original OpenRouter SDK request for a Buffalo engine tool. */
export function adaptOriginalEngineRequest(request) {
  const {requested,effective}=common(request);
  const schema = request.response_format?.type==='json_schema'
    ? request.response_format.json_schema?.schema
    : null;
  if(schema?.properties?.variables && schema?.properties?.relationships){
    const wire=requestToCloudflareEV01(
      {...request,max_completion_tokens:effective},{authorization:EV01_BUDGET_AUTH});
    return {wire,category:'original-quantitative-igc-adapter',requestedMax:requested};
  }
  if(request.response_format && !['json_schema','json_object'].includes(request.response_format.type))
    throw Error('BUFFALO_CF_OTHER_ENGINE_UNKNOWN_FORMAT');
  if(request.response_format?.type==='json_schema' && (!schema||typeof schema!=='object'))
    throw Error('BUFFALO_CF_OTHER_ENGINE_INVALID_SCHEMA');
  const wire={
    messages:request.messages.map(({role,content})=>({role,content})),
    ...(schema?{response_format:{type:'json_schema',json_schema:schema}}:{}
      ),
    ...(request.response_format?.type==='json_object'?{response_format:{type:'json_object'}}:{}),
    max_completion_tokens:effective,
    reasoning_effort:'low',
    stream:false
  };
  return {wire,category:'other-original-engine-transport-not-live-validated',requestedMax:requested};
}
