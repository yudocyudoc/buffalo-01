import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {api,query,baseline} from '../private-merlin/manual-r.mjs';
import {armExpiry,CLEANUP_WAIT_MS} from '../buffalo-r1/timing.mjs';
import {ID,PROJECT,LIMIT,PASS,validGrant} from './remote-edit.mjs';
import {assertDemand} from './session-client.mjs';
const ACCOUNT='e0cb52526a69c0f48f001901a5b9a640',APP='buffalo-full-private',OP='buffalo-full-edit-operator';
const folder='infra/full-runtime/',out=process.env.RUNNER_TEMP+'/buffalo-full-edit';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const save=(name,x)=>{mkdirSync(out,{recursive:true});writeFileSync(out+'/'+name+'.json',JSON.stringify(x,null,2)+'\n')};
export function configs(runtime,operator,ref,source,run_id,expires){
 assert.match(ref,new RegExp('^registry\\.cloudflare\\.com/'+ACCOUNT+'/buffalo-full-private@sha256:[a-f0-9]{64}$'));
 const disabled={runtime:structuredClone(runtime),operator:structuredClone(operator)};
 assert.equal(disabled.runtime.name,APP);assert.equal(disabled.operator.name,OP);
 for(const c of Object.values(disabled)){assert.equal(c.workers_dev,false);assert.equal(c.preview_urls,false);assert.deepEqual(c.triggers.crons,[]);assert(!c.routes&&!c.ai)}
 assert.equal(disabled.runtime.vars.RUNTIME_ENABLED,'false');assert.equal(disabled.operator.vars.FULL_EDIT_GRANT,'null');
 disabled.runtime.containers[0].images.base.image=ref;
 const armed=structuredClone(disabled);
 const g={project:PROJECT,max_calls:LIMIT,source_commit:source,image_digest:ref.split('@')[1],run_id,expires};
 Object.assign(armed.runtime.vars,{RUNTIME_ENABLED:'true',AI_PROJECT:PROJECT,AI_MAX_CALLS:String(LIMIT),AI_EXPIRES_AT:new Date(expires).toISOString()});
 armed.runtime.ai={binding:'AI'};armed.operator.vars.FULL_EDIT_GRANT=JSON.stringify(g);armed.operator.triggers.crons=['* * * * *'];
 return{disabled,armed,g};
}
async function unused(){
 const n=await query('SELECT COUNT(*) AS n FROM buffalo_stage3b8r1_receipts WHERE probe_id=? OR status=?',[ID,'CLAIMED']);
 assert.equal(n[0].n,0,'FULL_EDIT_ALREADY_CLAIMED');
}
function generate(expires,id){
 const r=JSON.parse(readFileSync(out+'/registry.json'));
 assert.equal(r.source_commit,process.env.GITHUB_SHA);
 const result=configs(JSON.parse(readFileSync(folder+'wrangler.template.json')),JSON.parse(readFileSync(folder+'wrangler.edit-operator.template.json')),r.ref,r.source_commit,id,expires);
 for(const [mode,cs] of Object.entries({disabled:result.disabled,armed:result.armed}))for(const [kind,c] of Object.entries(cs))writeFileSync(folder+'wrangler.edit-'+kind+'-'+mode+'.json',JSON.stringify(c,null,2));
 save('grant',result.g);return result.g;
}
async function privateCheck(name,armed){
 const [sub,schedules,settings,secrets]=await Promise.all(['subdomain','schedules','settings','secrets'].map(k=>api('/workers/scripts/'+name+'/'+k)));
 assert.equal(sub.enabled,false);assert.equal(sub.previews_enabled,false);
 const bindings=settings.bindings;
 assert.equal(bindings.find(b=>b.name===(name===APP?'RUNTIME_ENABLED':'FULL_EDIT_GRANT'))?.text,armed?(name===APP?'true':JSON.stringify(JSON.parse(readFileSync(out+'/grant.json')))):(name===APP?'false':'null'));
 if(name===APP){
  assert.equal(bindings.some(b=>b.name==='AI'),armed);
  if(armed){
   const g=JSON.parse(readFileSync(out+'/grant.json'));
   for(const [k,v] of Object.entries({AI_PROJECT:PROJECT,AI_MAX_CALLS:String(LIMIT),AI_EXPIRES_AT:new Date(g.expires).toISOString()}))assert.equal(bindings.find(b=>b.name===k)?.text,v);
  }else for(const k of ['AI_PROJECT','AI_MAX_CALLS','AI_EXPIRES_AT'])assert(!bindings.some(b=>b.name===k));
 }
 assert.equal(secrets.length,armed?1:0);if(armed)assert.equal(secrets[0].name,'APP_AUTH_KEY');
 assert.equal(schedules.schedules.length,armed&&name===OP?1:0);
}
async function cleanCheck(){
 const apps=await api('/containers/applications');
 assert.equal((await api('/containers/usage')).usage?.instances,0);
 for(const a of apps){assert.equal(a.health?.instances?.active,0);assert.equal(a.health?.instances?.starting,0);assert.deepEqual(await api('/containers/applications/'+a.id+'/instances-v2?state=active&per_page=100'),[])}
 const workers=await api('/workers/scripts');
 for(const n of [APP,OP])if(workers.some(w=>w.id===n||w.name===n))await privateCheck(n,false);
}
async function main(){
 assert.equal(process.env.CLOUDFLARE_ACCOUNT_ID,ACCOUNT);assert(process.env.CLOUDFLARE_API_TOKEN);
 const phase=process.argv[2];
 if(phase==='preflight'){await baseline(true);await unused();const workers=await api('/workers/scripts');assert(!workers.some(w=>[APP,OP].includes(w.id??w.name)),'FULL_EDIT_WORKERS_EXIST');}
 else if(phase==='configs')generate(0,randomUUID());
 else if(phase==='arm'){await unused();const g=JSON.parse(readFileSync(out+'/grant.json'));const next=generate(Date.parse(armExpiry()),g.run_id);assert(validGrant(next));}
 else if(phase==='remove-secrets'){
  const workers=await api('/workers/scripts');
  for(const n of [OP,APP]){
   if(!workers.some(w=>w.id===n||w.name===n))continue;
   const secrets=await api('/workers/scripts/'+n+'/secrets');
   if(secrets.some(s=>s.name==='APP_AUTH_KEY'))await api('/workers/scripts/'+n+'/secrets/APP_AUTH_KEY','DELETE');
  }
 }else if(phase==='cleanup'){
  const deadline=Date.now()+CLEANUP_WAIT_MS;for(;;){try{await cleanCheck();save('cleanup',{status:'ZERO_ACTIVE_AND_DISABLED_NO_AI_OR_SECRETS'});break}catch(e){if(Date.now()>=deadline)throw e;await sleep(5000)}}
 }else if(phase==='observe'){
  const g=JSON.parse(readFileSync(out+'/grant.json'));await privateCheck(APP,true);await privateCheck(OP,true);
  while(Date.now()<g.expires+240000){
   const rows=await query('SELECT run_id,status,receipt_json FROM buffalo_stage3b8r1_receipts WHERE probe_id=?',[ID]);
   if(rows.length===1&&rows[0].status!=='CLAIMED'){
    const x=JSON.parse(rows[0].receipt_json);assert.equal(x.probe_id,ID);assert.equal(x.run_id,g.run_id);assert.equal(rows[0].run_id,g.run_id);assert.equal(x.status,rows[0].status);assert.deepEqual(x.approval,g);save('remote-receipt',x);
    console.log('FULL_REMOTE_EDIT_MEASURED_OUTCOME '+x.status);
    console.log('FULL_REMOTE_EDIT_INFERENCES '+JSON.stringify(x.inferences));
    assert.equal(x.status,PASS);assertDemand(x.initial_model,'3');assertDemand(x.recovered_model,'5');
    assert(x.container_stopped&&x.stale_write_rejected&&x.reopened_session_id!==x.session.session_id);
    assert(x.inferences.length>=2&&x.inferences.length<=LIMIT&&x.inferences.every(r=>r.status==='OK'));
    return;
   }
   await sleep(10000);
  }throw Error('FULL_EDIT_NO_TERMINAL_RECEIPT_NO_RETRY');
 }else throw Error('UNKNOWN_PHASE');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1});
