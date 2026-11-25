import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {recoverHistoricalMessages} from './conversation-client.mjs';
const put=(r,path,value)=>r(path,{method:'PUT',body:JSON.stringify(value)});
const check=async(p,status)=>{const r=await p;assert.equal(r.status,status);return r;};
const get=async(p)=> (await check(p,200)).json();

export async function checkConversationBeforeRestart(request,other,journal,input,output){
 const {root,turnPath,conversationId}=journal;
 const completed=await get(request(turnPath));
 assert.equal(completed.status,'completed');
 assert.deepEqual(await get(request(root)),{mode:'sfd',agent:'merlin',provider:'cloudflare'});
 assert((await get(request('/project/conversations'))).items.some(x=>x.id===conversationId));
 assert.deepEqual({revision:completed.turn.revision,model_sha256:completed.turn.model_sha256},input);
 const events=completed.events.map(x=>x.event);
 const accepted=events.filter(x=>x.type==='model_accepted');
 assert(accepted.length>0,'MISSING_ACCEPTED_REVISION');
 // The original agent may publish an edited model and subsequently confirm
 // the same model via update_model. Equal hashes do not collapse revisions.
 let prior=input.revision;
 const requestIds=new Set();
 for(const ack of accepted){
  assert(ack.revision>prior,'ACCEPTED_REVISION_ORDER');prior=ack.revision;
  assert(!requestIds.has(ack.request_id),'DUPLICATE_UPDATE_REQUEST');requestIds.add(ack.request_id);
  const historical=await check(request('/project/model/revisions/'+ack.revision),200);
  assert.equal(historical.headers.get('x-buffalo-model-sha256'),ack.model_sha256);
  assert.equal((await historical.json()).variables.find(v=>v.name==='Demand').equation,'5');
 }
 const ack=accepted.at(-1);
 assert.deepEqual({revision:ack.revision,model_sha256:ack.model_sha256},output);
 assert.equal(accepted.length,output.revision-input.revision,'UNRECORDED_MODEL_UPDATE');
 console.log('FULL_CONVERSATION_ACCEPTED_REVISIONS '+JSON.stringify(accepted.map(({revision,model_sha256})=>({revision,model_sha256}))));
 assert(events.some(e=>e.type==='tool_completed'&&e.tool_name==='update_model'&&e.is_error===false));
 assert(events.lastIndexOf(ack)<events.findIndex(e=>e.type==='tool_completed'&&e.tool_name==='update_model'));
 assert(events.filter(e=>e.type==='tool_completed').every(e=>Object.hasOwn(e,'result')));
 assert(events.some(e=>e.type==='tool_completed'&&e.tool_name==='edit_variables'&&e.is_error===false));
 assert.deepEqual(events.at(-1),{type:'completed',...output});
 const history=await recoverHistoricalMessages(request,conversationId);
 assert.equal(history[0].content,'Change the equation for Demand from 3 to 5.');
 assert(history.some(x=>x.type==='agent_text'&&x.content==='<p>Offline fixture acknowledges operation.</p>\n'));
 await check(put(request,turnPath+'/events/'+completed.events.length,events.at(-1)),204);
 await check(put(request,turnPath+'/events/'+completed.events.length,{type:'interrupted',reason:'client_error'}),409);
 const active=root+'/turns/'+randomUUID();
 const pending={runtime_session_id:'sess_'+'1'.repeat(32),message:'Interrupted experiment',...output};
 await check(put(request,active,{...pending,model_sha256:'0'.repeat(64)}),409);
 await check(put(request,active,pending),201);
 await check(put(request,active,pending),204);
 await check(put(request,root+'/turns/'+randomUUID(),pending),409);
 const started={type:'tool_started',call_id:'unconfirmed',tool_name:'run_model'};
 await check(put(request,active+'/events/2',started),409);
 await check(put(request,active+'/events/1',{type:'assistant_text',content:'x'.repeat(24001)}),422);
 await check(request(active+'/events/1',{method:'PUT',body:' '.repeat(64*1024+1)}),413);
 await check(put(request,active+'/events/1',started),201);
 await check(put(request,active+'/events/1',started),204);
 await check(put(request,active+'/events/2',{type:'completed',...output}),409);
 await check(put(request,active+'/events/2',{type:'tool_completed',call_id:'wrong',tool_name:'run_model',is_error:false}),409);
 await check(other(root),404);await check(other(turnPath),404);
 assert.deepEqual(await recoverHistoricalMessages(request,conversationId),history);
 return {root,active,pending,completed,history,conversationId};
}
export async function checkConversationAfterRestart(request,other,state,journal){
 assert.deepEqual(await get(request(journal.turnPath)),state.completed);
 const active=await get(request(state.active));
 assert.equal(active.status,'active');
 assert.equal(active.events.length,1);
 assert.equal(active.events[0].event.type,'tool_started');
 await check(put(request,state.active+'/events/2',{type:'interrupted',reason:'reconciled_after_restart'}),201);
 await check(put(request,state.active+'/events/3',{type:'tool_completed',call_id:'unconfirmed',tool_name:'run_model',is_error:false}),409);
 await check(put(request,state.active,state.pending),204);
 assert.equal((await get(request(state.active))).status,'interrupted');
 await check(other(state.active),404);
 const history=await recoverHistoricalMessages(request,state.conversationId);
 assert.deepEqual(history,state.history);
 const repeat=state.root+'/turns/'+randomUUID();
 await check(put(request,repeat,state.pending),201);
 await check(put(request,repeat+'/events/1',{type:'interrupted',reason:'client_disconnected'}),201);
 console.log('FULL_CONVERSATION_HISTORY_RECOVERED_NO_PENDING_REPLAY '+JSON.stringify({conversation_id:state.conversationId,history_count:history.length,confirmed_tools:state.completed.events.filter(e=>e.event.type==='tool_completed').length}));
 return history;
}
