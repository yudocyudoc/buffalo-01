/**
 * Test-only native fetch stub, loaded BEFORE bootstrap. It never reaches network.
 * A fake HTTP 200 can carry finish_reason=length, stop, or tool_calls.
 * No Cloudflare token or production endpoint is ever contacted.
 */
const originalFetch=globalThis.fetch;
const calls=[];
globalThis.__buffaloMockCloudflareOrigin={calls,originalFetch};
globalThis.fetch=async (input,init={})=>{
  const target=typeof input==='string'||input instanceof URL?String(input):input.url;
  if (!target.startsWith('https://api.cloudflare.com/client/v4/accounts/')||
    !target.endsWith('/ai/v1/chat/completions'))
    throw Error('OFFLINE_MOCK_BLOCKED_UNEXPECTED_NETWORK_URL: '+target);
  const body=typeof init.body==='string'?init.body:
    input instanceof Request?await input.clone().text():'';
  if (!body) throw Error('OFFLINE_MOCK_BODY_MISSING');
  const wire=JSON.parse(body);
  calls.push({url:target,wire});
  const outcome=process.env.BUFFALO_MOCK_FINISH || 'length';
  if (!['length','stop','tool_calls','http499'].includes(outcome))
    throw Error('OFFLINE_MOCK_UNKNOWN_OUTCOME');
  if (outcome==='http499') {
    return new Response(JSON.stringify({
      errors:[{message:'AiError: Client Closed Request (offline mock)',code:6001}],
      success:false,result:{},messages:[]
    }),{status:499,headers:{'content-type':'application/json'}});
  }
  const toolCalls=outcome==='tool_calls'?[{
    id:'call_mock1',type:'function',
    function:{name:'read_model_section',arguments:'{"section":"stocks"}'}
  }]:[];
  const response={
    id:'chatcmpl-offline-deterministic',object:'chat.completion',
    model:wire.model,
    choices:[{index:0,finish_reason:outcome,message:{
      role:'assistant',
      content:outcome==='length'?'incomplete output':'completed output',
      ...(toolCalls.length?{tool_calls:toolCalls}:{})
    }}],
    usage:{prompt_tokens:120,completion_tokens:outcome==='length'?4096:24,neurons:45}
  };
  return new Response(JSON.stringify(response),{
    status:200,headers:{'content-type':'application/json'}
  });
};
