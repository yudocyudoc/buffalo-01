/** Private Worker API. No publicly readable task, token or shell endpoint. */
import {D1TaskStore} from './store.mjs';
import {GitHubOffline} from './github.mjs';
import {ControlPlaneService} from './service.mjs';
async function authorized(request,secret){
 if(typeof secret!=='string'||secret.length<32)return false;
 const bearer=request.headers.get('authorization')??'';
 const supplied=bearer.startsWith('Bearer ')?bearer.slice(7):'';
 const encode=new TextEncoder();
 const [a,b]=await Promise.all([crypto.subtle.digest('SHA-256',encode.encode(supplied)),
   crypto.subtle.digest('SHA-256',encode.encode(secret))]);
 const x=new Uint8Array(a),y=new Uint8Array(b);
 let diff=supplied.length===secret.length?0:1;
 for(let i=0;i<x.length;i++)diff|=x[i]^y[i];
 return diff===0;
}
const send=(body,status=200)=>Response.json(body,{status,headers:{
 'cache-control':'no-store','x-content-type-options':'nosniff'}});
export async function handle(request,env,deps={}){
 if(!await authorized(request,env.CONTROL_API_TOKEN))return send({error:'UNAUTHORIZED'},401);
 if(!env.DB||!env.GITHUB_FINE_GRAINED_TOKEN)return send({error:'NOT_CONFIGURED'},503);
 const path=new URL(request.url).pathname,method=request.method.toUpperCase();
 if(Number(request.headers.get('content-length')??0)>4096)return send({error:'BODY_TOO_LARGE'},413);
 const store=deps.store??new D1TaskStore(env.DB);
 const github=deps.github??new GitHubOffline(env.GITHUB_FINE_GRAINED_TOKEN);
 const svc=new ControlPlaneService(store,github,deps.clock);
 try{
  if(path==='/v1/diagnostics/github-preflight'&&method==='GET')
   return await respond(svc.diagnoseGithub());
  if(path==='/v1/tasks'&&method==='POST'){
   const body=await request.text();
   if(body.length>4096)return send({error:'BODY_TOO_LARGE'},413);
   return await respond(svc.create(JSON.parse(body)));
  }
  const match=path.match(/^\/v1\/tasks\/([a-fA-F0-9-]{36})(?:\/(dispatch|reconcile))?$/);
  if(!match)return send({error:'NOT_FOUND'},404);
  const [,id,action]=match;
  if(!action&&method==='GET')return await respond(svc.inspect(id));
  if(action==='dispatch'&&method==='POST')return await respond(svc.dispatch(id));
  if(action==='reconcile'&&method==='POST')return await respond(svc.reconcile(id));
  return send({error:'METHOD_NOT_ALLOWED'},405);
 }catch(error){
  if(error instanceof SyntaxError)return send({error:'INVALID_JSON'},400);
  if(String(error?.message).startsWith('CONTROL_PLANE_INVALID')||
     String(error?.message).startsWith('CONTROL_PLANE_EXTRA'))
   return send({error:'INVALID_INPUT'},400);
  if(String(error?.message).includes('TASK_ID_CONFLICT'))return send({error:'TASK_ID_CONFLICT'},409);
  return send({error:'CONTROL_PLANE_OPERATION_FAILED'},502);
 }
}
async function respond(promise){const {code,body}=await promise;return send(body,code)}
export default {fetch:handle};
