// Project-scoped client transcript journal. Never persist auth frames, thinking,
// or a provider's private conversation state. No pending operation is replayed here.
import {modelRevision,readProjectBody} from './project.mjs';
import {RUN_ID} from './project-runs.mjs';
import {digest} from './provider-wire.mjs';

const PAGE=50,MAX_EVENT=64*1024,MAX_TOTAL=512*1024,MAX_EVENTS=256;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const keys=(x,required,optional=[])=>obj(x)&&required.every(k=>Object.hasOwn(x,k))&&Object.keys(x).every(k=>required.includes(k)||optional.includes(k));
const text=(x,n=256)=>typeof x==='string'&&x.length>0&&x.length<=n;
const ref=x=>Number.isSafeInteger(x.revision)&&x.revision>0&&typeof x.model_sha256==='string'&&/^[0-9a-f]{64}$/.test(x.model_sha256);
const agents={cld:['merlin','socrates','athena_CLD'],sfd:['merlin','socrates','themis','athena_SFD']};
export const validConversation=x=>keys(x,['mode','agent','provider'])&&Object.hasOwn(agents,x.mode)&&agents[x.mode].includes(x.agent)&&text(x.provider);
export const validTurn=x=>keys(x,['runtime_session_id','message','revision','model_sha256'])&&typeof x.runtime_session_id==='string'&&/^sess_[a-f0-9]{32}$/.test(x.runtime_session_id)&&text(x.message,24000)&&ref(x);
export function validConversationEvent(x){
 if(!obj(x))return false;
 switch(x.type){
  case 'tool_started':return keys(x,['type','call_id','tool_name'],['arguments'])&&text(x.call_id)&&text(x.tool_name);
  case 'tool_completed':return keys(x,['type','call_id','tool_name','is_error'],['result'])&&text(x.call_id)&&text(x.tool_name)&&typeof x.is_error==='boolean';
  case 'model_accepted':return keys(x,['type','request_id','revision','model_sha256'])&&text(x.request_id)&&ref(x);
  case 'assistant_text':return keys(x,['type','content'])&&text(x.content,24000);
  case 'completed':return keys(x,['type','revision','model_sha256'])&&ref(x);
  case 'interrupted':return keys(x,['type','reason'])&&['client_disconnected','reconciled_after_restart','client_error'].includes(x.reason);
  default:return false;
 }
}
const status=n=>new Response(null,{status:n});
const json=x=>Response.json(x,{headers:{'cache-control':'no-store'}});
function init(sql){
 sql.exec('CREATE TABLE IF NOT EXISTS conversations (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, body TEXT NOT NULL)');
 sql.exec("CREATE TABLE IF NOT EXISTS conversation_turns (seq INTEGER PRIMARY KEY, conversation_id TEXT NOT NULL, turn_id TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, event_count INTEGER NOT NULL DEFAULT 0, event_bytes INTEGER NOT NULL DEFAULT 0, UNIQUE(conversation_id,turn_id))");
 sql.exec('CREATE TABLE IF NOT EXISTS conversation_events (conversation_id TEXT NOT NULL, turn_id TEXT NOT NULL, n INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(conversation_id,turn_id,n))');
}
async function checkRevision(sql,value){
 const model=modelRevision(sql,value.revision);
 return !model?404:await digest(model.body)!==value.model_sha256?409:0;
}
function page(request,sql,query,...params){
 const after=new URL(request.url).searchParams.get('after')??'0';
 if(!/^\d{1,16}$/.test(after)||!Number.isSafeInteger(Number(after)))return status(400);
 const rows=sql.exec(query,Number(after),...params,PAGE+1).toArray();
 const items=rows.slice(0,PAGE);
 return json({items,next_after:rows.length>PAGE?items.at(-1).seq:null});
}
export async function projectConversations(request,storage){
 const path=new URL(request.url).pathname.split('/').slice(3);
 if(path.length>5)return status(404);
 const [id,turns,turnId,events,n]=path;
 const all=new URL(request.url).pathname==='/project/conversations';
 // Event paths have one extra segment; parse separately to keep the index explicit.
 return route(request,storage,all,id,turns,turnId,events,n);
}
async function route(request,storage,all,id,turns,turnId,events,n){
 const sql=storage.sql;init(sql);
 const conv=()=>sql.exec('SELECT body FROM conversations WHERE id=?',id).toArray()[0];
 const turn=()=>sql.exec('SELECT body,status,event_count,event_bytes FROM conversation_turns WHERE conversation_id=? AND turn_id=?',id,turnId).toArray()[0];
 const eventRows=()=>sql.exec('SELECT n,body FROM conversation_events WHERE conversation_id=? AND turn_id=? ORDER BY n',id,turnId).toArray();
 if(all){
  if(request.method!=='GET')return status(405);
  return page(request,sql,'SELECT seq,id FROM conversations WHERE seq>? ORDER BY seq LIMIT ?');
 }
 if(!RUN_ID.test(id??''))return status(404);
 if(turns===undefined){
  if(request.method==='GET'){const row=conv();return row?json(JSON.parse(row.body)):status(404);}
  if(request.method!=='PUT')return status(405);
  const p=await readProjectBody(request,4096);if(p.error)return status(p.error);
  if(!validConversation(p.value))return status(422);
  return storage.transactionSync(()=>{
   const old=conv();if(old)return status(old.body===p.body?204:409);
   sql.exec('INSERT INTO conversations(id,body) VALUES (?,?)',id,p.body);return status(201);
  });
 }
 if(turns!=='turns'||!conv())return status(404);
 if(turnId===undefined){
  if(request.method!=='GET')return status(405);
  return page(request,sql,'SELECT seq,turn_id,status,event_count FROM conversation_turns WHERE seq>? AND conversation_id=? ORDER BY seq LIMIT ?',id);
 }
 if(!RUN_ID.test(turnId))return status(404);
 if(events===undefined){
  if(request.method==='GET'){
   const row=turn();return row?json({turn:JSON.parse(row.body),status:row.status,events:eventRows().map(e=>({n:e.n,event:JSON.parse(e.body)}))}):status(404);
  }
  if(request.method!=='PUT')return status(405);
  const p=await readProjectBody(request,MAX_EVENT);if(p.error)return status(p.error);
  if(!validTurn(p.value))return status(422);
  const err=await checkRevision(sql,p.value);if(err)return status(err);
  return storage.transactionSync(()=>{
   const old=turn();if(old)return status(old.body===p.body?204:409);
   if(sql.exec("SELECT 1 FROM conversation_turns WHERE conversation_id=? AND status='active' LIMIT 1",id).toArray().length)return status(409);
   sql.exec("INSERT INTO conversation_turns(conversation_id,turn_id,body,status) VALUES (?,?,?,'active')",id,turnId,p.body);
   return status(201);
  });
 }
 if(events!=='events'||!/^([1-9]\d{0,2})$/.test(n??'')||Number(n)>MAX_EVENTS)return status(404);
 if(request.method!=='PUT')return status(405);
 if(!turn())return status(404);
 const p=await readProjectBody(request,MAX_EVENT);if(p.error)return status(p.error);
 const e=p.value;if(!validConversationEvent(e))return status(422);
 if(e.type==='completed'||e.type==='model_accepted'){
  const err=await checkRevision(sql,e);if(err)return status(err);
 }
 const bytes=new TextEncoder().encode(p.body).byteLength,seq=Number(n);
 return storage.transactionSync(()=>{
  const row=turn();
  const old=sql.exec('SELECT body FROM conversation_events WHERE conversation_id=? AND turn_id=? AND n=?',id,turnId,seq).toArray()[0];
  if(old)return status(old.body===p.body?204:409);
  if(row.status!=='active'||seq!==row.event_count+1)return status(409);
  // Leave room for an interruption marker even when trace limits are hit.
  if(seq===MAX_EVENTS&&e.type!=='completed'&&e.type!=='interrupted')return status(413);
  if(row.event_bytes+bytes>MAX_TOTAL-(e.type==='interrupted'||e.type==='completed'?0:4096))return status(413);
  const history=eventRows().map(x=>JSON.parse(x.body));
  const started=new Map(),finished=new Set(),requests=new Set();
  let current=JSON.parse(row.body);
  for(const previous of history){
   if(previous.type==='tool_started')started.set(previous.call_id,previous.tool_name);
   if(previous.type==='tool_completed')finished.add(previous.call_id);
   if(previous.type==='model_accepted'){current=previous;requests.add(previous.request_id);}
  }
  if(e.type==='tool_started'&&started.has(e.call_id))return status(409);
  if(e.type==='tool_completed'&&(started.get(e.call_id)!==e.tool_name||finished.has(e.call_id)))return status(409);
  if(e.type==='model_accepted'&&(requests.has(e.request_id)||e.revision<=current.revision))return status(409);
  if(e.type==='completed'&&(started.size!==finished.size||e.revision!==current.revision||e.model_sha256!==current.model_sha256))return status(409);
  const state=e.type==='completed'||e.type==='interrupted'?e.type:'active';
  sql.exec('INSERT INTO conversation_events(conversation_id,turn_id,n,body) VALUES (?,?,?,?)',id,turnId,seq,p.body);
  sql.exec('UPDATE conversation_turns SET status=?,event_count=?,event_bytes=? WHERE conversation_id=? AND turn_id=?',state,seq,row.event_bytes+bytes,id,turnId);
  return status(201);
 });
}
