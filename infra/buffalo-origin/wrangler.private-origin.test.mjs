import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const cfg=JSON.parse(readFileSync(new URL('./wrangler.private-origin.jsonc',import.meta.url),'utf8'));
const controller=readFileSync(new URL('./container-controller.mjs',import.meta.url),'utf8');
const ref='registry.cloudflare.com/e0cb52526a69c0f48f001901a5b9a640/buffalo-private-origin@sha256:9db33d0be768d4f70e3dfed21b87b0d048f9a5a63739b8301b324deab020ec1d';
test('private origin matches exact tested and published OCI identity',()=>{
 assert.equal(cfg.name,'buffalo-private-origin-router-lab');
 assert.equal(cfg.main,'./container-controller.mjs');
 assert.equal(cfg.workers_dev,false);
 assert.equal(cfg.preview_urls,false);
 assert.ok(!('routes' in cfg));
 assert.ok(!('route' in cfg));
 assert.ok(!('triggers' in cfg));
 assert.deepEqual(cfg.vars,{
  BUFFALO_ORIGIN_MODE:'HANDSHAKE_ONLY_NO_AGENT_PROCESS',
  BUFFALO_ORIGIN_COMMIT_SHA:'a8b1ad0c02d5c3367bd24962e8fd36d277a8135d',
  BUFFALO_ORIGIN_MODEL_SHA256:'57fed6310be45c10c263aecb796eeb72f993b318c5bc770013ff35e014cb4f39'
 });
 assert.equal('BUFFALO_ORIGIN_AUTH_KEY' in cfg.vars,false);
 assert.equal('BUFFALO_ORIGIN_UPGRADE_TOKEN' in cfg.vars,false);
 assert.equal(cfg.containers.length,1);
 assert.equal(cfg.containers[0].name,'buffalo-private-origin-lab');
 assert.equal(cfg.containers[0].class_name,'BuffaloHandshakeContainer');
 assert.equal(cfg.containers[0].scheduling_policy,'durable_object');
 assert.equal('max_instances' in cfg.containers[0],false);
 assert.match(controller,/const INSTANCE='buffalo-original-handshake-only'/);
 assert.match(controller,/\.getByName\(INSTANCE\)/);
 assert.equal(cfg.containers[0].images.base.image,ref);
 assert.deepEqual(cfg.durable_objects.bindings,[{
  name:'BUFFALO_CONTAINER',class_name:'BuffaloHandshakeContainer'
 }]);
 assert.equal('migrations' in cfg,false);
 assert.deepEqual(cfg.exports,{BuffaloHandshakeContainer:{type:'durable-object',storage:'sqlite'}});
});
test('controller keeps handshake-only, no-internet, lite instance and short inactivity',()=>{
 assert.match(controller,/HANDSHAKE_ONLY_NO_AGENT_PROCESS/);
 assert.match(controller,/enableInternet:false/);
 assert.match(controller,/instance:'lite'/);
 assert.match(controller,/setInactivityTimeout\(60_000\)/);
 assert.match(controller,/keyOk\(request,env\.BUFFALO_ORIGIN_UPGRADE_TOKEN\)/);
 assert.match(controller,/if\(!configReady\(env\)/);
 assert.doesNotMatch(controller,/\/v1\/chat|\.run\(|runAgent\(/);
});
