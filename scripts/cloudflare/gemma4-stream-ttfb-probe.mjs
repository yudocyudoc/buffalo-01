/**
 * Gemma 4 latency-protocol probe. Explicit paid opt-in only.
 *
 * Usage:
 *   BUFFALO_PAID_RUN=I_ACCEPT_CLOUDFLARE_AI_COSTS \
 *   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
 *   node scripts/cloudflare/gemma4-stream-ttfb-probe.mjs
 *
 * Exactly TWO independent streaming requests containing the SAME synthetic
 * tool-response conversation. Comparison: native /ai/run vs OpenAI-compatible.
 * Neither request triggers local tool execution nor runs an agent/simulation.
 * Measures headers, first incoming byte, first SSE event, first actual content
 * delta and finished response via native Node fetch, which MCP cannot measure.
 *
 * WARNING: a per-run neuron admission estimate is NOT a provider billing cap.
 */
import {createHash} from 'node:crypto';
import {quoteNeurons, meteredNeurons} from './neuron-budget.mjs';

const MODEL='@cf/google/gemma-4-26b-a4b-it';
const APPROVAL='I_ACCEPT_CLOUDFLARE_AI_COSTS';
const HEADERS={'content-type':'application/json'};
const METERING_LIMIT=200;
const TIMEOUT_MS=90000;

function assert(value,code){if(!value)throw Error(code)}
function now(){return performance.now()}
function rounded(ms){return ms===null?null:Math.round(ms*100)/100}
function sha(text){return createHash('sha256').update(text).digest('hex')}
function makeBody(){
  const tool={
    type:'function',
    function:{
      name:'read_model_section',
      description:'Read the requested section of a system dynamics model. This is a synthetic compatibility probe only.',
      parameters:{type:'object',properties:{
        section:{type:'string',enum:['specs','variables','relationships','modules']}
      },required:['section']}
    }
  };
  const call={id:'call_synthetic_probe',type:'function',function:{
    name:'read_model_section',arguments:'{"section":"specs"}'
  }};
  return {
    model:MODEL,stream:true,max_completion_tokens:128,temperature:0,
    chat_template_kwargs:{enable_thinking:false},
    tools:[tool],
    messages:[
      {role:'system',content:'You are a system dynamics assistant. A tool returned simulation specifications. Report its startTime, stopTime and dt in one sentence. Do not call any further tool. Do not simulate or edit.'},
      {role:'user',content:'Inspect the dialysis clinic simulation specifications, then report its start, stop, and dt.'},
      {role:'assistant',content:'',tool_calls:[call]},
      {role:'tool',tool_call_id:call.id,content:'{"startTime":0,"stopTime":24,"dt":1,"synthetic":true}'}
    ]
  };
}

function eventSummaries(raw){
  const events=raw.split(/\r?\n\r?\n/);
  return events.filter(v=>v.trim()).map(block=>{
    const data=block.split(/\r?\n/).filter(x=>x.startsWith('data: ')).map(x=>x.slice(6)).join('\n');
    if(data==='[DONE]')return{done:true};
    try{const json=JSON.parse(data);return{json}}catch{return{unparsed:true}}
  });
}

