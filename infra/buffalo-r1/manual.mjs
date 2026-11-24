import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {ID,MODE,boundedReceipt,validCommit} from './receipt.mjs';
import {EXPIRED,armExpiry,observationDeadline,CLEANUP_WAIT_MS} from './timing.mjs';
const NAME='buffalo-namespace-r1-private-lab',OLD='buffalo-private-origin-lab';
const ACCOUNT='e0cb52526a69c0f48f001901a5b9a640',DB='d1e23807-b076-4c36-8785-7b423fc41614';
const root='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT;
const env=process.env;
const out=env.RUNNER_TEMP+'/buffalo-r1';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const save=(name,x)=>{mkdirSync(out,{recursive:true});writeFileSync(out+'/'+name+'.json',JSON.stringify(x,null,2)+'\n')};
async function api(path,method='GET',body){
 const r=await fetch(root+path,{method,headers:{Authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN,'content-type':'application/json'},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('R1_API_HTTP_'+r.status+' '+path);
 const x=await r.json();assert.equal(x.success,true,path);return x.result;
}
async function query(sql,params=[]){
 const x=await api('/d1/database/'+DB+'/query','POST',{sql,params});
 assert.equal(x?.[0]?.success,true,'D1_QUERY_FAILED');return x[0].results??[];
}
async function oldBaseline(){
 const names=['buffalo-private-origin-router-lab','buffalo-original-ws-bridge-lab'];
 for(const n of names){
  const [sub,sched,sec,settings]=await Promise.all(['subdomain','schedules','secrets','settings'].map(s=>api('/workers/scripts/'+n+'/'+s)));
  assert.equal(sub.enabled,false);assert.equal(sub.previews_enabled,false);
  assert.deepEqual(sched.schedules,[]);assert.equal(sec.length,0);
  const expected=n===names[0]?['BUFFALO_CONTAINER','BUFFALO_ORIGIN_MODE','BUFFALO_ORIGIN_COMMIT_SHA','BUFFALO_ORIGIN_MODEL_SHA256']:['DB'];
  assert.deepEqual(settings.bindings.map(b=>b.name).sort(),expected.sort());
 }
}
async function appsZero(){
 const [apps,usage]=await Promise.all([api('/containers/applications'),api('/containers/usage')]);
 assert(Array.isArray(apps));assert.equal(apps.filter(a=>a.name===OLD).length,1);
 assert(apps.every(a=>a.name===OLD||a.name===NAME),'UNEXPECTED_APPLICATION');
 assert(apps.filter(a=>a.name===NAME).length<=1);
 for(const a of apps){
  assert.equal(a.health?.instances?.active,0);assert.equal(a.health?.instances?.starting,0);
 }
 assert.equal(usage.usage?.instances,0);
 return apps.find(a=>a.name===NAME);
}
export async function requireUnusedProbe(read){
 const tables=await read("SELECT name FROM sqlite_master WHERE type='table' AND name='buffalo_stage3b8r1_receipts'");
 assert.deepEqual(tables.map(t=>t.name),['buffalo_stage3b8r1_receipts'],'R1_SCHEMA_MUST_BE_PREAPPLIED_SEPARATELY');
 const rows=await read('SELECT COUNT(*) AS n FROM buffalo_stage3b8r1_receipts WHERE probe_id=? OR status=?',[ID,'CLAIMED']);
 assert.equal(rows.length,1);assert.equal(rows[0].n,0,'R1_PRIOR_EVIDENCE_NO_REPLAY');
}
async function requireDisabledApp(app){
 assert(app,'R1_APPLICATION_NOT_FOUND');
 const [sub,schedules,secrets,settings]=await Promise.all(['subdomain','schedules','secrets','settings'].map(s=>api('/workers/scripts/'+NAME+'/'+s)));
 assert.equal(sub.enabled,false);assert.equal(sub.previews_enabled,false);assert.deepEqual(schedules.schedules,[]);assert.equal(secrets.length,0);
 assert.deepEqual(settings.bindings.map(b=>b.name).sort(),['DB','R1_CONTAINER','R1_EXPECTED_SHA','R1_EXPIRES_AT','R1_IMAGE_DIGEST','R1_MODE'].sort());
 assert.equal(settings.bindings.find(b=>b.name==='R1_MODE')?.text,'DISABLED');
 const active=await api('/containers/applications/'+app.id+'/instances-v2?state=active&per_page=100');
 assert.deepEqual(active,[]);
}
export function configs(template,commit,ref,expires=EXPIRED){
 assert(validCommit(commit));assert.match(ref,new RegExp('^registry\\.cloudflare\\.com/'+ACCOUNT+'/buffalo-namespace-r1@sha256:[a-f0-9]{64}$'));
 assert(Number.isFinite(Date.parse(expires)));
 assert.equal(template.name,NAME);assert.equal(template.vars.R1_MODE,'DISABLED');
 assert.equal(template.workers_dev,false);assert.equal(template.preview_urls,false);
 assert.deepEqual(template.triggers.crons,[]);assert(!template.routes&&!template.services&&!template.ai);
 const disabled=structuredClone(template);
 disabled.containers[0].images.base.image=ref;
 disabled.vars={R1_MODE:'DISABLED',R1_EXPECTED_SHA:commit,R1_IMAGE_DIGEST:ref.split('@')[1],R1_EXPIRES_AT:EXPIRED};
 const armed=structuredClone(disabled);armed.vars.R1_MODE=MODE;armed.vars.R1_EXPIRES_AT=expires;armed.triggers.crons=['* * * * *'];
 return {disabled,armed};
}
async function main(){
 const phase=process.argv[2];
 assert.equal(env.CLOUDFLARE_ACCOUNT_ID,ACCOUNT);assert(env.CLOUDFLARE_API_TOKEN);
 if(phase==='preflight'){
  await oldBaseline();const app=await appsZero();
  const workers=await api('/workers/scripts');
  assert(Array.isArray(workers));
  assert.equal(workers.some(w=>w.id===NAME||w.name===NAME),Boolean(app),'R1_PARTIAL_RESOURCES');
  if(app)await requireDisabledApp(app);
  await requireUnusedProbe(query);
  save('preflight',{status:'R1_PROBE_UNUSED',probe_id:ID,schema_preapplied:true,existing_app_disabled:Boolean(app)});
 }else if(phase==='configs'||phase==='arm'){
  const template=JSON.parse(readFileSync('infra/buffalo-r1/wrangler.template.json','utf8'));
  if(phase==='arm')await requireUnusedProbe(query);
  const expires=phase==='arm'?armExpiry():EXPIRED;
  const {disabled,armed}=configs(template,env.GITHUB_SHA,env.R1_REGISTRY_REF,expires);
  if(phase==='configs')writeFileSync('infra/buffalo-r1/wrangler.r1-disabled.json',JSON.stringify(disabled,null,2));
  writeFileSync('infra/buffalo-r1/wrangler.r1-armed.json',JSON.stringify(armed,null,2));
  if(phase==='arm')save('arm-window',{expires_at:expires,observation_deadline:new Date(observationDeadline(expires)).toISOString()});
 }else if(phase==='disabled-check'||phase==='cleanup'){
  const deadline=Date.now()+(phase==='cleanup'?CLEANUP_WAIT_MS:120000);
  for(;;){
   try{
    await oldBaseline();const app=await appsZero();await requireDisabledApp(app);
    save(phase,{status:'ZERO_ACTIVE_AND_DISABLED',application_id:app.id});break;
   }catch(e){if(Date.now()>=deadline)throw e;await pause(5000)}
  }
 }else if(phase==='observe'){
  const armed=JSON.parse(readFileSync('infra/buffalo-r1/wrangler.r1-armed.json','utf8'));
  const deadline=observationDeadline(armed.vars.R1_EXPIRES_AT);
  while(Date.now()<deadline){
   const rows=await query('SELECT status,receipt_json FROM buffalo_stage3b8r1_receipts WHERE probe_id=?',[ID]);
   if(rows.length===1&&rows[0].status!=='CLAIMED'){
    const r=JSON.parse(rows[0].receipt_json);assert.equal(r.status,rows[0].status);
    assert.equal(r.source_commit,env.GITHUB_SHA);assert.equal(r.image_digest,env.R1_REGISTRY_REF.split('@')[1]);
    assert.equal(r.probe_id,ID);save('remote-receipt',r);
    if(!['R1_REMOTE_MINIMAL_PASS','R1_REMOTE_MINIMAL_BLOCKED'].includes(r.status))throw Error('R1_RUNTIME_OR_CLEANUP_FAILURE');
    const p=boundedReceipt(r.probe,r.source_commit,r.run_id);
    assert.equal(r.status,p.status==='MINIMAL_BWRAP_PASS'?'R1_REMOTE_MINIMAL_PASS':'R1_REMOTE_MINIMAL_BLOCKED');
    assert.equal(r.destroy_acknowledged,true);assert.equal(r.container_inspect_null,true);
    assert.equal(r.internet_enabled_config,false);assert.equal(r.agent_execution_authorized,false);
    console.log('R1_MEASURED_OUTCOME '+r.status+' '+p.reason_code);return;
   }
   await pause(10000);
  }
  throw Error('R1_NO_TERMINAL_RECEIPT');
 }else throw Error('R1_UNKNOWN_PHASE');
}
if(process.argv[1]?.endsWith('/manual.mjs'))main().catch(e=>{console.error(e.message);process.exitCode=1});
