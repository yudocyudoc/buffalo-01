// The compatible client owns the accepted SD-JSON. Persist exactly what it
// acknowledged, using the revision it last read to prevent lost updates.
import {digest} from './provider-wire.mjs';

export function modelTable(sql){
 sql.exec('CREATE TABLE IF NOT EXISTS model (rev INTEGER PRIMARY KEY, body TEXT NOT NULL)');
}
export function modelRevision(sql,rev){
 modelTable(sql);
 return sql.exec('SELECT rev,body FROM model WHERE rev=?',rev).toArray()[0];
}
const tag=rev=>'"'+rev+'"';
const headers=(rev,hash)=>({'etag':tag(rev),'x-buffalo-model-sha256':hash,'cache-control':'no-store'});
const status=(n)=>new Response(null,{status:n});
export async function readProjectBody(request,max){
 if(!request.body)return {error:400};
 const reader=request.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
 let bytes=0,body='';
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;
   bytes+=value.length;if(bytes>max)return {error:413};
   body+=decoder.decode(value,{stream:true});
  }
  body+=decoder.decode();
  return {body,value:JSON.parse(body)};
 }catch{return {error:400};}finally{await reader.cancel().catch(()=>{});}
}
export async function projectModel(request,storage,revision=null){
 const sql=storage.sql;modelTable(sql);
 const latest=()=>sql.exec('SELECT rev,body FROM model ORDER BY rev DESC LIMIT 1').toArray()[0];
 if(request.method==='GET'){
  const row=revision===null?latest():modelRevision(sql,revision);
  return row?new Response(row.body,{headers:{...headers(row.rev,await digest(row.body)),'content-type':'application/json'}}):status(404);
 }
 if(revision!==null||request.method!=='PUT')return status(405);
 const match=request.headers.get('if-match'),create=request.headers.get('if-none-match')==='*';
 if(create===Boolean(match))return status(428);
 const parsed=await readProjectBody(request,1024*1024);
 if(parsed.error)return status(parsed.error);
 const {body,value:m}=parsed;
 if(!m||!Array.isArray(m.variables)||!Array.isArray(m.relationships))return status(422);
 const hash=await digest(body);
 return storage.transactionSync(()=>{
  const row=latest();
  if(create?Boolean(row):!row||match!==tag(row.rev))return status(412);
  const rev=(row?.rev??0)+1;
  sql.exec('INSERT INTO model(rev,body) VALUES (?,?)',rev,body);
  return new Response(null,{status:row?204:201,headers:headers(rev,hash)});
 });
}