async function oneProbe(endpoint,body,token,account){
  const target='https://api.cloudflare.com/client/v4/accounts/'+account+'/ai/'+
    (endpoint==='native'?'run/'+MODEL:'v1/chat/completions');
  const started=now();
  const result={endpoint,request_sha256:sha(JSON.stringify(body)),request_chars:JSON.stringify(body).length,
    maxCompletionTokens:body.max_completion_tokens,thinking:false,stream:true,
    http_status:null,headers_ms:null,first_byte_ms:null,first_sse_ms:null,
    first_content_delta_ms:null,finished_ms:null,events:0,contentDeltas:0,
    finishReason:null,providerModel:null,usage:null,protocol:null,
    connectionError:null,provider_error_code:null};
  let controller=new AbortController();
  // Timeout is explicit; this is not proof of a provider-side timeout.
  const timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);
  const eventTime=[];
  let buffer='',sseEvents=0,fullContent='',lastTotalUsage=null,sawDone=false;
  try{
    const response=await fetch(target,{method:'POST',
      headers:{...HEADERS,authorization:'Bearer '+token},
      body:JSON.stringify(body),signal:controller.signal});
    result.headers_ms=rounded(now()-started);
    result.http_status=response.status;
    result.protocol=response.headers.get('content-type');
    assert(response.body,'BUFFALO_CF_PROBE_MISSING_BODY');
    const decoder=new TextDecoder();
    for await (const chunk of response.body){
      if(result.first_byte_ms===null)result.first_byte_ms=rounded(now()-started);
      buffer+=decoder.decode(chunk,{stream:true});
      let sep;
      while((sep=buffer.search(/\r?\n\r?\n/))>=0){
        const match=buffer.slice(sep).match(/^\r?\n\r?\n/);
        const block=buffer.slice(0,sep);
        buffer=buffer.slice(sep+match[0].length);
        const e=eventSummaries(block+'\n\n')[0];
        if(!e)continue;
        if(e.done){sawDone=true;continue}
        if(!e.json)continue;
        sseEvents++;
        if(result.first_sse_ms===null)result.first_sse_ms=rounded(now()-started);
        const j=e.json;
        result.providerModel=j.model??result.providerModel;
        const choice=j.choices?.[0];
        if(choice?.finish_reason)result.finishReason=choice.finish_reason;
        if(j.usage?.neurons!==undefined &&
           (j.usage.prompt_tokens>0 || j.usage.total_tokens>100))
          lastTotalUsage=j.usage;
        if(typeof choice?.delta?.content==='string' && choice.delta.content.length){
          if(result.first_content_delta_ms===null)
            result.first_content_delta_ms=rounded(now()-started);
          fullContent+=choice.delta.content;
          result.contentDeltas++;
        }
      }
    }
    result.events=sseEvents;
    result.finished_ms=rounded(now()-started);
    result.sawDone=sawDone;
    result.response_chars=fullContent.length;
    result.response_sha256=sha(fullContent);
    result.usage=lastTotalUsage;
    if(!response.ok)result.connectionError='PROVIDER_HTTP_'+response.status;
    if(!sawDone)result.connectionError??='STREAM_DID_NOT_END_WITH_DONE';
  }catch(e){
    result.finished_ms=rounded(now()-started);
    result.connectionError=e?.name==='AbortError'?'CLIENT_TIMEOUT_90000MS':
      e?.name??'NETWORK_ERROR';
  }finally{clearTimeout(timer)}
  return result;
}

export async function runProbe(){
  assert(process.env.BUFFALO_PAID_RUN===APPROVAL,'BUFFALO_CF_PROBE_REQUIRES_MANUAL_PAID_OPT_IN');
  const account=process.env.CLOUDFLARE_ACCOUNT_ID??'';
  const token=process.env.CLOUDFLARE_API_TOKEN??'';
  assert(/^[a-f\d]{32}$/i.test(account),'BUFFALO_CF_INVALID_ACCOUNT_ID');
  assert(token,'BUFFALO_CF_MISSING_API_TOKEN');
  const body=makeBody();
  const quote=quoteNeurons(MODEL,body);
  assert(quote.reservedNeurons*2<=METERING_LIMIT,'BUFFALO_CF_PROBE_RESERVATION_LIMIT');
  let sumMeasured=0;
  const results=[];
  for(const endpoint of ['openai','native']){
    if(results.length>=2)break;
    const item=await oneProbe(endpoint,body,token,account);
    results.push(item);
    const metering=meteredNeurons(MODEL,item.usage);
    // No unknown-cost repeat: immediately stop after an errored/unmetered or
    // unexpectedly expensive request. The remaining step must NOT be sent.
    if(item.connectionError || !item.usage || !metering){
      break;
    }
    sumMeasured+=metering.neurons;
    if(sumMeasured>100)break;
  }
  const result={
    experiment:'GEMMA4_STREAM_TTFB_V1',
    toolExecution:false,simulation:false,
    maxPosts:2,posts:results.length,
    maxCompletionTokensPerPost:128,
    localReservationLimitNeurons:METERING_LIMIT,
    totalMeasuredNeurons:results.every(x=>x.usage)?sumMeasured:null,
    usageUnknown:results.some(x=>!x.usage),
    comparisonValid:results.length===2 && results.every(x=>!x.connectionError),
    results
  };
  console.log(JSON.stringify(result,null,2));
  if(!result.comparisonValid)process.exitCode=2;
  return result;
}
if(import.meta.url===new URL(process.argv[1]??'', 'file://').href)await runProbe();
