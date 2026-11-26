import {DurableObject,WorkerEntrypoint} from 'cloudflare:workers';
import {GEMMA} from '../private-merlin/gemma-response.mjs';
import {completion} from './gateway.mjs';
import {engineCompletion} from './engine-gateway.mjs';
import {ENGINE_ENDPOINT} from './engine-protocol.mjs';
import {projectModel} from './project.mjs';
import {projectRuns} from './project-runs.mjs';
import {projectNativeLtm} from './native-ltm.mjs';
import {projectRunArtifact} from './project-run-artifacts.mjs';
import {projectConversations} from './project-conversations.mjs';

const deny=()=>new Response(null,{status:404});
const idPattern=/^[a-z0-9][a-z0-9-]{0,62}$/;
function approved(env,project){
  return env.RUNTIME_ENABLED==='true' && project===env.AI_PROJECT && idPattern.test(project) && env.AI?.run &&
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
  stop(project){
    if(this.env.RUNTIME_ENABLED!=='true'||project!==this.env.AI_PROJECT||!idPattern.test(project))throw Error('STOP_NOT_AUTHORIZED');
    return this.env.PROJECTS.getByName(project).stop(project);
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
    const storage=this.ctx.storage;
    const engine=request.url===ENGINE_ENDPOINT;
    if(engine&&this.env.ENGINE_INFERENCE_ENABLED!=='true')return deny();
    const dispatch=engine?engineCompletion:completion;
    return dispatch(request,this.env.AI,receipt=>storage.transaction(async tx=>{
      const used=await tx.get('bindingCalls')??0;
      if(!approved(this.env,project) || used>=Number(this.env.AI_MAX_CALLS))return false;
      // The same invocation may arrive twice, but identical experiments are legitimate.
      // Legacy engine-request:<hash> keys are intentionally no longer consulted.
      const replayKey=engine?'engine-invocation:'+receipt.invocation_id:null;
      if(engine&&(this.env.ENGINE_INFERENCE_ENABLED!=='true'||await tx.get(replayKey)))return false;
      const attempt=used+1;
      await tx.put({bindingCalls:attempt,['inference:'+attempt]:receipt,...(replayKey?{[replayKey]:attempt}:{})});
      return attempt;
    }),(attempt,receipt)=>storage.put('inference:'+attempt,receipt),
      {engineEnabled:this.env.ENGINE_INFERENCE_ENABLED==='true'});
  }
  async stop(project){
    if(this.env.RUNTIME_ENABLED!=='true'||project!==this.env.AI_PROJECT||!this.ctx.id.equals(this.env.PROJECTS.idFromName(project)))throw Error('STOP_NOT_AUTHORIZED');
    const c=this.ctx.container;
    if(await c.inspect()!==null)await c.destroy();
    if(await c.inspect()!==null)throw Error('CONTAINER_STOP_UNCONFIRMED');
    this.ready=false;return {container_stopped:true};
  }
  async prepare(project){
    const c=this.ctx.container;
    if(!c.running){
      const ai=approved(this.env,project);
      if(ai){const intercept=this.ctx.exports.ModelProvider({props:{project}});
        await c.interceptAllOutboundHttp(intercept);
        await c.interceptOutboundHttps('*',intercept);
      }
      c.start({image:c.images.base,instance:'basic',enableInternet:false,env:{
        AUTHENTICATION_KEY:this.env.APP_AUTH_KEY,PORT:'8080',WEBSOCKET_PORT:'8080',BUFFALO_NATIVE_LTM:'true',
        ...(ai?{BUFFALO_PRIVATE_MERLIN_MODEL:GEMMA}:{ }),
        ...(ai&&this.env.ENGINE_INFERENCE_ENABLED==='true'?{BUFFALO_FULL_ENGINE_PROVIDER:'true'}:{})}});
    }
    await c.setInactivityTimeout(120000);
    const port=c.getTcpPort(8080);
    for(let attempt=0;attempt<60;attempt++){
      try{const health=await port.fetch('http://container/status',{signal:AbortSignal.timeout(1000)});
        await health.body?.cancel();if(health.ok){if((await c.inspect())?.image!==c.images.base)throw Error('FULL_IMAGE_IDENTITY');return port;}}catch{}
      await scheduler.wait(250);
    }
    throw Error('ORIGINAL_APP_STARTUP_TIMEOUT');
  }
  async applicationPort(project){
    // Coalesce concurrent cold starts. A running container stays on the fast path.
    if(this.ready && this.ctx.container.running)return this.ctx.container.getTcpPort(8080);
    this.starting??=this.prepare(project).finally(()=>{this.starting=null;});
    const port=await this.starting;
    this.ready=true;
    return port;
  }
  async simulateNative(project,body){
    if(!this.env.APP_AUTH_KEY)return new Response(null,{status:503});
    try{
      await this.applicationPort(project);
      return await this.ctx.container.getTcpPort(8081).fetch(new Request('http://container/simulate',{method:'POST',body}));
    }catch{return new Response(null,{status:503});}
  }
  async fetch(request){
    const url=new URL(request.url);
    const native=/^\/project\/runs\/([^/]+)\/ltm$/.exec(url.pathname);
    if(native)return projectNativeLtm(request,this.ctx.storage,native[1],body=>this.simulateNative(request.headers.get('x-buffalo-project'),body));
    if(url.pathname==='/project/model')return projectModel(request,this.ctx.storage);
    const revision=/^\/project\/model\/revisions\/([1-9]\d{0,15})$/.exec(url.pathname);
    if(revision&&Number.isSafeInteger(Number(revision[1])))return projectModel(request,this.ctx.storage,Number(revision[1]));
    if(url.pathname.startsWith('/project/model/revisions'))return deny();
    if(url.pathname==='/project/conversations'||url.pathname.startsWith('/project/conversations/'))return projectConversations(request,this.ctx.storage);
    if(url.pathname==='/project/runs')return projectRuns(request,this.ctx.storage);
    const artifact=/^\/project\/runs\/([^/]+)\/(?:feedback|narratives\/([^/]+))$/.exec(url.pathname);
    if(artifact)return projectRunArtifact(request,this.ctx.storage,artifact[1],artifact[2]);
    if(url.pathname.startsWith('/project/runs/'))return projectRuns(request,this.ctx.storage,url.pathname.slice('/project/runs/'.length));
    const attempt=/^\/project\/inference\/([1-9]\d{0,15})$/.exec(url.pathname);
    if(attempt){
      if(request.method!=='GET')return new Response(null,{status:405,headers:{Allow:'GET'}});
      const receipt=await this.ctx.storage.get('inference:'+attempt[1]);
      return receipt?Response.json(receipt,{headers:{'cache-control':'no-store'}}):deny();
    }
    if(!this.env.APP_AUTH_KEY)return new Response(null,{status:503});
    let port;
    try{port=await this.applicationPort(request.headers.get('x-buffalo-project'));}
    catch{this.ready=false;return new Response(null,{status:503});}
    url.protocol='http:';url.host='container';url.port='';
    const origin=new Request(url,request);origin.headers.delete('x-buffalo-project');
    return port.fetch(origin);
  }
}
export default {fetch:deny};
