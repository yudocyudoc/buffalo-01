import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const o=JSON.parse(src('./wrangler.private-origin-bridge-probe.jsonc'));
const b=JSON.parse(src('./wrangler.private-bridge-probe.jsonc'));
const restore=JSON.parse(src('./wrangler.private-bridge-restored.jsonc'));
const origin=src('./bridge-probe-controller.mjs');
const client=src('./bridge-one-shot.mjs');

test('all 3B7 configs remain private and unscheduled by default',()=>{
 for(const x of [o,b,restore]){
  assert.equal(x.workers_dev,false);
  assert.equal(x.preview_urls,false);
  assert.deepEqual(x.triggers,{crons:[]});
  assert.equal('routes' in x,false);
  assert.equal('route' in x,false);
  assert.equal('secrets' in x,false);
 }
 assert.equal(o.name,'buffalo-private-origin-router-lab');
 assert.equal(b.name,'buffalo-original-ws-bridge-lab');
 assert.equal(b.services.length,1);
 assert.deepEqual(b.services[0],{
  binding:'BUFFALO_ORIGIN',service:o.name,entrypoint:'BridgeProbePort'
 });
 assert.equal(restore.name,b.name);
 assert.equal(restore.main,'../../workers/buffalo-control-plane/original-ws-bridge-lab.mjs');
 assert.equal(restore.services,undefined);
 assert.equal(restore.vars,undefined);
 assert.deepEqual(restore.d1_databases.map(v=>v.binding),['DB']);
 assert.equal(o.d1_databases[0].database_id,b.d1_databases[0].database_id);
 assert.equal(o.containers.length,1);
 assert.equal(o.containers[0].scheduling_policy,'durable_object');
 assert.equal(o.containers[0].images.base.image,
  'registry.cloudflare.com/e0cb52526a69c0f48f001901a5b9a640/'+
  'buffalo-private-origin@sha256:9db33d0be768d4f70e3dfed21b87b0d048f9a5a63739b8301b324deab020ec1d');
});
test('origin uses a named private RPC, persistent claim before start, and only fixed Container',()=>{
 assert.match(origin,/export class BridgeProbePort extends WorkerEntrypoint/);
 assert.match(origin,/export default \{fetch:original\.fetch\}/);
 const claim=origin.indexOf('this.ctx.storage.transaction(');
 const start=origin.indexOf('this.ctx.container.start(');
 assert.ok(claim>=0&&start>claim);
 assert.match(origin,/buffalo-probe-3b7-once/);
 assert.match(origin,/instance:'lite',enableInternet:false/);
 assert.match(origin,/setInactivityTimeout\(60_000\)/);
 assert.match(origin,/sourceAllowsProbe\(this.env\)/);
 assert.match(origin,/this\.bridgeKeys=\{auth,upgrade,used:false/);
 assert.match(origin,/keys\.used=true/);
 assert.match(origin,/buffalo_stage3b7_private_bridge_receipts/);
 assert.doesNotMatch(origin,/BUFFALO_WS_LAB_BEARER\s*:/);
 assert.doesNotMatch(origin,/WorkerSpawner\.spawn\(/);
});
test('bridge uses original handshake gate through original bridge, not a new unrestricted proxy',()=>{
 assert.match(client,/handleOriginalWorkerBridge\(request,sessionEnv\)/);
 assert.match(client,/BUFFALO_ORIGIN\.prepareBridgeOnce\(\)/);
 assert.match(client,/BUFFALO_ORIGIN\.finishBridgeOnce\(receipt\)/);
 assert.match(client,/session_created/);
 assert.match(client,/initialize_session/);
 assert.match(client,/session_ready/);
 assert.match(client,/disconnect/);
 assert.match(client,/REAL_BRIDGE_HANDSHAKE_PASS/);
 assert.doesNotMatch(client,/runAgent\(|select_agent|type:'chat'/);
 const fallback=client.slice(client.indexOf('export default {'));
 assert.match(fallback,/fetch\(\)\{return new Response\('Not Found',\{status:404\}\)\}/);
});
test('scheduled-only bridge uses original source and zero grants before requesting start',()=>{
 const pre=client.indexOf('await bridgePreflight(env)');
 const start=client.indexOf('env.BUFFALO_ORIGIN.prepareBridgeOnce()');
 assert.ok(pre>=0&&start>pre);
 assert.match(client,/FROM buffalo_full_handoffs h JOIN buffalo_full_source_attestations a/);
 assert.match(client,/SELECT COUNT\(\*\) AS n FROM buffalo_full_live_grants/);
 assert.match(client,/Number\(row\.execution_allowed\)!==0/);
 assert.match(client,/Number\(row\.proof_execution_allowed\)!==0/);
 assert.match(client,/BUFFALO_BRIDGE_PROBE_MODE!==PING/);
 assert.match(client,/if\(granted\?\.status!=='READY'\)/);
});
