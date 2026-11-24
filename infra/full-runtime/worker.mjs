import {DurableObject,WorkerEntrypoint} from 'cloudflare:workers';
import {GEMMA} from '../private-merlin/gemma-response.mjs';
import {completion} from './gateway.mjs';
import {projectModel} from './project.mjs';

const deny=()=>new Response(null,{status:404});
const idPattern=/^[a-z0-9][a-z0-9-]{0,62}$/;
function approved(env,project){
  return project===env.AI_PROJECT && idPattern.test(project) && env.AI?.run &&
    Number.isSafeInteger(Number(env.AI_MAX_CALLS)) && Number(env.AI_MAX_CALLS)>0 &&
    Date.parse(env.AI_EXPIRES_AT)>Date.now();
}

// Only a trusted service binding to this named entrypoint can choose a project.
// The caller authenticates the user and supplies their authorized project ID.
export class FullApplication extends WorkerEntrypoint {
  fetch(request){
    const project=request.headers.get('x-buffalo-project');
    if(!project || !idPattern.test(project) || this.env.RUNTIME_ENABLED!=='true')return deny();
    return this.env.PROJECTS.getByName(project).fetch(request);
  }
}
export class ModelProvider extends WorkerEntrypoint {
  fetch(request){
    const {project}=this.ctx.props;
    if(!approved(this.env,project))return deny();
    return this.env.PROJECTS.getByName(project).infer(request,project);
  }
}
export class ProjectRuntime extends DurableObject {
  async infer(request,project){
    if(!approved(this.env,project) || !this.ctx.id.equals(this.env.PROJECTS.idFromName(project)))return deny();
    return completion(request,this.env.AI,()=>this.ctx.storage.transaction(async tx=>{
      const used=await tx.get('bindingCalls')??0;
      if(!approved(this.env,project) || used>=Number(this.env.AI_MAX_CALLS))return false;
      await tx.put('bindingCalls',used+1);return true;
    }));
  }
  async prepare(project){
    const c=this.ctx.container;
    if(!c.running){
      const ai=approved(this.env,project);
      if(ai)await c.interceptOutboundHttp('merlin-provider.internal',this.ctx.exports.ModelProvider({props:{project}}));
      c.start({image:c.images.base,instance:'basic',enableInternet:false,env:{
        AUTHENTICATION_KEY:this.env.APP_AUTH_KEY,PORT:'8080',WEBSOCKET_PORT:'8080',
        ...(ai?{BUFFALO_PRIVATE_MERLIN_MODEL:GEMMA}:{})}});
    }
    await c.setInactivityTimeout(120000);
    const port=c.getTcpPort(8080);
    for(let attempt=0;attempt<60;attempt++){
      try{const health=await port.fetch('http://container/status',{signal:AbortSignal.timeout(1000)});
        await health.body?.cancel();if(health.ok)return port;}catch{}
      await scheduler.wait(250);
    }
    throw Error('ORIGINAL_APP_STARTUP_TIMEOUT');
  }
  async fetch(request){
    const url=new URL(request.url);
    if(url.pathname==='/project/model')return projectModel(request,this.ctx.storage);
    if(!this.env.APP_AUTH_KEY)return new Response(null,{status:503});
    const project=request.headers.get('x-buffalo-project');
    // Coalesce concurrent cold starts. A running container stays on the fast path.
    let port;
    if(this.ready && this.ctx.container.running)port=this.ctx.container.getTcpPort(8080);
    else{
      this.starting??=this.prepare(project).finally(()=>{this.starting=null;});
      try{port=await this.starting;this.ready=true;}catch{this.ready=false;return new Response(null,{status:503});}
    }
    url.protocol='http:';url.host='container';url.port='';
    const origin=new Request(url,request);origin.headers.delete('x-buffalo-project');
    return port.fetch(origin);
  }
}
export default {fetch:deny};
