import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {api,query,baseline} from './manual-r.mjs';
import {ID,FAILED_ID,MODEL,INPUT,checkPrior,responseChecks} from './gemma-contract-probe.mjs';
import {armExpiry,CLEANUP_WAIT_MS} from '../buffalo-r1/timing.mjs';
const folder='infra/private-merlin/',out=process.env.RUNNER_TEMP+'/gemma-contract';
const name='buffalo-merlin-private-r-operator';
const save=(n,v)=>{mkdirSync(out,{recursive:true});writeFileSync(out+'/'+n+'.json',JSON.stringify(v,null,2)+'\n')};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function preflight(){
 await baseline(true);
 const prior=await query('SELECT probe_id,run_id,status,receipt_json FROM buffalo_stage3b8r1_receipts WHERE probe_id=?',[FAILED_ID]);
 assert.equal(prior.length,1);checkPrior(prior[0]);
 const rows=await query('SELECT COUNT(*) AS n FROM buffalo_stage3b8r1_receipts WHERE probe_id=? OR status=?',[ID,'CLAIMED']);
 assert.equal(rows[0].n,0,'GEMMA_PROBE_ALREADY_CLAIMED');
}
function configs(expires,task_id){
 const disabled=JSON.parse(readFileSync(folder+'wrangler.r-operator.template.json','utf8'));
 assert.equal(disabled.name,name);assert.equal(disabled.vars.MERLIN_GRANT,'null');assert.equal(disabled.workers_dev,false);assert.equal(disabled.preview_urls,false);assert.deepEqual(disabled.triggers.crons,[]);
 const grant={task_id,source_commit:process.env.GITHUB_SHA,model:MODEL,max_calls:1,max_output_tokens:32,expires};
 assert.match(grant.source_commit,/^[a-f0-9]{40}$/);
 const armed=structuredClone(disabled);armed.main='gemma-contract-probe.mjs';
 delete armed.services;armed.vars={GEMMA_PROBE_GRANT:JSON.stringify(grant)};armed.ai={binding:'AI'};armed.triggers.crons=['* * * * *'];
 for(const [mode,c] of [['disabled',disabled],['armed',armed]])writeFileSync(folder+'wrangler.gemma-contract-'+mode+'.json',JSON.stringify(c,null,2));
 save('grant',grant);
}
async function main(){
 assert.equal(process.env.CLOUDFLARE_ACCOUNT_ID,'e0cb52526a69c0f48f001901a5b9a640');assert(process.env.CLOUDFLARE_API_TOKEN);
 switch(process.argv[2]){
 case 'preflight':await preflight();configs(0,randomUUID());break;
 case 'arm':await preflight();configs(Date.parse(armExpiry()),JSON.parse(readFileSync(out+'/grant.json')).task_id);break;
 case 'observe':{
  const g=JSON.parse(readFileSync(out+'/grant.json'));
  while(Date.now()<g.expires+120000){
   const rows=await query('SELECT probe_id,run_id,status,receipt_json FROM buffalo_stage3b8r1_receipts WHERE probe_id=?',[ID]);
   if(rows.length===1&&rows[0].status!=='CLAIMED'){
    const x=JSON.parse(rows[0].receipt_json);
    assert.equal(rows[0].run_id,g.task_id);assert.equal(x.run_id,g.task_id);assert.equal(x.probe_id,ID);assert.equal(x.status,rows[0].status);assert.deepEqual(x.approval,g);assert.deepEqual(x.request,INPUT);assert.equal(x.reserved_calls,1);
    save('response-receipt',x);
    console.log('GEMMA_CONTRACT_OUTCOME '+x.status);
    if(x.usage)console.log('GEMMA_CONTRACT_USAGE '+JSON.stringify(x.usage));
    if(x.checks)console.log('GEMMA_CONTRACT_CHECKS '+JSON.stringify(x.checks));
    if(x.status==='RESPONSE_CAPTURED'){
     assert.deepEqual(x.checks,responseChecks(x.response));
     assert.equal(x.response_bytes,Buffer.byteLength(JSON.stringify(x.response)));
     console.log('GEMMA_CONTRACT_RESPONSE '+JSON.stringify(x.response));return;
    }
    throw Error('GEMMA_CONTRACT_NO_RESPONSE_NO_RETRY');
   }
   await sleep(10000);
  }
  throw Error('GEMMA_CONTRACT_NO_TERMINAL_NO_RETRY');
 }
 case 'cleanup':{
  const until=Date.now()+CLEANUP_WAIT_MS;
  for(;;){try{await baseline(true);save('cleanup',{status:'ZERO_ACTIVE_AND_DISABLED_NO_AI_BINDING'});return}catch(e){if(Date.now()>=until)throw e;await sleep(5000)}}
 }
 default:throw Error('UNKNOWN_PHASE');
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
