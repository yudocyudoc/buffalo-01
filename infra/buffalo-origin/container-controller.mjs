/**
 * Stage 3B-4 Cloudflare Container router. DO NOT DEPLOY without explicit
 * approval for container charges and private secret provisioning.
 *
 * Cloudflare API as of Nov 2026: DurableObject.ctx.container.start()
 * + getTcpPort(8080).fetch(), NOT the deprecated @cloudflare/containers
 * Container.fetch() helper. No public routes; one fixed private instance.
 */
import {DurableObject} from 'cloudflare:workers';

const PORT=8080;
const INSTANCE='buffalo-original-handshake-only';
const MODE='HANDSHAKE_ONLY_NO_AGENT_PROCESS';
const DENIED=()=>new Response('Not Found',{status:404});
const BLOCKED=()=>new Response('Origin unavailable',{status:503});
const allowedPath=request=>{
 const u=new URL(request.url);
 return request.method==='GET'&&u.pathname==='/api/v1'&&!u.search&&
  request.headers.get('upgrade')?.toLowerCase()==='websocket'&&
  !request.headers.has('sec-websocket-protocol');
};
const keyOk=async(request,key)=>{
 if(typeof key!=='string'||key.length<32)return false;
 const raw=request.headers.get('x-buffalo-origin-token')??'';
 if(raw.length!==key.length)return false;
 const enc=new TextEncoder();
 const [a,b]=await Promise.all([
  crypto.subtle.digest('SHA-256',enc.encode(raw)),
  crypto.subtle.digest('SHA-256',enc.encode(key))
 ]);
 const x=new Uint8Array(a),y=new Uint8Array(b);
 let diff=0;
 for(let i=0;i<x.length;i++)diff|=x[i]^y[i];
 return diff===0;
};
function configReady(env){
 return env.BUFFALO_ORIGIN_MODE===MODE&&
  typeof env.BUFFALO_ORIGIN_UPGRADE_TOKEN==='string'&&
  env.BUFFALO_ORIGIN_UPGRADE_TOKEN.length>=32&&
  typeof env.BUFFALO_ORIGIN_AUTH_KEY==='string'&&
  env.BUFFALO_ORIGIN_AUTH_KEY.length>=32&&
  env.BUFFALO_ORIGIN_AUTH_KEY!==env.BUFFALO_ORIGIN_UPGRADE_TOKEN&&
  /^[a-f0-9]{64}$/.test(env.BUFFALO_ORIGIN_MODEL_SHA256??'')&&
  /^[a-f0-9]{40}$/.test(env.BUFFALO_ORIGIN_COMMIT_SHA??'');
}
export class BuffaloHandshakeContainer extends DurableObject {
 starting;
 async fetch(request){
  if(!allowedPath(request))return DENIED();
  if(!configReady(this.env))return BLOCKED();
  if(!await keyOk(request,this.env.BUFFALO_ORIGIN_UPGRADE_TOKEN))
   return DENIED();
  this.starting??=this.ensureReady().finally(()=>{this.starting=undefined});
  try{await this.starting}catch{return BLOCKED()}
  const url=new URL(request.url);
  url.protocol='http:';url.host='container';url.port='';
  const forwarded=new Request(url,request);
  forwarded.headers.delete('host');
  // This is a private port fetch; return the 101 directly without consuming
  // its WebSocket before the downstream Worker accepts it.
  try{return await this.ctx.container.getTcpPort(PORT).fetch(forwarded)}
  catch{return BLOCKED()}
 }
 async ensureReady(){
  const container=this.ctx.container;
  if(!container)throw Error('CONTAINER_BINDING_MISSING');
  if(!container.running){
   container.start({
    image:container.images.base,
    instance:'lite',
    enableInternet:false,
    env:{
     BUFFALO_ORIGIN_MODE:MODE,
     BUFFALO_ORIGIN_UPGRADE_TOKEN:this.env.BUFFALO_ORIGIN_UPGRADE_TOKEN,
     AUTHENTICATION_KEY:this.env.BUFFALO_ORIGIN_AUTH_KEY,
     BUFFALO_ORIGIN_MODEL_SHA256:this.env.BUFFALO_ORIGIN_MODEL_SHA256,
     BUFFALO_ORIGIN_COMMIT_SHA:this.env.BUFFALO_ORIGIN_COMMIT_SHA
    }
   });
  }
  await container.setInactivityTimeout(60_000);
  const port=container.getTcpPort(PORT);
  for(let attempt=0;attempt<75;attempt++){
   try{
    const r=await port.fetch('http://container/health',{signal:AbortSignal.timeout(1000)});
    await r.body?.cancel();
    if(r.status===204)return;
   }catch{}
   await scheduler.wait(200);
  }
  throw Error('ORIGIN_HEALTH_NOT_READY');
 }
}
export default {
 async fetch(request,env){
  if(!allowedPath(request))return DENIED();
  // Authorization occurs BEFORE allocating/touching a Durable Object, to
  // prevent externally triggered container startup and billing.
  if(!configReady(env)||!await keyOk(request,env.BUFFALO_ORIGIN_UPGRADE_TOKEN))
   return DENIED();
  return env.BUFFALO_CONTAINER.getByName(INSTANCE).fetch(request);
 }
};
