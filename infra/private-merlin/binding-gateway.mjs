// Native Workers AI: one reserved invocation, no REST credential, no fallback.
import {ENDPOINT,grant,requireThat,verifyClaim} from './protocol.mjs';
import {boundedJSON} from './gateway.mjs';
export const BINDING_TRANSPORT='binding-v2';
export const GEMMA='@cf/google/gemma-4-26b-a4b-it';
export function durableStage(env,phase){
 return phase==='I'&&env.MERLIN_I_TRANSPORT===BINDING_TRANSPORT?'I-binding-v2':phase;
}
const safeErrorCode=e=>Number.isSafeInteger(e?.code)&&e.code>=0&&e.code<=9999999?e.code:null;
const safeStatus=e=>Number.isSafeInteger(e?.status)&&e.status>=100&&e.status<=599?e.status:null;
export async function bindingProviderRequest(storage,env,phase,request){
 let stage='INTERCEPT',reason='INTERCEPT_FAILURE',reserved=false;
 let started=null,usage=null,finish_reason=null;
 const note=async(status,extra={})=>{
  await storage.transaction(async tx=>{
   const s=await tx.get('run');
   if(s?.status!=='RUNNING')return;
   // A concurrent denied request must not overwrite the winning invocation.
   if(!reserved&&s.posts!==0)return;
   await tx.put('run',{...s,provider_diagnostic:{transport:BINDING_TRANSPORT,stage,status,
    elapsed_ms:started===null?null:Math.max(0,Date.now()-started),...extra}});
  });
 };
 try{
  const counter=await storage.transaction(async tx=>{
   const s=await tx.get('run');requireThat(s?.phase===phase&&s.status==='RUNNING','NO_ACTIVE_RUN');
   const next={...s,egress_attempts:s.egress_attempts+1};await tx.put('run',next);return next;
  });
  if(phase!=='I'||request.method!=='POST'||request.url!==ENDPOINT)return new Response(null,{status:403});
  stage='GRANT';reason='GRANT_OR_BINDING_DENIED';
  const g=grant(env,'I');verifyClaim(g,counter.approval);
  requireThat(env.MERLIN_I_TRANSPORT===BINDING_TRANSPORT&&g.task_id===counter.task_id&&
   g.provider_model===GEMMA&&g.max_posts===1&&g.max_input_bytes===131072&&g.max_output_tokens===2048&&
   typeof env.AI?.run==='function','BINDING_NOT_ARMED');
  stage='REQUEST';reason='INVALID_AGENT_PROMPT';
  const body=await boundedJSON(request.body,512*1024);
  requireThat(body.model===GEMMA&&!body.stream&&body.messages?.length===2&&
   body.messages.every((m,i)=>m.role===(i===0?'system':'user')&&typeof m.content==='string')&&
   body.messages[1].content.includes(counter.sd_json),'INVALID_AGENT_PROMPT');
  const wire={messages:body.messages.map(({role,content})=>({role,content})),max_completion_tokens:g.max_output_tokens,stream:false};
  reason='INPUT_BUDGET';
  const bytes=new TextEncoder().encode(JSON.stringify({model:GEMMA,...wire})).length;
  requireThat(bytes<=g.max_input_bytes,'INPUT_BUDGET');
  stage='RESERVE';reason='POST_DENIED';
  await storage.transaction(async tx=>{
   const s=await tx.get('run');requireThat(s.status==='RUNNING'&&s.posts===0&&Date.now()<s.deadline&&Date.now()<g.expires,'POST_DENIED');
   verifyClaim(g,s.approval);
   await tx.put('run',{...s,posts:1,provider_model:GEMMA,usage:null,
    provider_diagnostic:{transport:BINDING_TRANSPORT,stage:'BINDING_INVOKE',status:'RESERVED',request_bytes:bytes}});
  });
  reserved=true;started=Date.now();stage='BINDING_INVOKE';reason='AI_BINDING_EXCEPTION';
  // The slot is spent before calling; there is no retry even if acknowledgment is ambiguous.
  // The existing Router deadline/watchdog limits the Container, not provider-side billing.
  const result=await env.AI.run(GEMMA,wire);
  stage='RESPONSE';reason='INVALID_PROVIDER_RESPONSE';
  const u=result?.usage,choice=result?.choices?.[0];
  usage=u&&[u.prompt_tokens,u.completion_tokens].every(n=>Number.isSafeInteger(n)&&n>=0)
   ?{prompt_tokens:u.prompt_tokens,completion_tokens:u.completion_tokens}:null;
  finish_reason=['stop','length','tool_calls','content_filter','function_call'].includes(choice?.finish_reason)?choice.finish_reason:'unknown';
  // Store known usage even for an invalid or truncated response; do not fabricate unknown usage.
  await storage.transaction(async tx=>{
   const s=await tx.get('run');if(s.status!=='RUNNING')return;
   await tx.put('run',{...s,usage,finish_reason,provider_diagnostic:{transport:BINDING_TRANSPORT,stage,status:'RETURNED',
    elapsed_ms:Math.max(0,Date.now()-started),request_bytes:bytes}});
  });
  requireThat(usage&&usage.prompt_tokens>0&&usage.completion_tokens>0&&usage.completion_tokens<=g.max_output_tokens&&
   result?.model===GEMMA&&result.choices?.length===1&&finish_reason==='stop'&&choice.message?.role==='assistant'&&
   !choice.message.tool_calls?.length&&!choice.message.function_call&&typeof choice.message.content==='string'&&
   choice.message.content.trim()&&choice.message.content.length<=16000,'INCOMPLETE_OR_NON_TEXT_PROVIDER_RESPONSE');
  stage='COMPLETE';reason='RESPONSE_COMMIT_FAILURE';
  await note('OK',{request_bytes:bytes});
  return Response.json({model:GEMMA,choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:choice.message.content}}],usage});
 }catch(e){
  // Persist only allowlisted stage, reason and numeric provider metadata. No raw exception,
  // prompt, authorization header or response body. Do not invent a provider HTTP status.
  const diagnostic={reason,provider_code:safeErrorCode(e),provider_http_status:safeStatus(e)};
  await note('FAILED',diagnostic).catch(()=>{});
  console.log(JSON.stringify({event:'MERLIN_NATIVE_AI_FAILURE',stage,...diagnostic,reserved}));
  return new Response(null,{status:reserved?502:403});
 }
}
