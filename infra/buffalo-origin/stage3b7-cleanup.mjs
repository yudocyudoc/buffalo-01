/**
 * Stage 3B-7: read-only post-restore verification for GitHub Actions.
 * A real handshake may finish before Cloudflare's 60s inactivity shutdown.
 * Testably wait for zero instances without sleeping when already idle.
 */
import assert from 'node:assert/strict';

const EXPECTED_ORIGIN_BINDINGS=[
 'BUFFALO_CONTAINER','BUFFALO_ORIGIN_MODE',
 'BUFFALO_ORIGIN_COMMIT_SHA','BUFFALO_ORIGIN_MODEL_SHA256'
].sort();
const EXPECTED_BRIDGE_BINDINGS=['DB'];

export async function verifyStage3B7Restored({
 read,
 now=Date.now,
 sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
 log=message=>console.log(message),
 maxWaitMs=120_000,
 intervalMs=5_000
}) {
 if(typeof read!=='function'||typeof now!=='function'||typeof sleep!=='function')
  throw Error('STAGE3B7_CLEANUP_INVALID_DEPENDENCIES');
 if(!Number.isInteger(maxWaitMs)||maxWaitMs<0||maxWaitMs>120_000||
    !Number.isInteger(intervalMs)||intervalMs<1)
  throw Error('STAGE3B7_CLEANUP_INVALID_BOUNDS');
 const [origin,bridge,originSchedules,bridgeSchedules]=await Promise.all([
  read('/workers/scripts/buffalo-private-origin-router-lab/settings'),
  read('/workers/scripts/buffalo-original-ws-bridge-lab/settings'),
  read('/workers/scripts/buffalo-private-origin-router-lab/schedules'),
  read('/workers/scripts/buffalo-original-ws-bridge-lab/schedules')
 ]);
 assert.deepEqual(origin?.bindings?.map(x=>x.name).sort(),EXPECTED_ORIGIN_BINDINGS,
  'STAGE3B7_ORIGIN_BINDINGS_NOT_RESTORED');
 assert.deepEqual(bridge?.bindings?.map(x=>x.name),EXPECTED_BRIDGE_BINDINGS,
  'STAGE3B7_BRIDGE_BINDINGS_NOT_RESTORED');
 assert.deepEqual(originSchedules?.schedules,[],'STAGE3B7_ORIGIN_CRON_NOT_REMOVED');
 assert.deepEqual(bridgeSchedules?.schedules,[],'STAGE3B7_BRIDGE_CRON_NOT_REMOVED');
 log('STAGE3B7_ORIGIN_AND_BRIDGE_CRON_BINDINGS_RESTORED');
 const deadline=now()+maxWaitMs;
 let last='';
 for(;;){
  const [apps,usage]=await Promise.all([
   read('/containers/applications'),read('/containers/usage')
  ]);
  assert.equal(apps?.length,1,'STAGE3B7_UNEXPECTED_CONTAINER_APPLICATIONS');
  assert.equal(apps[0]?.name,'buffalo-private-origin-lab','STAGE3B7_WRONG_CONTAINER_APPLICATION');
  const snapshot={
   active:apps[0]?.health?.instances?.active,
   starting:apps[0]?.health?.instances?.starting,
   usage:usage?.usage?.instances
  };
  for(const [name,count] of Object.entries(snapshot))
   assert.ok(Number.isInteger(count)&&count>=0,
    'STAGE3B7_INVALID_CONTAINER_'+name.toUpperCase());
  const state=JSON.stringify(snapshot);
  if(state!==last){
   log('STAGE3B7_CONTAINER_SHUTDOWN_POLL '+state);
   last=state;
  }
  if(snapshot.active===0&&snapshot.starting===0&&snapshot.usage===0){
   log('STAGE3B7_ZERO_CONTAINERS_ZERO_CRON_RESTORED');
   return snapshot;
  }
  const remaining=deadline-now();
  if(remaining<=0)
   throw Error('STAGE3B7_CONTAINER_SHUTDOWN_TIMEOUT_120S last='+state);
  await sleep(Math.min(intervalMs,remaining));
 }
}
