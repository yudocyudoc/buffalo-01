import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const bridge=JSON.parse(readFileSync(new URL('./wrangler.private-bridge.jsonc',import.meta.url),'utf8'));
const origin=JSON.parse(readFileSync(new URL('./wrangler.private-origin.jsonc',import.meta.url),'utf8'));
const handoff='f9c4db4e-aa31-4b2a-921e-201a5a79fd37';
const runtime='a8b1ad0c02d5c3367bd24962e8fd36d277a8135d';
const image='registry.cloudflare.com/e0cb52526a69c0f48f001901a5b9a640/buffalo-private-origin@sha256:9db33d0be768d4f70e3dfed21b87b0d048f9a5a63739b8301b324deab020ec1d';
test('private bridge cannot expose a public route, change target or attach another DB',()=>{
 assert.equal(bridge.name,'buffalo-original-ws-bridge-lab');
 assert.equal(bridge.main,'../../workers/buffalo-control-plane/original-ws-bridge-lab.mjs');
 assert.equal(bridge.workers_dev,false);
 assert.equal(bridge.preview_urls,false);
 for(const key of ['route','routes','triggers','unsafe','assets'])assert.equal(key in bridge,false);
 assert.deepEqual(bridge.services,[{
  binding:'BUFFALO_ORIGIN',service:'buffalo-private-origin-router-lab'
 }]);
 assert.deepEqual(bridge.d1_databases,[{
  binding:'DB',database_name:'buffalo-control-plane-race-lab-20261121',
  database_id:'d1e23807-b076-4c36-8785-7b423fc41614'
 }]);
 assert.deepEqual(bridge.vars,{
  BUFFALO_WS_LAB_MODE:'HANDSHAKE_ONLY_NO_AGENT_PROCESS',
  BUFFALO_LAB_HANDOFF_ID:handoff,
  BUFFALO_RUNTIME_COMMIT_SHA:runtime
 });
 for(const k of ['BUFFALO_WS_LAB_BEARER','BUFFALO_ORIGIN_AUTH_KEY','BUFFALO_ORIGIN_UPGRADE_TOKEN']){
  assert.equal(k in bridge.vars,false,'secret must never become plaintext var');
 }
});
test('bridge handoff is pinned to exact prepared OCI runtime and model',()=>{
 assert.equal(origin.workers_dev,false);
 assert.equal(origin.preview_urls,false);
 assert.equal(origin.name,bridge.services[0].service);
 assert.equal(origin.vars.BUFFALO_ORIGIN_COMMIT_SHA,bridge.vars.BUFFALO_RUNTIME_COMMIT_SHA);
 assert.equal(origin.vars.BUFFALO_ORIGIN_MODE,bridge.vars.BUFFALO_WS_LAB_MODE);
 assert.equal(origin.vars.BUFFALO_ORIGIN_MODEL_SHA256,
  '57fed6310be45c10c263aecb796eeb72f993b318c5bc770013ff35e014cb4f39');
 assert.equal(origin.containers[0].images.base.image,image);
 assert.equal(origin.containers[0].scheduling_policy,'durable_object');
 assert.equal(origin.durable_objects.bindings[0].name,'BUFFALO_CONTAINER');
 assert.equal('max_instances' in origin.containers[0],false);
});
