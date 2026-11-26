// Opt-in host process, outside the network namespace. No credential reaches
// the original application, workerd, or the sandboxed agent.
import {createServer} from 'node:http';
import {chmodSync,writeFileSync} from 'node:fs';
import {GEMMA} from '../private-merlin/gemma-response.mjs';

const token=process.env.BUFFALO_WORKERS_AI_TOKEN,account=process.env.CLOUDFLARE_ACCOUNT_ID;
const socket=process.env.FULL_LTM_LIVE_SOCKET,receiptPath=process.env.FULL_LTM_BROKER_REPORT;
if(process.env.FULL_LTM_LIVE_APPROVAL!=='RUN_LTM_MATRIX_MAX_64'||!token||!account||!socket||!receiptPath)
  throw Error('EXPLICIT_LIVE_APPROVAL_AND_CREDENTIALS_REQUIRED');
if(!/^[a-f0-9]{32}$/.test(account))throw Error('INVALID_ACCOUNT');
const allowed=new Set(['armsRace','bassDiffusion','inventoryWorkforce','predatorPrey','marketGrowth','maibab','maibab-control','maibab-perturbed']);
const records=[],counts=new Map();let inFlight=false;
const save=()=>writeFileSync(receiptPath,JSON.stringify({ceiling:64,records},null,2));
save();
const server=createServer(async(req,res)=>{
  const reply=(status,body)=>res.writeHead(status,{'content-type':'application/json'}).end(JSON.stringify(body));
  if(req.method!=='POST'||req.url!=='/infer'||inFlight)return reply(429,{error:'REFUSED'});
  inFlight=true;
  try{
    const chunks=[];let n=0;
    for await(const chunk of req){n+=chunk.length;if(n>140000)return reply(413,{error:'INPUT_LIMIT'});chunks.push(chunk);}
    const {caseName,model,wire}=JSON.parse(Buffer.concat(chunks).toString());
    if(!allowed.has(caseName)||model!==GEMMA||!Array.isArray(wire?.messages)||
       Buffer.byteLength(JSON.stringify(wire))>131072||wire.stream!==false||
       !Number.isInteger(wire.max_completion_tokens)||wire.max_completion_tokens<1||wire.max_completion_tokens>8192||
       records.length>=64||(counts.get(caseName)??0)>=8)return reply(403,{error:'BOUNDARY'});
    counts.set(caseName,(counts.get(caseName)??0)+1);
    const record={caseName,attempt:records.length+1,status:'RESERVED'};records.push(record);save();
    try{
      const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+'/ai/run/'+GEMMA,{
        method:'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/json'},
        body:JSON.stringify(wire),signal:AbortSignal.timeout(80000)});
      record.httpStatus=r.status;
      const data=await r.json();
      record.status=r.ok&&data.success===true?'RETURNED':'FAILED';
      if(record.status==='RETURNED'){record.usage=data.result?.usage??null;record.model=data.result?.model??null;record.finish=data.result?.choices?.[0]?.finish_reason??null;}
      else record.providerErrors=(data.errors??[]).map(e=>({code:e.code,message:String(e.message??'').slice(0,200)}));
      save();
      if(record.status==='FAILED')return reply(502,{error:'PROVIDER_REJECTED'});
      return reply(200,data.result);
    }catch(e){record.status='FAILED';record.error=e.name;save();return reply(502,{error:'PROVIDER_EXCEPTION'});}
  }catch{return reply(400,{error:'INVALID_REQUEST'});}
  finally{inFlight=false;}
});
server.listen(socket,()=>{chmodSync(socket,0o600);console.log('LTM_LIVE_BROKER_READY');});
