import {ENGINE_ALIAS,ENGINE_ENDPOINT,ENGINE_MAX_TOKENS,validInvocationId} from './engine-protocol.mjs';
import {GEMMA,acceptedGemmaModel} from '../private-merlin/gemma-response.mjs';
import {boundedJSON,digest} from './provider-wire.mjs';

const reject=status=>new Response(null,{status});
const count=n=>Number.isSafeInteger(n)&&n>=0?n:null;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const finishReasons=new Set(['stop','length','content_filter','tool_calls','function_call']);

function engineWire(body){
  if(!object(body)||body.model!==ENGINE_ALIAS||!validInvocationId(body.invocation_id)||body.stream!==false||
     !Array.isArray(body.messages)||!body.messages.length||
     !body.messages.every(m=>['system','user','assistant'].includes(m?.role)&&typeof m.content==='string')||
     !Number.isInteger(body.max_completion_tokens)||body.max_completion_tokens<1||
     body.max_completion_tokens>ENGINE_MAX_TOKENS||
     Object.keys(body).some(k=>!['model','messages','stream','max_completion_tokens','response_format','chat_template_kwargs','invocation_id'].includes(k)))
    throw Error('INVALID_ENGINE_REQUEST');
  const format=body.response_format;
  if(format!==undefined&&(!object(format)||
      (format.type==='json_schema'&&(!object(format.json_schema)||Object.keys(format).length!==2))||
      (format.type==='json_object'&&Object.keys(format).length!==1)||
      !['json_schema','json_object'].includes(format.type)))throw Error('INVALID_ENGINE_FORMAT');
  return {messages:body.messages.map(({role,content})=>({role,content})),
    ...(format?{response_format:format}:{}),max_completion_tokens:body.max_completion_tokens,
    stream:false,chat_template_kwargs:{enable_thinking:false}};
}
function diagnostic(result,wire){
  const choice=result?.choices?.[0],message=choice?.message,u=result?.usage;
  const prompt=count(u?.prompt_tokens),completion=count(u?.completion_tokens);
  const content=message?.content;
  let jsonValid=true;
  if(wire.response_format){
    try{jsonValid=object(JSON.parse(content));}catch{jsonValid=false;}
  }
  const predicates={
    model_accepted:acceptedGemmaModel(result?.model),
    one_choice:Array.isArray(result?.choices)&&result.choices.length===1,
    assistant_role:message?.role==='assistant',
    usage_present:u!=null,
    prompt_tokens_valid:prompt!==null&&prompt>0,
    completion_tokens_valid:completion!==null&&completion>0&&completion<=wire.max_completion_tokens,
    finish_reason_valid:choice?.finish_reason==='stop',
    no_tool_calls:message?.tool_calls==null||(Array.isArray(message.tool_calls)&&!message.tool_calls.length),
    no_function_call:message?.function_call==null,
    content_valid:typeof content==='string'&&!!content.trim()&&content.length<=131072,
    json_valid:jsonValid
  };
  const failed=Object.keys(predicates).filter(k=>!predicates[k]);
  return {stage:'RESPONSE',status:failed.length?'REJECTED':'OK',
    reason:failed.length?'INVALID_ENGINE_PROVIDER_RESPONSE':null,
    response_model:predicates.model_accepted?result.model:null,
    finish_reason:finishReasons.has(choice?.finish_reason)?choice.finish_reason:'unknown',
    usage:{prompt_tokens:prompt,completion_tokens:completion},
    neurons:Number.isFinite(u?.neurons)&&u.neurons>=0?u.neurons:null,
    predicates,failed_predicates:failed};
}
export async function engineCompletion(request,ai,reserve,record){
  if(request.url!==ENGINE_ENDPOINT||request.method!=='POST'||!ai?.run)return reject(403);
  let wire,invocationId;
  try{const body=await boundedJSON(request.body,512*1024);wire=engineWire(body);invocationId=body.invocation_id;}catch{return reject(400);}
  const text=JSON.stringify(wire),request_bytes=new TextEncoder().encode(text).length;
  if(request_bytes>131072)return reject(413);
  const meta={channel:'original-engine',invocation_id:invocationId,request_sha256:await digest(text),request_bytes,
    response_format:wire.response_format?.type??'text',max_completion_tokens:wire.max_completion_tokens};
  const attempt=await reserve({...meta,stage:'BINDING_INVOKE',status:'RESERVED',usage:null});
  if(!attempt)return reject(403);
  const started=Date.now();
  let result,receipt;
  try{result=await ai.run(GEMMA,wire);}
  catch(error){
    const code=error?.code??error?.errors?.[0]?.code;
    const n=typeof code==='string'&&/^\d{1,7}$/.test(code)?Number(code):code;
    receipt={stage:'BINDING_INVOKE',status:'FAILED',reason:'AI_BINDING_EXCEPTION',usage:null,
      provider_code:Number.isSafeInteger(n)&&n>=0&&n<=9999999?n:null,
      provider_http_status:Number.isInteger(error?.status)&&error.status>=100&&error.status<=599?error.status:null};
  }
  receipt={...meta,...(receipt??diagnostic(result,wire)),elapsed_ms:Math.max(0,Date.now()-started)};
  try{await record(attempt,receipt);}catch{
    console.error(JSON.stringify({event:'FULL_ENGINE_RECEIPT_WRITE_FAILED',attempt,...receipt}));
    return reject(422);
  }
  if(receipt.status!=='OK')return reject(422);
  return Response.json({model:GEMMA,choices:[{index:0,finish_reason:'stop',
    message:{role:'assistant',content:result.choices[0].message.content}}],usage:result.usage});
}
