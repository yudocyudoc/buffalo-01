import {ENDPOINT} from '../private-merlin/protocol.mjs';
import {GEMMA,acceptedGemmaModel} from '../private-merlin/gemma-response.mjs';
import {boundedJSON} from './provider-wire.mjs';

// Original tool availability still comes from the agent and session; this is the transport capability ceiling.
export const MODEL_TOOLS=new Set(['get_current_model','read_model_section','edit_variables','edit_relationships','edit_specs','edit_modules','update_model','run_model','get_run_info','get_variable_data','read_file']);
const finishReasons=new Set(['stop','tool_calls','length','content_filter','function_call']);
const maxTokens=2048;
const reject=status=>new Response(null,{status});
const tokenCount=n=>Number.isSafeInteger(n) && n>=0?n:null;

function objectArguments(call){
  if(typeof call?.function?.arguments!=='string')return false;
  try{
    const args=JSON.parse(call.function.arguments);
    return args!==null && typeof args==='object' && !Array.isArray(args);
  }catch{return false;}
}

function responseDiagnostic(result,offered){
  const choice=result?.choices?.[0], message=choice?.message, usage=result?.usage;
  const calls=message?.tool_calls??[];
  const toolFinish=choice?.finish_reason==='tool_calls';
  const prompt=tokenCount(usage?.prompt_tokens), completion=tokenCount(usage?.completion_tokens);
  const predicates={
    model_accepted:acceptedGemmaModel(result?.model),
    one_choice:Array.isArray(result?.choices) && result.choices.length===1,
    assistant_role:message?.role==='assistant',
    usage_present:usage!=null,
    prompt_tokens_valid:prompt!==null && prompt>0,
    completion_tokens_valid:completion!==null && completion>0 && completion<=maxTokens,
    no_function_call:message?.function_call==null,
    finish_reason_valid:toolFinish || choice?.finish_reason==='stop',
    content_valid:(toolFinish && message?.content==null) ||
      (typeof message?.content==='string' && message.content.length<=16000 && (toolFinish || !!message.content.trim())),
    tool_count_valid:Array.isArray(calls) && (toolFinish?calls.length>0:calls.length===0),
    tool_ids_valid:Array.isArray(calls) && calls.every(t=>typeof t?.id==='string' && t.id.length>0) &&
      new Set(calls.map(t=>t.id)).size===calls.length,
    tools_offered:Array.isArray(calls) && calls.every(t=>t?.type==='function' && offered.has(t.function?.name)),
    tool_arguments_valid:Array.isArray(calls) && calls.every(objectArguments)
  };
  const failed=Object.keys(predicates).filter(key=>!predicates[key]);
  return {stage:'RESPONSE',status:failed.length?'REJECTED':'OK',reason:failed.length?'INVALID_PROVIDER_RESPONSE':null,
    response_model:predicates.model_accepted?result.model:null,
    finish_reason:finishReasons.has(choice?.finish_reason)?choice.finish_reason:'unknown',
    usage:{prompt_tokens:prompt,completion_tokens:completion},
    neurons:Number.isFinite(usage?.neurons) && usage.neurons>=0?usage.neurons:null,
    predicates,failed_predicates:failed};
}

export async function completion(request,ai,reserve,record,{engineEnabled=false}={}){
  if(request.url!==ENDPOINT || request.method!=='POST' || !ai?.run)return reject(403);
  let body;
  try{body=await boundedJSON(request.body,512*1024);}catch{return reject(400);}
  if(body?.model!==GEMMA || body.stream || !Array.isArray(body.messages) || !body.messages.length ||
    !body.messages.every(m=>['system','assistant','tool','user'].includes(m?.role)) ||
    !Array.isArray(body.tools))return reject(400);
  const tools=body.tools.filter(t=>t?.type==='function' && (MODEL_TOOLS.has(t.function?.name)||(engineEnabled&&t.function?.name==='generate_quantitative_model')));
  const offered=new Set(tools.map(t=>t.function.name));
  const wire={messages:body.messages,...(tools.length?{tools}:{}),max_completion_tokens:maxTokens,
    stream:false,chat_template_kwargs:{enable_thinking:false}};
  const request_bytes=new TextEncoder().encode(JSON.stringify(wire)).length;
  if(request_bytes>131072)return reject(413);
  const attempt=await reserve({stage:'BINDING_INVOKE',status:'RESERVED',request_bytes,usage:null});
  if(!attempt)return reject(403);
  const started=Date.now();
  let result,diagnostic;
  try{
    result=await ai.run(GEMMA,wire);
  }catch(error){
    const code=error?.code??error?.errors?.[0]?.code;
    const numericCode=typeof code==='string' && /^\d{1,7}$/.test(code)?Number(code):code;
    diagnostic={stage:'BINDING_INVOKE',status:'FAILED',reason:'AI_BINDING_EXCEPTION',usage:null,
      provider_code:Number.isSafeInteger(numericCode) && numericCode>=0 && numericCode<=9999999?numericCode:null,
      provider_http_status:Number.isInteger(error?.status) && error.status>=100 && error.status<=599?error.status:null};
  }
  diagnostic??=responseDiagnostic(result,offered);
  const receipt={...diagnostic,request_bytes,elapsed_ms:Math.max(0,Date.now()-started)};
  try{await record(attempt,receipt);}catch{
    // Keep the durable reservation spent. Never turn an ambiguous paid call into an SDK retry.
    console.error(JSON.stringify({event:'FULL_INFERENCE_RECEIPT_WRITE_FAILED',attempt,...receipt}));
    return reject(422);
  }
  if(receipt.status!=='OK')return reject(422);
  const {message,finish_reason}=result.choices[0];
  return Response.json({model:GEMMA,choices:[{index:0,finish_reason,
    message:{role:'assistant',content:message.content??null,...(message.tool_calls?.length?{tool_calls:message.tool_calls}:{})}}],
    usage:result.usage});
}
