import {ENDPOINT} from '../private-merlin/protocol.mjs';
import {GEMMA,acceptedGemmaModel} from '../private-merlin/gemma-response.mjs';
import {boundedJSON} from '../private-merlin/gateway.mjs';

const editTools=new Set(['get_current_model','read_model_section','edit_variables','update_model']);
const reject=(status)=>new Response(null,{status});

export async function completion(request,ai,reserve){
  if(request.url!==ENDPOINT || request.method!=='POST' || !ai?.run)return reject(403);
  let body;
  try{body=await boundedJSON(request.body,512*1024);}catch{return reject(400);}
  if(body.model!==GEMMA || body.stream || !Array.isArray(body.messages) || !body.messages.length ||
    !body.messages.every(m=>['system','assistant','tool','user'].includes(m?.role)) ||
    !Array.isArray(body.tools))return reject(400);
  const tools=body.tools.filter(t=>t?.type==='function' && editTools.has(t.function?.name));
  const offered=new Set(tools.map(t=>t.function.name));
  const wire={messages:body.messages,...(tools.length?{tools}:{}),max_completion_tokens:2048,
    stream:false,chat_template_kwargs:{enable_thinking:false}};
  if(new TextEncoder().encode(JSON.stringify(wire)).length>131072)return reject(413);
  if(!await reserve())return reject(403);
  // Charge the reservation before the binding call, including ambiguous failures.
  let result;
  // The original SDK retries 5xx responses. An ambiguous paid invocation is terminal.
  try{result=await ai.run(GEMMA,wire);}catch{return reject(422);}
  const c=result?.choices?.[0], m=c?.message, u=result?.usage;
  if(!acceptedGemmaModel(result?.model) || result.choices?.length!==1 || m?.role!=='assistant' ||
    !Number.isSafeInteger(u?.prompt_tokens) || u.prompt_tokens<=0 ||
    !Number.isSafeInteger(u?.completion_tokens) || u.completion_tokens<=0 || u.completion_tokens>2048 ||
    m.function_call || (m.content!=null && (typeof m.content!=='string'||m.content.length>16000)))return reject(422);
  const calls=m.tool_calls??[];
  if(!Array.isArray(calls))return reject(422);
  if(c.finish_reason==='tool_calls'){
    if(!calls.length || !calls.every(t=>t?.type==='function' && typeof t.id==='string' && t.id &&
      offered.has(t.function?.name) && typeof t.function.arguments==='string') ||
      new Set(calls.map(t=>t.id)).size!==calls.length)return reject(422);
    try{for(const call of calls){const args=JSON.parse(call.function.arguments);
      if(!args || Array.isArray(args) || typeof args!=='object')return reject(422);}}catch{return reject(422);}
  }else if(c.finish_reason!=='stop' || calls.length || typeof m.content!=='string' || !m.content.trim())return reject(422);
  return Response.json({model:GEMMA,choices:[{index:0,finish_reason:c.finish_reason,
    message:{role:'assistant',content:m.content??null,...(calls.length?{tool_calls:calls}:{})}}],usage:u});
}
