// Compatible-client journal: persist a new turn before sending chat. A lost
// acknowledgement must be reconciled by reading, not by sending chat again.
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

const put=(request,path,value)=>request(path,{method:'PUT',body:JSON.stringify(value)});
async function expect(p,code){const r=await p;assert.equal(r.status,code);return r;}
export function modelIdentity(response){
 return {revision:Number(JSON.parse(response.headers.get('etag'))),model_sha256:response.headers.get('x-buffalo-model-sha256')};
}
export async function createConversationJournal(request,metadata,input){
 const conversationId=randomUUID(),turnId=randomUUID(),root='/project/conversations/'+conversationId,turnPath=root+'/turns/'+turnId;
 await expect(put(request,root,metadata),201);
 let seq=0,current=input,started=false,terminal=false;
 const event=async value=>{
  assert(started&&!terminal);
  // No implicit retry on an ambiguous write. Reconcile with a GET.
  await expect(put(request,turnPath+'/events/'+(seq+1),value),201);
  seq++;
  if(value.type==='completed'||value.type==='interrupted')terminal=true;
 };
 return {
  conversationId,turnId,root,turnPath,
  async begin(runtime_session_id,message){
   assert(!started);
   await expect(put(request,turnPath,{runtime_session_id,message,...input}),201);
   started=true;
  },
  event,
  async modelAccepted(request_id,identity){
   assert(identity&&Number.isSafeInteger(identity.revision));
   await event({type:'model_accepted',request_id,...identity});current=identity;
  },
  async complete(){await event({type:'completed',...current});}
 };
}
export async function recoverHistoricalMessages(request,conversationId){
 const root='/project/conversations/'+conversationId;
 const list=await (await expect(request(root+'/turns'),200)).json();
 // Deliberately bounded initial history. Refuse silent truncation.
 assert.equal(list.next_after,null,'HISTORY_PAGE_LIMIT');
 const messages=[];let chars=0;
 const append=message=>{chars+=message.content.length;assert(chars<=16000,'HISTORY_TEXT_LIMIT');messages.push(message);};
 for(const item of list.items){
  if(item.status!=='completed')continue;
  const record=await (await expect(request(root+'/turns/'+item.turn_id),200)).json();
  assert.equal(record.status,'completed');
  append({type:'user_text',content:record.turn.message});
  for(const {event} of record.events)if(event.type==='assistant_text')append({type:'agent_text',content:event.content});
 }
 return messages;
}
