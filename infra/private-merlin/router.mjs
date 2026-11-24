import {DurableObject,WorkerEntrypoint} from 'cloudflare:workers';
import {CONFIG_HASH,MODEL,checkInput,digest,grant,requireThat,elapsedLimit,verifyClaim} from './protocol.mjs';
import {boundedJSON,providerRequest} from './gateway.mjs';
import {bindingProviderRequest,durableStage,BINDING_TRANSPORT} from './binding-gateway.mjs';

const deny=()=>new Response(null,{status:404});
const stub=(env,phase)=>{
  requireThat(phase==='R'||phase==='I','INVALID_PHASE');
  return env.ORIGINS.getByName('private-merlin-v1-'+durableStage(env,phase));
};
export class Outbound extends WorkerEntrypoint {
  fetch(request){return stub(this.env,this.ctx.props.phase).outbound(request);}
}
export class Router extends WorkerEntrypoint {
  fetch(request){
    const phase=new URL(request.url).pathname.slice(1);
    if(!['R','I'].includes(phase) || request.method!=='GET' ||
      request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return deny();
    const g=grant(this.env,phase);
    if(request.headers.get('x-task-id')!==g.task_id)return deny();
    return stub(this.env,phase).fetch(request);
  }
  async open(task){
    const g=grant(this.env,task.phase);
    requireThat(g.task_id===task.task_id,'TASK_NOT_GRANTED');
    if(task.phase==='I'){
      const prior=await stub(this.env,'R').result();
      requireThat(prior?.status==='ORIGINAL_AGENT_PROCESS_BOUNDARY_PASS_NO_INFERENCE' &&
        prior.source_commit===g.source_commit && prior.image_digest===g.image_digest,'PRIVATE_R_REQUIRED');
    }
    return stub(this.env,task.phase).open(task);
  }
  finish(phase,transcript){return stub(this.env,phase).finish(transcript);}
  result(phase){return stub(this.env,phase).result();}
}

export class MerlinOrigin extends DurableObject {
  async fetch(request){
    const run=await this.ctx.storage.get('run');
    if(!run || run.status!=='RUNNING' || run.deadline<=Date.now() ||
      request.headers.get('x-task-id')!==run.task_id || !this.upgradeReady)return deny();
    this.upgradeReady=false;
    return this.ctx.container.getTcpPort(8080).fetch('http://container/api/v1',{
      headers:{Upgrade:'websocket','x-merlin-key':this.key}});
  }
  async result(){
    const run=await this.ctx.storage.get('run');
    if(!run)return null;
    const {sd_json,...result}=run;
    return result;
  }
  async open(task){
    await checkInput(task);
    const g=grant(this.env,task.phase);
    const container=this.ctx.container;
    verifyClaim(g,task.approval);
    const image=container.images.base;
    requireThat(g.task_id===task.task_id && task.source_commit===g.source_commit &&
      task.image_digest===g.image_digest && image.endsWith('@'+g.image_digest),'UNAPPROVED_IMAGE_OR_TASK');
    const deadline=Math.min(Date.now()+elapsedLimit,g.expires);
    await this.ctx.storage.transaction(async tx=>{
      requireThat(!(await tx.get('run')),'ONE_SHOT_ALREADY_CLAIMED');
      await tx.put('run',{phase:g.phase,task_id:g.task_id,source_commit:g.source_commit,image_digest:g.image_digest,
        approval:g,sd_json:task.sd_json,status:'RUNNING',posts:0,egress_attempts:0,deadline});
      await tx.setAlarm(deadline+5000);
    });
    try {
      const intercept=this.ctx.exports.Outbound({props:{phase:g.phase}});
      await container.interceptAllOutboundHttp(intercept);
      await container.interceptOutboundHttps('*',intercept);
      await this.ctx.storage.transaction(async tx=>{
        const s=await tx.get('run');requireThat(s?.status==='RUNNING','RUNTIME_NOT_RUNNING');
        await tx.put('run',{...s,intercepts_registered:true,internet_enabled_config:false});
      });
      this.key=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
      grant(this.env,task.phase);
      container.start({image,instance:'basic',enableInternet:false,env:{
        MERLIN_PHASE:g.phase,MERLIN_SOURCE:g.source_commit,MERLIN_KEY:this.key,MERLIN_EXPIRES:String(deadline),
        ...(g.phase==='I'?{BUFFALO_PRIVATE_MERLIN_MODEL:g.provider_model}:{})}});
      await container.setInactivityTimeout(elapsedLimit);
      const port=container.getTcpPort(8080);
      let ready=false;
      for(let i=0;i<40 && Date.now()<deadline;i++){
        try{
          const res=await port.fetch('http://container/health',{signal:AbortSignal.timeout(1000)});
          await res.body?.cancel();
          if(res.status===204){ready=true;break;}
        }catch{}
        await new Promise(r=>setTimeout(r,400));
      }
      requireThat(ready && (await container.inspect())?.image===image,'ORIGIN_NOT_VERIFIED');
      this.upgradeReady=true;
      return {deadline};
    } catch(error) {
      await this.finish(null);
      throw error;
    }
  }
  async outbound(request){
    const run=await this.ctx.storage.get('run');
    try{
      if(run?.phase==='I'&&this.env.MERLIN_I_TRANSPORT===BINDING_TRANSPORT)
        return await bindingProviderRequest(this.ctx.storage,this.env,run.phase,request);
      return await providerRequest(this.ctx.storage,this.env,run?.phase,request);
    }
    catch{return new Response(null,{status:403});}
  }
  async finish(transcript){
    const run=await this.ctx.storage.get('run');
    if(!run||run.status!=='RUNNING')return this.result();
    const container=this.ctx.container;
    let proof=null;
    const outputHash=typeof transcript?.output==='string'?await digest(transcript.output):null;
    try{
      if(transcript && this.key && Date.now()<run.deadline){
        const res=await container.getTcpPort(8080).fetch('http://container/proof',{
          headers:{'x-merlin-key':this.key},signal:AbortSignal.timeout(4000)});
        if(res.ok)proof=await boundedJSON(res.body,4096);
        else await res.body?.cancel();
      }
    } finally {
      this.key=undefined;
      await container.destroy();
      requireThat(await container.inspect()===null,'CONTAINER_CLEANUP_UNCONFIRMED');
      await this.ctx.storage.transaction(async tx=>{
        const s=await tx.get('run');
        if(s.status!=='RUNNING')return;
        const expected=['get_current_model',s.phase==='R'?'error':'agent_text','agent_complete'];
        const frames=['session_created','session_ready','agent_selected','agent_text',...expected];
        const valid=proof && proof.source_commit===s.source_commit && proof.agent_config_sha256===CONFIG_HASH &&
          proof.model_sha256===MODEL && proof.spawn_calls===1 && proof.shutdown_ipc_sent===true &&
          proof.exit?.code===0 && proof.exit.signal===null &&
          proof.session_id===transcript.session_id && JSON.stringify(transcript.frames)===JSON.stringify(frames) &&
          JSON.stringify(proof.worker_frames)===JSON.stringify(expected);
        const ok=valid && (s.phase==='R'?s.egress_attempts===0 && s.posts===0 && s.intercepts_registered===true && s.internet_enabled_config===false:
          s.posts===1 && s.egress_attempts===1 && s.usage && s.finish_reason==='stop' && outputHash &&
          proof.output_sha256===outputHash);
        const status=ok?(s.phase==='R'?'ORIGINAL_AGENT_PROCESS_BOUNDARY_PASS_NO_INFERENCE':'REAL_MERLIN_TURN_COMPLETED'):'RUNTIME_FAILURE';
        await tx.put('run',{...s,status,proof,container_stopped:true,frames:transcript?.frames??[],
          output:ok && s.phase==='I'?transcript.output:null});
        await tx.deleteAlarm();
      });
    }
    return this.result();
  }
  async alarm(){await this.finish(null);}
}
export default {fetch:deny};
