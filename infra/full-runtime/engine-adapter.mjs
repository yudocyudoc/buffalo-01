// Buffalo's provider boundary for the original LLMWrapper OpenRouter SDK lane.
// No network, engine-specific schema logic, experimental grants or model repair.
import {ENGINE_ALIAS,ENGINE_MAX_TOKENS} from './engine-protocol.mjs';

const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const tokenCount=n=>Number.isSafeInteger(n)&&n>=0;

export function toBindingRequest(request){
  if(!object(request)||request.model!==ENGINE_ALIAS||
    !Array.isArray(request.messages)||!request.messages.length||
    request.messages.some(m=>!['system','user','assistant'].includes(m?.role)||typeof m.content!=='string')||
    (request.stream!==undefined&&request.stream!==false))
    throw Error('INVALID_ENGINE_SDK_REQUEST');
  if(request.top_p!=null||request.seed!=null||request.tools!=null||request.tool_choice!=null)
    throw Error('UNSUPPORTED_ENGINE_SDK_OPTION');
  const requested=request.max_completion_tokens??ENGINE_MAX_TOKENS;
  if(!Number.isSafeInteger(requested)||requested<1)throw Error('INVALID_ENGINE_TOKEN_CAP');
  const format=request.response_format;
  let response_format;
  if(format!==undefined){
    if(!object(format))throw Error('INVALID_ENGINE_SDK_FORMAT');
    if(format.type==='json_schema'&&object(format.json_schema?.schema))
      response_format={type:'json_schema',json_schema:format.json_schema.schema};
    else if(format.type==='json_object')response_format={type:'json_object'};
    else throw Error('INVALID_ENGINE_SDK_FORMAT');
  }
  return {model:ENGINE_ALIAS,messages:request.messages.map(({role,content})=>({role,content})),
    ...(response_format?{response_format}:{}),max_completion_tokens:Math.min(requested,ENGINE_MAX_TOKENS),
    stream:false,chat_template_kwargs:{enable_thinking:false}};
}

export function toSdkResponse(result,invocationId){
  const choice=result?.choices?.[0],message=choice?.message,u=result?.usage;
  if(!Array.isArray(result?.choices)||result.choices.length!==1||choice?.finish_reason!=='stop'||
    message?.role!=='assistant'||typeof message.content!=='string'||!message.content.trim()||
    !tokenCount(u?.prompt_tokens)||!tokenCount(u?.completion_tokens))
    throw Error('INVALID_ENGINE_BINDING_RESPONSE');
  const total=u.total_tokens??(u.prompt_tokens+u.completion_tokens);
  if(!tokenCount(total))throw Error('INVALID_ENGINE_USAGE');
  return {id:'buffalo-'+invocationId,object:'chat.completion',created:Math.floor(Date.now()/1000),
    model:ENGINE_ALIAS,system_fingerprint:'buffalo-workers-ai-v1',
    choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:message.content}}],
    // SDK-only derived total when the binding omits it; receipts remain observed.
    usage:{...u,total_tokens:total}};
}
