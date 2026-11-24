import {ENDPOINT,grant,requireThat,verifyClaim} from './protocol.mjs';

export async function boundedJSON(stream,max) {
  requireThat(stream,'MISSING_BODY');
  const reader=stream.getReader();
  const parts=[];
  let n=0;
  try {
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      n+=value.byteLength;
      requireThat(n<=max,'BODY_LIMIT');
      parts.push(value);
    }
  } finally {await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(n);
  let pos=0;
  for(const p of parts){bytes.set(p,pos);pos+=p.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}

// The provider token never enters the container. Only a text response with a real
// stop reason reaches Merlin. No tool definition or provider-generated tool call crosses.
export async function providerRequest(storage,env,phase,request,send=fetch) {
  const counter=await storage.transaction(async tx=>{
    const state=await tx.get('run');
    requireThat(state?.phase===phase && state.status==='RUNNING','NO_ACTIVE_RUN');
    const counted={...state,egress_attempts:state.egress_attempts+1};
    await tx.put('run',counted);
    return counted;
  });
  if(phase!=='I'||request.method!=='POST'||request.url!==ENDPOINT)return new Response(null,{status:403});
  const g=grant(env,'I');
  verifyClaim(g,counter.approval);
  requireThat(g.task_id===counter.task_id && env.MERLIN_AI_TOKEN,'PROVIDER_NOT_ARMED');
  const body=await boundedJSON(request.body,512*1024);
  requireThat(body.model===g.provider_model && !body.stream && body.messages?.length===2 &&
    body.messages.every((m,i)=>m.role===(i===0?'system':'user') && typeof m.content==='string') &&
    body.messages[1].content.includes(counter.sd_json),'INVALID_AGENT_PROMPT');
  const wire={model:g.provider_model,messages:body.messages.map(({role,content})=>({role,content})),
    max_completion_tokens:g.max_output_tokens,stream:false};
  const payload=JSON.stringify(wire);
  requireThat(new TextEncoder().encode(payload).length<=g.max_input_bytes,'INPUT_BUDGET');
  await storage.transaction(async tx=>{
    const s=await tx.get('run');
    requireThat(s.status==='RUNNING' && s.posts===0 && Date.now()<s.deadline && Date.now()<g.expires,'POST_DENIED');
    await tx.put('run',{...s,posts:1,provider_model:g.provider_model,usage:null});
  });
  // Fixed account and endpoint, no redirects and no retries after reservation.
  const response=await send('https://api.cloudflare.com/client/v4/accounts/e0cb52526a69c0f48f001901a5b9a640/ai/v1/chat/completions',{
    method:'POST',headers:{authorization:'Bearer '+env.MERLIN_AI_TOKEN,'content-type':'application/json'},
    body:payload,redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(counter.deadline,g.expires)-Date.now()))});
  if(!response.ok){await response.body?.cancel();throw Error('PROVIDER_HTTP_'+response.status);}
  const result=await boundedJSON(response.body,100_000);
  const choice=result.choices?.[0];
  const u=result.usage;
  const usage=u && [u.prompt_tokens,u.completion_tokens].every(n=>Number.isSafeInteger(n)&&n>=0)
    ? {prompt_tokens:u.prompt_tokens,completion_tokens:u.completion_tokens} : null;
  await storage.transaction(async tx=>{
    const s=await tx.get('run');
    if(s.status==='RUNNING')await tx.put('run',{...s,usage,finish_reason:choice?.finish_reason==='stop'?'stop':'incomplete'});
  });
  requireThat(usage && usage.prompt_tokens>0 && usage.completion_tokens>0 && usage.completion_tokens<=g.max_output_tokens &&
    result.choices?.length===1 && choice.finish_reason==='stop' && choice.message?.role==='assistant' &&
    !choice.message.tool_calls?.length && !choice.message.function_call &&
    typeof choice.message.content==='string' && choice.message.content.trim() && choice.message.content.length<=16000,
    'INCOMPLETE_OR_NON_TEXT_PROVIDER_RESPONSE');
  return Response.json({model:g.provider_model,choices:[{index:0,finish_reason:'stop',
    message:{role:'assistant',content:choice.message.content}}],usage});
}
