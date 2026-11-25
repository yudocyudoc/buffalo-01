import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ID,PROJECT,LIMIT,PASS,validGrant,validInference,runQualitative} from './remote-qualitative.mjs';
import {configs,APP,OP} from './manual-qualitative.mjs';
import {GEMMA} from '../private-merlin/gemma-response.mjs';
import {CASE_ID,REQUEST,EXPECTED,SCHEMA_SHA256} from './qualitative-smoke-case.mjs';

const g={project:PROJECT,max_calls:1,source_commit:'a'.repeat(40),image_digest:'sha256:'+'b'.repeat(64),run_id:'58532b8a-b25e-4b67-a90b-10db57da263b',expires:Date.now()+600000};
const receipt={channel:'original-engine',status:'OK',response_format:'json_schema',response_model:GEMMA,
 finish_reason:'stop',invocation_id:g.run_id,request_sha256:'c'.repeat(64),schema_sha256:SCHEMA_SHA256,
 predicates:{schema_valid:true,total_tokens_valid:true,json_valid:true},failed_predicates:[],
 usage:{prompt_tokens:500,completion_tokens:100,total_tokens:null},max_completion_tokens:8192,neurons:1.5};
const model={variables:[...new Set(EXPECTED.flatMap(e=>[e.from,e.to]))].map(name=>({name,type:'variable'})),relationships:EXPECTED};
function fixture({failure,stale=false,stopFailure=false}={}){
 let row,calls=0,stops=0,claims=0;
 const db={prepare(sql){return{bind(...a){return{run:async()=>{
  if(sql.startsWith('INSERT')){if(row)return{meta:{changes:0}};claims++;row={status:a[2],receipt:JSON.parse(a[3])};return{meta:{changes:1}}}
  assert.equal(a[2],ID);assert.equal(a[3],g.run_id);assert.equal(a[4],'CLAIMED');assert.equal(row.status,'CLAIMED');
  row={status:a[0],receipt:JSON.parse(a[1])};return{meta:{changes:1}};
 }}}}}};
 const FULL={async fetch(r){
  assert.equal(r.headers.get('x-buffalo-project'),PROJECT);
  assert.equal(r.headers.get('Authentication'),'fixture');
  const p=new URL(r.url).pathname;
  if(p==='/status')return new Response('ok');
  if(p==='/project/inference/1')return calls||stale?Response.json(failure?{...receipt,status:'REJECTED',failed_predicates:['schema_valid']}:receipt):new Response(null,{status:404});
  if(p==='/project/inference/2')return new Response(null,{status:404});
  assert.equal(p,'/api/v1/engines/qualitative/generate');assert.equal(r.method,'POST');
  assert.deepEqual(await r.json(),REQUEST);calls++;
  return Response.json(failure?{success:false}:{success:true,model});
 },async stop(p){assert.equal(p,PROJECT);stops++;if(stopFailure)throw Error('stop failure');return{container_stopped:true}}};
 return{env:{DB:db,FULL,APP_AUTH_KEY:'fixture',FULL_QUALITATIVE_GRANT:JSON.stringify(g)},read:()=>({row,calls,stops,claims})};
}
test('one atomic smoke claim, one original REST request, exact returned model and receipt, confirmed stop',async()=>{
 const f=fixture();await Promise.all([runQualitative(f.env),runQualitative(f.env)]);
 const x=f.read();assert.equal(x.claims,1);assert.equal(x.calls,1);assert.equal(x.stops,1);
 assert.equal(x.row.status,PASS);assert.equal(x.row.receipt.case_id,CASE_ID);assert.deepEqual(x.row.receipt.case_input,REQUEST);assert.deepEqual(x.row.receipt.model,model);assert.deepEqual(x.row.receipt.inference,receipt);
 assert.equal(x.row.receipt.single_reservation,true);assert.equal(x.row.receipt.container_stopped,true);
});
test('failed original engine is terminal, receipt retained, no retry and stop',async()=>{
 const f=fixture({failure:true});await runQualitative(f.env);await runQualitative(f.env);
 const x=f.read();assert.equal(x.calls,1);assert.equal(x.stops,1);assert.equal(x.row.status,'RUNTIME_FAILURE');
 assert.equal(x.row.receipt.failure_code,'ORIGINAL_ENGINE_REJECTED');assert.equal(x.row.receipt.inference.status,'REJECTED');
});
test('invalid grants do not claim; used project does not invoke; stop failure cannot pass',async()=>{
 for(const patch of [{expires:0},{project:'other'},{max_calls:2}]){
  const f=fixture();assert(!validGrant({...g,...patch}));await runQualitative({...f.env,FULL_QUALITATIVE_GRANT:JSON.stringify({...g,...patch})});assert.equal(f.read().claims,0);
 }
 const used=fixture({stale:true});await runQualitative(used.env);assert.equal(used.read().calls,0);assert.equal(used.read().row.receipt.failure_code,'PROJECT_ALREADY_USED');
 const fail=fixture({stopFailure:true});await runQualitative(fail.env);assert.equal(fail.read().row.status,'RUNTIME_FAILURE');assert.equal(fail.read().row.receipt.container_stopped,false);
});
test('receipt must prove real selected model, schema, complete stop and measured usage',()=>{
 assert(validInference(receipt));
 for(const patch of [{schema_sha256:null},{schema_sha256:'f'.repeat(64)},{response_model:'wrong'},{status:'REJECTED'},{neurons:null},{finish_reason:'length'},
  {usage:{prompt_tokens:500,completion_tokens:9000}},{predicates:{...receipt.predicates,schema_valid:false}}])
  assert(!validInference({...receipt,...patch}));
});
test('config isolates private smoke resources and arms exactly one engine reservation',()=>{
 const runtime=JSON.parse(readFileSync(new URL('./wrangler.template.json',import.meta.url)));
 const operator=JSON.parse(readFileSync(new URL('./wrangler.edit-operator.template.json',import.meta.url)));
 const {disabled,armed,g:grant}=configs(runtime,operator,'registry.cloudflare.com/e0cb52526a69c0f48f001901a5b9a640/'+APP+'@'+g.image_digest,g.source_commit,g.run_id,g.expires);
 assert.deepEqual(grant,g);assert.equal(disabled.runtime.name,APP);assert.equal(disabled.operator.name,OP);
 assert.equal(disabled.runtime.vars.ENGINE_INFERENCE_ENABLED,'false');assert(!disabled.runtime.ai);
 assert.equal(disabled.operator.vars.FULL_QUALITATIVE_GRANT,'null');assert.deepEqual(disabled.operator.triggers.crons,[]);
 assert.equal(armed.runtime.vars.ENGINE_INFERENCE_ENABLED,'true');assert.equal(armed.runtime.vars.AI_MAX_CALLS,'1');
 assert.deepEqual(armed.runtime.ai,{binding:'AI'});assert.equal(armed.operator.services[0].service,APP);
 assert.equal(armed.operator.main,'remote-qualitative.mjs');assert.deepEqual(armed.operator.triggers.crons,['* * * * *']);
 assert.equal(runtime.name,'buffalo-full-private');assert.equal(operator.name,'buffalo-full-edit-operator');
 for(const c of [...Object.values(disabled),...Object.values(armed)]){assert.equal(c.workers_dev,false);assert.equal(c.preview_urls,false);assert(!c.routes)}
});
