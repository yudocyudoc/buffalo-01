import test from 'node:test';
import assert from 'node:assert/strict';
import {ID,PROJECT,LIMIT,PASS,validGrant,runEdit} from './remote-edit.mjs';
const g={project:PROJECT,max_calls:LIMIT,source_commit:'a'.repeat(40),image_digest:'sha256:'+'b'.repeat(64),run_id:'58532b8a-b25e-4b67-a90b-10db57da263b',expires:Date.now()+600000};
function fixture(){
 let row,model,rev=0,stops=0,opens=0,claims=0;
 const db={prepare(sql){return{bind(...a){return{run:async()=>{
  if(sql.startsWith('INSERT')){if(row)return{meta:{changes:0}};claims++;row={status:a[2],receipt:JSON.parse(a[3])};return{meta:{changes:1}}}
  assert.equal(a[2],ID);assert.equal(a[3],g.run_id);assert.equal(a[4],'CLAIMED');row={status:a[0],receipt:JSON.parse(a[1])};return{meta:{changes:1}};
 }}}}}};
 const ws=()=>{
  const events=new Map();let session='sess_'+String(++opens).repeat(32),edit=false;
  const emit=(type,body={})=>queueMicrotask(()=>events.get('message')?.({data:JSON.stringify({type,sessionId:session,...body})}));
  return{addEventListener(t,fn){events.set(t,fn)},removeEventListener(t){events.delete(t)},accept(){emit('session_created')},
   close(){},send(data){const m=JSON.parse(data);switch(m.type){
    case 'initialize_session':emit('session_ready',{availableAgents:['athena_SFD','merlin','socrates','themis'].map(id=>({id,supportedModes:['sfd'],supportedProviders:[{id:'cloudflare'}]}))});break;
    case 'select_agent':emit('agent_selected',{agentId:'merlin'});break;
    case 'chat':edit=true;emit('tool_call_notification',{toolName:'update_model',callId:'one'});emit('update_model',{requestId:'update',modelData:{variables:[{name:'Demand',type:'variable',equation:'5'}],relationships:[]}});break;
    case 'tool_call_response':assert(edit);emit('tool_call_completed',{toolName:'update_model',callId:'one',isError:false});emit('agent_complete',{status:'success'});break;
    case 'disconnect':queueMicrotask(()=>events.get('close')?.({code:1000}));break;
   }}};
 };
 const FULL={async fetch(r){
  assert.equal(r.headers.get('x-buffalo-project'),PROJECT);
  const p=new URL(r.url).pathname;
  if(p==='/project/model'){
   if(r.method==='GET')return Response.json(model,{headers:{etag:'"'+rev+'"'}});
   if(rev===0){model=await r.json();rev++;return new Response(null,{status:201,headers:{etag:'"1"'}})}
   if(r.headers.get('if-match')!=='"'+rev+'"')return new Response(null,{status:412});
   model=await r.json();rev++;return new Response(null,{status:204,headers:{etag:'"'+rev+'"'}});
  }
  if(p==='/status')return new Response('ok');
  if(p==='/api/v1/engines')return Response.json({success:true,engines:[{name:'predprey'}]});
  if(p==='/api/v1')return{status:101,webSocket:ws()};
  const i=Number(p.split('/').at(-1));
  return i<=2?Response.json({status:'OK',finish_reason:i===1?'tool_calls':'stop',usage:{prompt_tokens:100,completion_tokens:10},neurons:1}):new Response(null,{status:404});
 },async stop(p){assert.equal(p,PROJECT);stops++;return{container_stopped:true}}};
 return{env:{DB:db,FULL,APP_AUTH_KEY:'fixture',FULL_EDIT_GRANT:JSON.stringify(g)},read:()=>({row,model,rev,stops,opens,claims})};
}
test('only one remote edit claim; final model, stale write, reopen and two stops',async()=>{
 const f=fixture();await Promise.all([runEdit(f.env),runEdit(f.env)]);const x=f.read();
 assert.equal(x.claims,1);assert.equal(x.row.status,PASS);assert.equal(x.rev,2);assert.equal(x.stops,2);assert.equal(x.opens,2);
 assert.equal(x.row.receipt.recovered_model.variables[0].equation,'5');assert.equal(x.row.receipt.inferences.length,2);
 assert.equal(x.row.receipt.tools[0].name,'update_model');assert.equal(x.row.receipt.container_stopped,true);
});
test('expired, wrong project or increased calls cannot claim',async()=>{
 for(const patch of [{expires:0},{project:'other'},{max_calls:7}]){
  const f=fixture();assert(!validGrant({...g,...patch}));await runEdit({...f.env,FULL_EDIT_GRANT:JSON.stringify({...g,...patch})});assert.equal(f.read().claims,0);
 }
});
test('failed upgrade is terminal; stop still invoked; never retry',async()=>{
 const f=fixture(),fetch=f.env.FULL.fetch;
 f.env.FULL.fetch=async r=>new URL(r.url).pathname==='/api/v1'?new Response(null,{status:503}):fetch(r);
 await runEdit(f.env);await runEdit(f.env);
 assert.equal(f.read().row.status,'RUNTIME_FAILURE');assert.equal(f.read().row.receipt.failure_code,'WS_UPGRADE');assert.equal(f.read().stops,1);assert.equal(f.read().claims,1);
});
