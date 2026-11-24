import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {completion} from './gateway.mjs';
import {ENDPOINT} from '../private-merlin/protocol.mjs';
import {GEMMA} from '../private-merlin/gemma-response.mjs';
import {rest} from './test-rest.mjs';
import {session} from './test-session.mjs';

const deps=createRequire(join(process.env.FULL_TEST_TOOLS,'entry.cjs'));
const {Miniflare,convertV4MiniflareOptions}=deps('miniflare');
const {build}=deps('esbuild');
// Only swap the platform's TCP-port acquisition for an actual local TCP listener.
const testModule=`import {ProjectRuntime} from './infra/full-runtime/worker.mjs';
export {FullApplication,default} from './infra/full-runtime/worker.mjs';
export class LocalProject extends ProjectRuntime {
  async applicationPort(){return {fetch(r){const u=new URL(r.url);u.host='127.0.0.1:8080';return fetch(new Request(u,r));}};}
}`;
const script=(await build({stdin:{contents:testModule,resolveDir:process.cwd()},bundle:true,write:false,
  format:'esm',target:'es2022',external:['cloudflare:workers']})).outputFiles[0].text;
const disk=await mkdtemp(join(tmpdir(),'buffalo-full-test-'));
const options={...convertV4MiniflareOptions({cf:false,host:'127.0.0.1',port:8793,workers:[
  {name:'client',modules:true,compatibilityDate:'2026-11-19',serviceBindings:{FULL:{name:'full',entrypoint:'FullApplication'}},
    script:"export default {fetch(r,e){const q=new Request(r);q.headers.set('x-buffalo-project','example');return e.FULL.fetch(q)}}"},
  {name:'full',modules:true,compatibilityDate:'2026-11-19',script,
    bindings:{RUNTIME_ENABLED:'true',APP_AUTH_KEY:'fixture'},durableObjects:{PROJECTS:{className:'LocalProject',useSQLite:true}}}
]}),resourcePersistencePath:disk};
let mf,child,exited,calls=0;
const key=randomUUID(),base='http://127.0.0.1:8793';
const model={variables:[{name:'Demand',type:'variable',equation:'3'}],relationships:[]};
const doc=(options={})=>mf.dispatchFetch('http://localhost/project/model',{...options,
  headers:{'x-buffalo-project':'example',...options.headers}});
function start(edit){
  child=spawn('/usr/bin/setpriv',['--inh-caps=-all','--ambient-caps=-all','--no-new-privs','--',process.execPath,
    '--import','./infra/full-runtime/bootstrap.mjs','app.js'],{stdio:'inherit',env:{
      PATH:process.env.PATH,HOME:process.env.HOME,PORT:'8080',WEBSOCKET_PORT:'8080',AUTHENTICATION_KEY:key,
      ALLOW_UNSANDBOXED_FALLBACK:'false',...(edit?{BUFFALO_PRIVATE_MERLIN_MODEL:GEMMA}:{})}});
  exited=once(child,'exit');
}
async function stop(){if(child){child.kill();await exited;child=null;}}
const fixture={async run(model,wire){
  assert.equal(model,GEMMA);
  assert(wire.tools.some(t=>t.function.name==='edit_variables'));
  const message={role:'assistant'};
  if(calls===1){
    message.tool_calls=[{type:'function',id:'test-edit',function:{name:'edit_variables',
      arguments:JSON.stringify({operation:'update',data:[{name:'Demand',equation:'5'}]})}}];
  }else{
    assert.equal(calls,2);
    assert(wire.messages.some(m=>m.role==='tool' && m.tool_call_id==='test-edit' && m.content.includes('Successfully edited')));
    message.content='Offline fixture acknowledges edit.';
  }
  return {model,usage:{prompt_tokens:12,completion_tokens:8},
    choices:[{index:0,finish_reason:message.tool_calls?'tool_calls':'stop',message}]};
}};
const proxy=createServer(async(req,res)=>{
  try{
    assert.equal(req.url,'/v1/chat/completions');
    const r=await completion(new Request(ENDPOINT,{method:req.method,body:req,duplex:'half'}),fixture,()=>++calls<=2);
    res.writeHead(r.status,{'content-type':'application/json'}).end(await r.text());
  }catch(e){console.error(e);res.writeHead(422).end();}
});
try{
  mf=new Miniflare(options);await mf.ready;
  const created=await doc({method:'PUT',headers:{'if-none-match':'*'},body:JSON.stringify(model)});
  assert.equal(created.status,201);
  start(false);await rest(base,key);
  for(const [mode,agents] of [['cld',['socrates','athena_CLD','merlin']],['sfd',['themis','athena_SFD','socrates','merlin']]]){
    for(const agent of agents)await session({mode,key,agent,model:mode==='cld'?{variables:[{name:'Trust',type:'variable'}],relationships:[]}:model});
  }
  await stop();assert.equal(calls,0);console.log('FULL_ORIGINAL_REST_AND_FIVE_CONFIGURATIONS');
  proxy.listen(80,'127.0.0.1');await once(proxy,'listening');
  start(true);await rest(base,key);
  const old={'if-match':created.headers.get('etag')};
  await session({mode:'sfd',key,model,agent:'merlin',edit:true,save:async m=>{
    assert.equal((await doc({method:'PUT',headers:old,body:JSON.stringify(m)})).status,204);
  }});
  assert.equal((await doc({method:'PUT',headers:old,body:JSON.stringify(model)})).status,412);
  await stop();await mf.dispose();mf=new Miniflare(options);await mf.ready;
  const saved=await doc();assert.equal(saved.headers.get('etag'),'"2"');
  const recovered=await saved.json();assert.equal(recovered.variables[0].equation,'5');
  start(false);await rest(base,key);await session({mode:'sfd',key,agent:'merlin',model:recovered});
  assert.equal(calls,2);console.log('FULL_ORIGINAL_EDIT_CONFIRMED_AND_PROJECT_REOPENED_OFFLINE');
}finally{await stop();proxy.close();await mf?.dispose();await rm(disk,{recursive:true,force:true});}
