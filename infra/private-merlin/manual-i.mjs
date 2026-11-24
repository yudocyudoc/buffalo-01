import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {api,query,baseline,configurations as rConfigurations} from './manual-r.mjs';
import {ID as R_ID} from './r-operator.mjs';
import {ID,PASS,SOURCE,IMAGE,LIMITS,TERMINALS,checkHistoricalR,checkIPass,exactGrant} from './i-operator.mjs';
import {armExpiry,CLEANUP_WAIT_MS} from '../buffalo-r1/timing.mjs';
const ACCOUNT='e0cb52526a69c0f48f001901a5b9a640';
const ROUTER='buffalo-merlin-private-router';
const folder='infra/private-merlin/',out=process.env.RUNNER_TEMP+'/private-merlin-i';
const ref='registry.cloudflare.com/'+ACCOUNT+'/buffalo-merlin-private-origin@'+IMAGE;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const save=(name,x)=>{mkdirSync(out,{recursive:true});writeFileSync(out+'/'+name+'.json',JSON.stringify(x,null,2)+'\n')};
async function unused(){
 const rows=await query('SELECT probe_id,run_id,status,receipt_json FROM buffalo_stage3b8r1_receipts WHERE probe_id=?',[R_ID]);
 assert.equal(rows.length,1);const r=checkHistoricalR(rows[0]);
 const n=await query('SELECT COUNT(*) AS n FROM buffalo_stage3b8r1_receipts WHERE probe_id=? OR status=?',[ID,'CLAIMED']);
 assert.equal(n[0].n,0,'PRIVATE_I_ALREADY_CLAIMED');
 return r;
}
export function configurations(input){
 const {disabled,armed,g:r}=rConfigurations({...input,source:SOURCE,ref});
 const g={...r,phase:'I',...LIMITS};
 exactGrant(g);
 for(const c of Object.values(armed))c.vars.MERLIN_GRANT=JSON.stringify(g);
 armed.operator.main='i-operator.mjs'; // Restore the exact R operator config after I.
 return {disabled,armed,g};
}
function generate(expires,task){
 const model=readFileSync('infra/buffalo-origin/probe-initial-model.json','utf8').replace(/\n$/,'');
 const result=configurations({router:JSON.parse(readFileSync(folder+'wrangler.router.template.json')),bridge:JSON.parse(readFileSync(folder+'wrangler.bridge.jsonc')),operator:JSON.parse(readFileSync(folder+'wrangler.r-operator.template.json')),task,model,expires});
 for(const [mode,configs] of [['disabled',result.disabled],['armed',result.armed]])for(const [kind,c] of Object.entries(configs))writeFileSync(folder+'wrangler.i-'+kind+'-'+mode+'.json',JSON.stringify(c,null,2));
 save('grant',result.g);return result.g;
}
async function main(){
 assert.equal(process.env.CLOUDFLARE_ACCOUNT_ID,ACCOUNT);assert(process.env.CLOUDFLARE_API_TOKEN);
 const phase=process.argv[2];
 if(phase==='preflight'){await baseline(true);const r=await unused();save('prior-r',{probe_id:R_ID,run_id:r.run_id,source_commit:SOURCE,image_digest:IMAGE,status:r.status});}
 else if(phase==='configs'){generate(0,randomUUID());}
 else if(phase==='arm'){await baseline(true);const r=await unused();const g=JSON.parse(readFileSync(out+'/grant.json'));assert.notEqual(g.task_id,r.run_id);generate(Date.parse(armExpiry()),g.task_id);}
 else if(phase==='secret-check'){
  const secrets=await api('/workers/scripts/'+ROUTER+'/secrets');
  assert.deepEqual(secrets.map(s=>s.name),['MERLIN_AI_TOKEN']);
 }else if(phase==='remove-secret'){
  const path='/workers/scripts/'+ROUTER+'/secrets';const secrets=await api(path);
  if(secrets.some(s=>s.name==='MERLIN_AI_TOKEN'))await api(path+'/MERLIN_AI_TOKEN','DELETE');
  assert.deepEqual(await api(path),[]);
 }else if(phase==='cleanup'){
  const limit=Date.now()+CLEANUP_WAIT_MS;
  for(;;){try{await baseline(true);save('cleanup',{status:'ZERO_ACTIVE_AND_DISABLED_NO_AI_SECRET'});break}catch(e){if(Date.now()>=limit)throw e;await sleep(5000)}}
 }else if(phase==='observe'){
  const g=exactGrant(JSON.parse(readFileSync(out+'/grant.json')));
  while(Date.now()<g.expires+240000){
   const rows=await query('SELECT run_id,status,receipt_json FROM buffalo_stage3b8r1_receipts WHERE probe_id=?',[ID]);
   if(rows.length===1&&rows[0].status!=='CLAIMED'){
    const row=rows[0],r=JSON.parse(row.receipt_json);
    assert.equal(row.run_id,g.task_id);assert.equal(r.probe_id,ID);assert.equal(r.run_id,g.task_id);assert.equal(r.source_commit,SOURCE);assert.equal(r.image_digest,IMAGE);assert.equal(r.status,row.status);
    assert.deepEqual(r.approval,g);assert(TERMINALS.has(r.status));assert.equal(r.inference_authorized,true);
    save('remote-receipt',r);
    if(r.status===PASS){
     await checkIPass(r.task,g);
     const u=r.task.receipt.usage;
     save('usage',{provider_model:LIMITS.provider_model,posts:1,prompt_tokens:u.prompt_tokens,completion_tokens:u.completion_tokens,invoice_measured:false});
     console.log('PRIVATE_MERLIN_I_USAGE '+JSON.stringify(u));
    }
    console.log('PRIVATE_MERLIN_I_MEASURED_OUTCOME '+r.status);
    if(r.status!==PASS)throw Error('PRIVATE_I_DID_NOT_PASS_NO_RETRY');
    return;
   }
   await sleep(10000);
  }
  throw Error('PRIVATE_I_NO_TERMINAL_RECEIPT_NO_RETRY');
 }else throw Error('UNKNOWN_PHASE');
}
if(process.argv[1]?.endsWith('/manual-i.mjs'))main().catch(e=>{console.error(e.message);process.exitCode=1});
