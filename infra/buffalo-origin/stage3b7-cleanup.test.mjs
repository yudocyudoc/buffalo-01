import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyStage3B7Restored} from './stage3b7-cleanup.mjs';

const ORIGIN=[
 'BUFFALO_CONTAINER','BUFFALO_ORIGIN_MODE',
 'BUFFALO_ORIGIN_COMMIT_SHA','BUFFALO_ORIGIN_MODEL_SHA256'
];
const healthyConfig={
 '/workers/scripts/buffalo-private-origin-router-lab/settings':
  {bindings:ORIGIN.map(name=>({name}))},
 '/workers/scripts/buffalo-original-ws-bridge-lab/settings':
  {bindings:[{name:'DB'}]},
 '/workers/scripts/buffalo-private-origin-router-lab/schedules':{schedules:[]},
 '/workers/scripts/buffalo-original-ws-bridge-lab/schedules':{schedules:[]}
};
function fake({
 counts=[{active:0,starting:0,usage:0}],extra={},
 maxWaitMs=120_000,intervalMs=5_000
}={}){
 let time=0,reads=0,sleeps=0;const log=[];
 const read=async path=>{
  if(Object.hasOwn(healthyConfig,path))return {...healthyConfig[path],...extra[path]};
  if(path!=='/containers/applications'&&path!=='/containers/usage')
   throw Error('Unexpected query '+path);
  const snapshot=counts[Math.min(reads,counts.length-1)];
  if(path==='/containers/applications')return [{
   name:'buffalo-private-origin-lab',
   health:{instances:{active:snapshot.active,starting:snapshot.starting}}
  }];
  reads++;
  return {usage:{instances:snapshot.usage}};
 };
 const args={read,now:()=>time,sleep:async ms=>{sleeps++;time+=ms},
  log:x=>log.push(x),maxWaitMs,intervalMs};
 return {args,log,stats:()=>({time,reads,sleeps})};
}
test('already idle restores immediately without unnecessary 60s delay',async()=>{
 const x=fake();
 const r=await verifyStage3B7Restored(x.args);
 assert.deepEqual(r,{active:0,starting:0,usage:0});
 assert.deepEqual(x.stats(),{time:0,reads:1,sleeps:0});
 assert.ok(x.log.some(x=>x.includes('STAGE3B7_ZERO_CONTAINERS')));
});
test('a valid 3B-7 result may precede shutdown; poll until all three counters are zero',async()=>{
 const x=fake({counts:[
  {active:1,starting:0,usage:1},
  {active:0,starting:1,usage:1},
  {active:0,starting:0,usage:1},
  {active:0,starting:0,usage:0}
 ]});
 await verifyStage3B7Restored(x.args);
 assert.deepEqual(x.stats(),{time:15_000,reads:4,sleeps:3});
});
test('still active at 120 seconds fails, never waiting longer than the deadline',async()=>{
 const x=fake({counts:[{active:1,starting:0,usage:1}]});
 await assert.rejects(()=>verifyStage3B7Restored(x.args),
  /STAGE3B7_CONTAINER_SHUTDOWN_TIMEOUT_120S/);
 assert.equal(x.stats().time,120_000);
 assert.equal(x.stats().reads,25);
});
test('a bad restored cron or binding fails immediately, without polling Containers',async()=>{
 for(const [path,value] of [
  ['/workers/scripts/buffalo-original-ws-bridge-lab/schedules',{schedules:[{cron:'* * * * *'}]}],
  ['/workers/scripts/buffalo-original-ws-bridge-lab/settings',{bindings:[{name:'DB'},{name:'BUFFALO_ORIGIN'}]}]
 ]){
  const x=fake({extra:{[path]:value}});
  await assert.rejects(()=>verifyStage3B7Restored(x.args),/NOT_REMOVED|NOT_RESTORED/);
  assert.deepEqual(x.stats(),{time:0,reads:0,sleeps:0});
 }
});
test('missing or invalid telemetry fails closed',async()=>{
 const x=fake({counts:[{active:0,starting:undefined,usage:0}]});
 await assert.rejects(()=>verifyStage3B7Restored(x.args),
  /STAGE3B7_INVALID_CONTAINER_STARTING/);
});
test('bound cannot exceed two minutes',async()=>{
 const x=fake({maxWaitMs:120_001});
 await assert.rejects(()=>verifyStage3B7Restored(x.args),
  /STAGE3B7_CLEANUP_INVALID_BOUNDS/);
});
