// The compatible client owns the accepted SD-JSON. Persist exactly what it
// acknowledged, using the revision it last read to prevent lost updates.
export async function projectModel(request,storage){
  const sql=storage.sql;
  sql.exec('CREATE TABLE IF NOT EXISTS model (rev INTEGER PRIMARY KEY, body TEXT NOT NULL)');
  const latest=()=>sql.exec('SELECT rev,body FROM model ORDER BY rev DESC LIMIT 1').toArray()[0];
  if(request.method==='GET'){
    const row=latest();
    return row?new Response(row.body,{headers:{'content-type':'application/json',etag:'"'+row.rev+'"'}}):new Response(null,{status:404});
  }
  if(request.method!=='PUT')return new Response(null,{status:405});
  const match=request.headers.get('if-match'),create=request.headers.get('if-none-match')==='*';
  if(create===Boolean(match))return new Response(null,{status:428});
  if(!request.body)return new Response(null,{status:400});
  const reader=request.body.getReader(), decoder=new TextDecoder('utf-8',{fatal:true});
  let bytes=0,body='';
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;
      bytes+=value.length;if(bytes>1024*1024)return new Response(null,{status:413});
      body+=decoder.decode(value,{stream:true});}
    body+=decoder.decode();
    const m=JSON.parse(body);
    if(!m || !Array.isArray(m.variables) || !Array.isArray(m.relationships))return new Response(null,{status:422});
  }catch{return new Response(null,{status:400});}finally{await reader.cancel();}
  return storage.transactionSync(()=>{
    const row=latest();
    if(create?Boolean(row):!row || match!=='"'+row.rev+'"')return new Response(null,{status:412});
    const rev=(row?.rev??0)+1;
    sql.exec('INSERT INTO model(rev,body) VALUES (?,?)',rev,body);
    return new Response(null,{status:row?204:201,headers:{etag:'"'+rev+'"'}});
  });
}
