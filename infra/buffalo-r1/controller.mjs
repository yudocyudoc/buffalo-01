import {DurableObject} from 'cloudflare:workers';
import {ID} from './receipt.mjs';
import {deny,validConfig,runOneShot,cleanupAlarm} from './one-shot.mjs';
export class BuffaloNamespaceProbe extends DurableObject {
 fetch(){return deny()}
 async runOnce(){return runOneShot(this.ctx,this.env)}
 async alarm(){await cleanupAlarm(this.ctx,this.env)}
}
export default {
 fetch(){return deny()},
 async scheduled(_event,env){
  if(!validConfig(env))return;
  // Fixed DO identity; no external route, input or public ingress.
  await env.R1_CONTAINER.getByName(ID).runOnce();
 }
};
