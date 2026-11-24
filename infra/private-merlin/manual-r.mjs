import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {ID,PASS,TERMINALS,checkRemotePass} from './r-operator.mjs';
import {MODEL} from './protocol.mjs';
import {ID as R2_ID,boundedReceipt as validateR2} from '../buffalo-r2/receipt.mjs';
import {armExpiry,CLEANUP_WAIT_MS} from '../buffalo-r1/timing.mjs';
const ACCOUNT='e0cb52526a69c0f48f001901a5b9a640',DB='d1e23807-b076-4c36-8785-7b423fc41614';
const root='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT;
const names={router:'buffalo-merlin-private-router',bridge:'buffalo-merlin-private-bridge',operator:'buffalo-merlin-private-r-operator'};
const appName='buffalo-merlin-private-origin';
const oldApps=['buffalo-private-origin-lab','buffalo-namespace-r1-private-lab','buffalo-original-worker-r2-private-lab'];
const oldWorkers=['buffalo-private-origin-router-lab','buffalo-original-ws-bridge-lab','buffalo-namespace-r1-private-lab','buffalo-original-worker-r2-private-lab'];
const folder='infra/private-merlin/',out=process.env.RUNNER_TEMP+'/private-merlin-r';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const save=(name,x)=>{mkdirSync(out,{recursive:true});writeFileSync(out+'/'+name+'.json',JSON.stringify(x,null,2)+'\n')};
export async function api(path,method='GET',body){
 const r=await fetch(root+path,{method,headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
 assert(r.ok,'CF_HTTP_'+r.status+' '+path);const x=await r.json();assert.equal(x.success,true);return x.result;
}
export async function query(sql,params=[]){
 const x=await api('/d1/database/'+DB+'/query','POST',{sql,params});assert.equal(x[0]?.success,true);return x[0].results;
}
async function privateWorker(name,expect){
 const [sub,schedules,secrets,settings]=await Promise.all(['subdomain','schedules','secrets','settings'].map(k=>api('/workers/scripts/'+name+'/'+k)));
 assert.equal(sub.enabled,false,name);assert.equal(sub.previews_enabled,false,name);assert.deepEqual(schedules.schedules,[],name);assert.equal(secrets.length,0,name);
 for(const [k,v] of Object.entries(expect))assert.equal(settings.bindings.find(b=>b.name===k)?.text,v,name+' '+k);
 return settings;
}
export async function baseline(expectNew=false){
 const [apps,usage,workers]=await Promise.all([api('/containers/applications'),api('/containers/usage'),api('/workers/scripts')]);
 assert.equal(usage.usage?.instances,0);
 assert.deepEqual(apps.map(a=>a.name).sort(),[...oldApps,...(expectNew?[appName]:[])].sort());
 for(const a of apps){assert.equal(a.health?.instances?.active,0,a.name);assert.equal(a.health?.instances?.starting,0,a.name);assert.deepEqual(await api('/containers/applications/'+a.id+'/instances-v2?state=active&per_page=100'),[])}
 for(const n of oldWorkers){
  const r1=n.includes('namespace-r1'),r2=n.includes('worker-r2'),origin=n.includes('origin-router');
  const expect=r1?{R1_MODE:'DISABLED',R1_EXPIRES_AT:'1970-01-01T00:00:00.000Z'}:r2?{R2_MODE:'DISABLED',R2_EXPIRES_AT:'1970-01-01T00:00:00.000Z'}:origin?{BUFFALO_ORIGIN_MODE:'HANDSHAKE_ONLY_NO_AGENT_PROCESS'}:{};
  const s=await privateWorker(n,expect);
  const prefix=r1?'R1':'R2';
  const expected=r1||r2?['DB',...['MODE','EXPECTED_SHA','EXPIRES_AT','IMAGE_DIGEST','CONTAINER'].map(k=>prefix+'_'+k)]:origin?['BUFFALO_CONTAINER','BUFFALO_ORIGIN_MODE','BUFFALO_ORIGIN_COMMIT_SHA','BUFFALO_ORIGIN_MODEL_SHA256']:['DB'];
  assert.deepEqual(s.bindings.map(b=>b.name).sort(),expected.sort(),n);
 }
 for(const [kind,n] of Object.entries(names)){
  assert.equal(workers.some(w=>w.id===n||w.name===n),expectNew,n);
  if(expectNew){
   const s=await privateWorker(n,{MERLIN_GRANT:'null',...(kind==='operator'?{MERLIN_SD_JSON:''}:{})});
   const expected=kind==='router'?['MERLIN_GRANT','ORIGINS']:kind==='bridge'?['MERLIN_GRANT','ROUTER','TASKS']:['DB','MERLIN','MERLIN_GRANT','MERLIN_SD_JSON'];
   assert.deepEqual(s.bindings.map(b=>b.name).sort(),expected.sort(),n);
  }
 }
}
export function checkR2Row(row){
 assert.equal(row?.probe_id,R2_ID);assert.equal(row.status,'R2_REMOTE_ORIGINAL_PROCESS_PASS');
 const r=JSON.parse(row.receipt_json);
 assert.equal(r.probe_id,R2_ID);assert.equal(r.run_id,row.run_id);assert.equal(r.source_commit,'5124b829d23ddf9dcac4d051fbd726100fc95b03');
 assert.equal(r.image_digest,'sha256:8c4868c34d27346624f7295e9f8f3231af6f01113479258012ec3a0ec5750e32');
 assert.equal(r.status,row.status);assert.equal(r.phase,'PROBE_RECEIPT');
 assert.equal(validateR2(r.probe,r.source_commit,r.run_id).status,'ORIGINAL_PROCESS_PASS');
 for(const k of ['container_start_attempted','destroy_acknowledged','container_inspect_null'])assert.equal(r[k],true,k);
 for(const k of ['internet_enabled_config','provider_requests_measured','inference_authorized'])assert.equal(r[k],false,k);
}
async function unused(){
 const r=await query('SELECT probe_id,run_id,status,receipt_json FROM buffalo_stage3b8r1_receipts WHERE probe_id=?',[R2_ID]);
 assert.equal(r.length,1);checkR2Row(r[0]);
 const n=await query('SELECT COUNT(*) AS n FROM buffalo_stage3b8r1_receipts WHERE probe_id=? OR status=?',[ID,'CLAIMED']);
 assert.equal(n[0].n,0,'PRIVATE_R_ALREADY_CLAIMED');
}
export function configurations({router,bridge,operator,ref,source,task,model,expires}){
 assert.match(source,/^[a-f0-9]{40}$/);assert.match(ref,new RegExp('^registry\\.cloudflare\\.com/'+ACCOUNT+'/buffalo-merlin-private-origin@sha256:[a-f0-9]{64}$'));
 assert.match(task,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
 assert.equal(createHash('sha256').update(model).digest('hex'),MODEL);
 assert(Buffer.byteLength(model,'utf8')<=5120,'PRIVATE_R_MODEL_VAR_TOO_LARGE');
 const disabled={router:structuredClone(router),bridge:structuredClone(bridge),operator:structuredClone(operator)};
 for(const [k,c] of Object.entries(disabled)){
  assert.equal(c.name,names[k]);assert.equal(c.workers_dev,false);assert.equal(c.preview_urls,false);assert.deepEqual(c.triggers.crons,[]);
  assert.equal(c.vars.MERLIN_GRANT,'null');assert(!c.routes&&!c.ai);
 }
 disabled.router.containers[0].images.base.image=ref;
 const g={phase:'R',task_id:task,project_id:'arena-igc',model_sha256:MODEL,source_commit:source,image_digest:ref.split('@')[1],expires};
 const armed=structuredClone(disabled);
 for(const c of Object.values(armed))c.vars.MERLIN_GRANT=JSON.stringify(g);
 armed.operator.vars.MERLIN_SD_JSON=model;armed.operator.triggers.crons=['* * * * *'];
 return {disabled,armed,g};
}
function generate(expires,task){
 const e=process.env;
 const model=readFileSync('infra/buffalo-origin/probe-initial-model.json','utf8').replace(/\n$/,'');
 const result=configurations({router:JSON.parse(readFileSync(folder+'wrangler.router.template.json')),bridge:JSON.parse(readFileSync(folder+'wrangler.bridge.jsonc')),operator:JSON.parse(readFileSync(folder+'wrangler.r-operator.template.json')),ref:e.MERLIN_REGISTRY_REF,source:e.GITHUB_SHA,task,model,expires});
 for(const [mode,configs] of [['disabled',result.disabled],['armed',result.armed]])for(const [kind,c] of Object.entries(configs))writeFileSync(folder+'wrangler.r-'+kind+'-'+mode+'.json',JSON.stringify(c,null,2));
 save('grant',result.g);return result.g;
}
async function main(){
 assert.equal(process.env.CLOUDFLARE_ACCOUNT_ID,ACCOUNT);assert(process.env.CLOUDFLARE_API_TOKEN);
 const phase=process.argv[2];
 if(phase==='preflight'){await baseline(false);await unused();save('preflight',{status:'UNUSED_AND_ZERO_ACTIVE'});}
 else if(phase==='configs'){generate(0,randomUUID());}
 else if(phase==='arm'){await baseline(true);await unused();const g=JSON.parse(readFileSync(out+'/grant.json'));generate(Date.parse(armExpiry()),g.task_id);}
 else if(phase==='disabled-check'||phase==='cleanup'){
  const limit=Date.now()+(phase==='cleanup'?CLEANUP_WAIT_MS:120000);
  for(;;){try{await baseline(true);save(phase,{status:'ZERO_ACTIVE_AND_DISABLED'});break}catch(e){if(Date.now()>=limit)throw e;await pause(5000)}}
 }else if(phase==='observe'){
  const g=JSON.parse(readFileSync(out+'/grant.json'));
  const deadline=g.expires+240000;
  while(Date.now()<deadline){
   const rows=await query('SELECT run_id,status,receipt_json FROM buffalo_stage3b8r1_receipts WHERE probe_id=?',[ID]);
   if(rows.length===1&&rows[0].status!=='CLAIMED'){
    const row=rows[0],r=JSON.parse(row.receipt_json);assert.equal(row.run_id,g.task_id);assert.equal(r.probe_id,ID);assert.equal(r.run_id,g.task_id);assert.equal(r.source_commit,g.source_commit);assert.equal(r.image_digest,g.image_digest);assert.equal(r.status,row.status);
    assert(TERMINALS.has(r.status));assert.equal(r.inference_authorized,false);assert.equal(r.egress_independently_measured,false);
    save('remote-receipt',r);
    if(r.status===PASS)checkRemotePass(r.task,g);
    console.log('PRIVATE_MERLIN_R_MEASURED_OUTCOME '+r.status);
    if(r.status!==PASS)throw Error('PRIVATE_R_DID_NOT_PASS');
    return;
   }
   await pause(10000);
  }
  throw Error('PRIVATE_R_NO_TERMINAL_RECEIPT');
 }else throw Error('UNKNOWN_PHASE');
}
if(process.argv[1]?.endsWith('/manual-r.mjs'))main().catch(e=>{console.error(e.message);process.exitCode=1});
