// Reuse the existing private deployment credentials and native AI binding.
// Separate project/grant for each case gives a hard 8/case, 64/matrix ceiling.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {api,query} from '../private-merlin/manual-r.mjs';
import {CLEANUP_WAIT_MS} from '../buffalo-r1/timing.mjs';
import {CASES,LIMIT,PREFIX,probeId,projectId,validGrant} from './remote-ltm-cases.mjs';
import {PASS,validReceipts} from './remote-ltm-operator.mjs';
const ACCOUNT='e0cb52526a69c0f48f001901a5b9a640';
export const APP='buffalo-full-ltm-diag-private',OP='buffalo-full-ltm-diag-operator';
const folder='infra/full-runtime/',out=process.env.RUNNER_TEMP+'/buffalo-full-ltm-diag';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const save=(name,x)=>{mkdirSync(out,{recursive:true});writeFileSync(out+'/'+name+'.json',JSON.stringify(x,null,2)+'\n')};
const load=name=>JSON.parse(readFileSync(out+'/'+name+'.json'));
export function configs(runtime,operator,ref,source,name,run_id,expires){
 assert.match(ref,new RegExp('^registry\\.cloudflare\\.com/'+ACCOUNT+'/'+APP+'@sha256:[a-f0-9]{64}$'));
 assert(CASES.includes(name));
 const disabled={runtime:structuredClone(runtime),operator:structuredClone(operator)};
 assert.equal(disabled.runtime.name,'buffalo-full-private');assert.equal(disabled.operator.name,'buffalo-full-edit-operator');
 for(const c of Object.values(disabled)){assert.equal(c.workers_dev,false);assert.equal(c.preview_urls,false);assert.deepEqual(c.triggers.crons,[]);assert(!c.routes&&!c.ai)}
 assert.equal(disabled.runtime.vars.RUNTIME_ENABLED,'false');assert.equal(disabled.runtime.vars.ENGINE_INFERENCE_ENABLED,'false');
 disabled.runtime.name=APP;disabled.runtime.containers[0].name=APP;disabled.runtime.containers[0].images.base.image=ref;
 disabled.operator.name=OP;disabled.operator.main='remote-ltm-operator.mjs';disabled.operator.services[0].service=APP;
 disabled.operator.vars={FULL_NATIVE_LTM_GRANT:'null'};
 const armed=structuredClone(disabled);
 const g={case_name:name,project:projectId(name),max_calls:LIMIT,source_commit:source,image_digest:ref.split('@')[1],run_id,expires};
 Object.assign(armed.runtime.vars,{RUNTIME_ENABLED:'true',ENGINE_INFERENCE_ENABLED:'true',AI_PROJECT:g.project,AI_MAX_CALLS:String(LIMIT),AI_EXPIRES_AT:new Date(expires).toISOString()});
 armed.runtime.ai={binding:'AI'};armed.operator.vars.FULL_NATIVE_LTM_GRANT=JSON.stringify(g);armed.operator.triggers.crons=['* * * * *'];
 return{disabled,armed,g};
}
function generate(name,expires,id){
 const r=load('registry');assert.equal(r.source_commit,process.env.GITHUB_SHA);
 const result=configs(JSON.parse(readFileSync(folder+'wrangler.template.json')),JSON.parse(readFileSync(folder+'wrangler.edit-operator.template.json')),r.ref,r.source_commit,name,id,expires);
 for(const [mode,cs] of Object.entries({disabled:result.disabled,armed:result.armed}))for(const [kind,c] of Object.entries(cs))
  writeFileSync(folder+'wrangler.ltm-matrix-'+kind+'-'+mode+'.json',JSON.stringify(c,null,2));
 save('grant',result.g);return result.g;
}
async function unused(name=null){
 const n=await query('SELECT COUNT(*) AS n FROM buffalo_stage3b8r1_receipts WHERE '+(name?'probe_id=?':'probe_id LIKE ?')+' OR status=?',[name?probeId(name):PREFIX+'%','CLAIMED']);
 assert.equal(n[0].n,0,'MATRIX_ALREADY_CLAIMED_OR_OTHER_ACTIVE');
}
async function zeroContainers(){
 const apps=await api('/containers/applications');assert.equal((await api('/containers/usage')).usage?.instances,0);
 for(const a of apps){assert.equal(a.health?.instances?.active,0);assert.equal(a.health?.instances?.starting,0);assert.deepEqual(await api('/containers/applications/'+a.id+'/instances-v2?state=active&per_page=100'),[])}
 return apps;
}
async function privateCheck(name,armed,hasSecret=armed){
 const [sub,schedules,settings,secrets]=await Promise.all(['subdomain','schedules','settings','secrets'].map(k=>api('/workers/scripts/'+name+'/'+k)));
 assert.equal(sub.enabled,false);assert.equal(sub.previews_enabled,false);
 const bindings=settings.bindings,value=k=>bindings.find(b=>b.name===k)?.text;
 if(name===APP){
  assert.equal(value('RUNTIME_ENABLED'),String(armed));assert.equal(value('ENGINE_INFERENCE_ENABLED'),String(armed));
  assert.equal(bindings.some(b=>b.name==='AI'),armed);
  if(armed){const g=load('grant');assert.equal(value('AI_PROJECT'),g.project);assert.equal(value('AI_MAX_CALLS'),String(LIMIT));assert.equal(value('AI_EXPIRES_AT'),new Date(g.expires).toISOString())}
  else for(const k of ['AI_PROJECT','AI_MAX_CALLS','AI_EXPIRES_AT'])assert(!bindings.some(b=>b.name===k));
 }else assert.equal(value('FULL_NATIVE_LTM_GRANT'),armed?JSON.stringify(load('grant')):'null');
 assert.equal(secrets.length,hasSecret?1:0);if(hasSecret)assert.equal(secrets[0].name,'APP_AUTH_KEY');
 assert.equal(schedules.schedules.length,armed&&name===OP?1:0);
}
async function cleanCheck(hasSecret=false){
 await zeroContainers();const workers=await api('/workers/scripts');
 for(const n of [APP,OP])if(workers.some(w=>w.id===n||w.name===n))await privateCheck(n,false,hasSecret);
}
async function waitClean(hasSecret,ms){
 const deadline=Date.now()+ms;
 for(;;){try{await cleanCheck(hasSecret);return}catch(e){if(Date.now()>=deadline)throw e;await sleep(5000)}}
}
const key=l=>l.cycle.map((_,i)=>l.cycle.slice(i).concat(l.cycle.slice(0,i)).join('\u0000')).sort()[0];
function comparison(a,b){
 if(!a?.evidence||!b?.evidence)return null;
 const x=a.evidence.loops,y=new Map(b.evidence.loops.map(l=>[key(l),l]));
 const same=x.length===y.size&&x.every(l=>y.has(key(l)));
 const reactivated=x.filter(l=>l.signed?.every(v=>v===0)&&y.get(key(l))?.signed?.some(v=>Number.isFinite(v)&&v!==0))
  .map(l=>({cycle:l.cycle,controlMax:0,perturbedMax:Math.max(...y.get(key(l)).signed.filter(Number.isFinite).map(Math.abs))}));
 return {sameStructuralCycles:same,reactivated};
}
async function main(){
 assert.equal(process.env.CLOUDFLARE_ACCOUNT_ID,ACCOUNT);assert(process.env.CLOUDFLARE_API_TOKEN);
 const [phase,name]=process.argv.slice(2);
 if(phase==='preflight'){
  const apps=await zeroContainers();await unused();const workers=await api('/workers/scripts');
  assert(!workers.some(w=>[APP,OP].includes(w.id??w.name))&&!apps.some(a=>a.name===APP),'MATRIX_RESOURCES_ALREADY_EXIST');
  const old=await query('SELECT probe_id,status,receipt_json FROM buffalo_stage3b8r1_receipts WHERE probe_id LIKE ?',['one-shot-buffalo-native-ltm-v1-%']);
  assert.equal(old.length,8);
  for(const row of old){
    const x=JSON.parse(row.receipt_json);
    const rejected=CASES.includes(x.case_name);
    assert.equal(x.approval.source_commit,'1438f9ef33f7a7cf481610bd8d4721b51552ffe3');
    assert.equal(x.container_stopped,true);
    assert.equal(row.status,rejected?'RUNTIME_FAILURE':PASS);
    if(rejected)assert.equal(x.failure_code,'INVALID_NATIVE_NARRATIVE');
  }
  save('preflight',{status:'UNUSED_AND_ZERO_ACTIVE',historical:old.map(x=>({id:x.probe_id,status:x.status}))});
 }else if(phase==='configs')generate(CASES[0],0,randomUUID());
 else if(phase==='arm'){
  assert(CASES.includes(name));await unused(name);await waitClean(true,120000);
  const g=generate(name,Date.now()+20*60000,randomUUID());assert(validGrant(g));
 }else if(phase==='check-runtime-armed'){
  const g=load('grant');assert(validGrant(g));await unused(g.case_name);await zeroContainers();await privateCheck(APP,true);await privateCheck(OP,false,true);
 }else if(phase==='observe'){
  const g=load('grant');
  while(Date.now()<g.expires+120000){
   const rows=await query('SELECT run_id,status,receipt_json FROM buffalo_stage3b8r1_receipts WHERE probe_id=?',[probeId(g.case_name)]);
   if(rows.length===1&&rows[0].status!=='CLAIMED'){
    const x=JSON.parse(rows[0].receipt_json);assert.equal(x.probe_id,probeId(g.case_name));assert.equal(x.run_id,g.run_id);
    assert.equal(rows[0].run_id,g.run_id);assert.equal(x.status,rows[0].status);assert.deepEqual(x.approval,g);
    save(g.case_name,x);console.log('FULL_NATIVE_LTM_MEASURED '+g.case_name+' '+x.status);
    // Stop uncertainty is an infrastructure failure: do not arm further cases.
    assert(x.container_stopped||!x.simulation_id,'STOP_UNCONFIRMED');
    return;
   }
   await sleep(10000);
  }
  throw Error('MATRIX_NO_TERMINAL_RECEIPT_NO_RETRY');
 }else if(phase==='between')await waitClean(true,120000);
 else if(phase==='remove-secrets'){
  const workers=await api('/workers/scripts');for(const n of [OP,APP]){
   if(!workers.some(w=>w.id===n||w.name===n))continue;
   const secrets=await api('/workers/scripts/'+n+'/secrets');
   if(secrets.some(s=>s.name==='APP_AUTH_KEY'))await api('/workers/scripts/'+n+'/secrets/APP_AUTH_KEY','DELETE');
  }
 }else if(phase==='cleanup'){
  await waitClean(false,CLEANUP_WAIT_MS);save('cleanup',{status:'ZERO_ACTIVE_AND_DISABLED_NO_AI_OR_SECRETS'});
 }else if(phase==='summary'){
  const cases=CASES.map(name=>{try{return load(name)}catch{return {case_name:name,status:'NOT_OBSERVED'}}});
  const pair=null;
  const report={mode:'native_workers_ai_binding',cases:cases.map(c=>({name:c.case_name,status:c.status,
    failure_stage:c.failure_stage,failure_code:c.failure_code,calls:c.inferences?.length??0,
    checked:c.assessment?.dominance?.checkedSamples,container_stopped:c.container_stopped,
    narrative_attempts:c.narrative_attempts?.map(({status,call_id,raw_sha256,error,diagnostic})=>({
      status,call_id,raw_sha256,error,diagnostic}))})),
    pair,prose:'not_semantically_verified',total_calls:cases.reduce((s,c)=>s+(c.inferences?.length??0),0)};
  report.complete=cases.every(c=>c.status===PASS&&validReceipts(c.inferences)&&c.container_stopped);
  report.diagnostic_complete=cases.every(c=>c.container_stopped&&c.narrative_attempts?.length&&c.narrative_attempts.every(a=>a.status==='ACCEPTED'||(a.status==='REJECTED'&&typeof a.raw==='string'&&a.diagnostic?.valid===false)));
  save('summary',report);console.log('FULL_REMOTE_LTM_DIAGNOSTIC '+JSON.stringify(report));
  assert(report.diagnostic_complete,'MISSING_DIAGNOSTIC_EVIDENCE');assert(report.complete,'DIAGNOSTIC_CASES_REJECTED');
 }else throw Error('UNKNOWN_PHASE');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1});
