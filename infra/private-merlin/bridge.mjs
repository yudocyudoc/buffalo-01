import {DurableObject,WorkerEntrypoint} from 'cloudflare:workers';
import {checkTaskKey} from './protocol.mjs';
import {durableStage} from './binding-gateway.mjs';
import {enqueue,readTask,runTask} from './task.mjs';

export class MerlinTask extends DurableObject {
  submit(input){return enqueue(this.ctx.storage,this.env,input);}
  read(key){return readTask(this.ctx.storage,key);}
  alarm(){return runTask(this.ctx.storage,this.env);}
}

export class ArenaMerlin extends WorkerEntrypoint {
  #task(key){
    checkTaskKey(key);
    // One durable attempt per protocol stage, including after a config redeploy.
    return this.env.TASKS.getByName('arena-merlin-v1-'+durableStage(this.env,key.phase));
  }
  submit(input){return this.#task(input).submit(input);}
  read(key){return this.#task(key).read(key);}
}
export default {fetch:()=>new Response(null,{status:404})};
