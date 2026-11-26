import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CASES,LIMIT,fixture,projectId,probeId,validGrant} from './remote-ltm-cases.mjs';
import {configs,APP,OP} from './manual-native-ltm.mjs';
import {runNativeLtm,validReceipts} from './remote-ltm-operator.mjs';
import {GEMMA} from '../private-merlin/gemma-response.mjs';

const grant=name=>({case_name:name,project:projectId(name),max_calls:LIMIT,source_commit:'a'.repeat(40),
 image_digest:'sha256:'+'b'.repeat(64),run_id:'58532b8a-b25e-4b67-a90b-10db57da263b',expires:Date.now()+600000});
test('eight independent private projects, identical clocks and sole Mai-Bab parameter change',()=>{
 assert.equal(CASES.length,3);assert.equal(new Set(CASES.map(projectId)).size,3);assert.equal(new Set(CASES.map(probeId)).size,3);
 assert.deepEqual(CASES.map(n=>fixture(n).expectedSamples),[401,241,17]);
 const a=fixture('maibab-control').model,b=fixture('maibab-perturbed').model;
 assert.equal(b.variables.find(v=>v.name==='Normal Food Per Deer').equation,'100');
 b.variables.find(v=>v.name==='Normal Food Per Deer').equation='1';assert.deepEqual(a,b);
 const rt=JSON.parse(readFileSync(new URL('./wrangler.template.json',import.meta.url)));
 const op=JSON.parse(readFileSync(new URL('./wrangler.edit-operator.template.json',import.meta.url)));
 for(const name of CASES){
  const g=grant(name);assert(validGrant(g));assert(!validGrant({...g,case_name:'maibab-control',project:projectId('maibab-control')}));assert(!validGrant({...g,max_calls:9}));assert(!validGrant({...g,project:'other'}));
  const {disabled,armed,g:actual}=configs(rt,op,'registry.cloudflare.com/e0cb52526a69c0f48f001901a5b9a640/'+APP+'@'+g.image_digest,g.source_commit,name,g.run_id,g.expires);
  assert.deepEqual(actual,g);assert.equal(disabled.runtime.name,APP);assert.equal(disabled.operator.name,OP);
  assert(!disabled.runtime.ai);assert.equal(disabled.runtime.vars.RUNTIME_ENABLED,'false');assert.equal(disabled.operator.vars.FULL_NATIVE_LTM_GRANT,'null');
  assert.deepEqual(disabled.operator.triggers.crons,[]);assert.equal(armed.runtime.vars.AI_MAX_CALLS,'8');assert.equal(armed.runtime.vars.AI_PROJECT,g.project);
  assert.deepEqual(armed.runtime.ai,{binding:'AI'});assert.equal(armed.operator.services[0].service,APP);
  for(const c of [...Object.values(disabled),...Object.values(armed)]){assert.equal(c.workers_dev,false);assert.equal(c.preview_urls,false);assert(!c.routes)}
 }
});
test('expired grant and existing atomic claim cannot invoke runtime',async()=>{
 let claims=0,fetches=0;
 const g=grant(CASES[0]),env={APP_AUTH_KEY:'fixture',FULL_NATIVE_LTM_GRANT:JSON.stringify(g),
 DB:{prepare(){return{bind(){return{run:async()=>{claims++;return{meta:{changes:0}}}}}}}},FULL:{fetch(){fetches++;throw Error('unexpected')}}};
 await runNativeLtm({...env,FULL_NATIVE_LTM_GRANT:JSON.stringify({...g,expires:0})});assert.equal(claims,0);
 await runNativeLtm(env);assert.equal(claims,1);assert.equal(fetches,0);
});
test('terminal compute failure is not retried and stops the container',async()=>{
 const g=grant(CASES[0]);let row=null,computes=0,stops=0;
 const env={APP_AUTH_KEY:'fixture',FULL_NATIVE_LTM_GRANT:JSON.stringify(g),
 DB:{prepare(sql){return{bind(...args){return{run:async()=>{
  if(sql.startsWith('INSERT')){if(row)return{meta:{changes:0}};row={status:args[2]};return{meta:{changes:1}}}
  row=JSON.parse(args[1]);return{meta:{changes:1}};
 }}}}}},FULL:{async fetch(r){
  const p=new URL(r.url).pathname;assert.equal(r.headers.get('x-buffalo-project'),g.project);
  if(p==='/project/inference/1')return new Response(null,{status:404});
  if(p==='/project/model')return new Response(null,{status:201,headers:{etag:'"1"','x-buffalo-model-sha256':'a'.repeat(64)}});
  assert(p.endsWith('/ltm'));computes++;return new Response(null,{status:422});
 },async stop(p){assert.equal(p,g.project);stops++;return{container_stopped:true}}}};
 await runNativeLtm(env);await runNativeLtm(env);
 assert.equal(computes,1);assert.equal(stops,1);assert.equal(row.status,'RUNTIME_FAILURE');assert.equal(row.failure_stage,'SIMULATION');assert.equal(row.container_stopped,true);
});
test('real receipt shape requires original schema engine, tool call, terminal stop and bounded counts',()=>{
 const r={status:'OK',response_model:GEMMA,usage:{prompt_tokens:50,completion_tokens:20},neurons:1};
 const rows=[{...r,attempt:1,finish_reason:'tool_calls'},{...r,attempt:2,finish_reason:'stop',channel:'original-engine',response_format:'json_schema',predicates:{schema_valid:true}},{...r,attempt:3,finish_reason:'stop'}];
 assert(validReceipts(rows));assert(!validReceipts(rows.slice(0,1)));assert(!validReceipts(rows.map(x=>({...x,status:'REJECTED'}))));
 assert(!validReceipts(rows.map(x=>({...x,neurons:null}))));
});
