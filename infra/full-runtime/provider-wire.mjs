// Runtime-neutral provider primitives; no dependency on historical proof grants.
export async function boundedJSON(stream,max){
  if(!stream)throw Error('MISSING_BODY');
  const reader=stream.getReader(),parts=[];
  let n=0;
  try{
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      n+=value.byteLength;if(n>max)throw Error('BODY_LIMIT');parts.push(value);
    }
  }finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(n);let pos=0;
  for(const p of parts){bytes.set(p,pos);pos+=p.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
export const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest(
  'SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
