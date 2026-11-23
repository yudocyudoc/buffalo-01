import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('./',import.meta.url);
const cfg=JSON.parse(readFileSync(new URL('./wrangler.private-probe.jsonc',root),'utf8'));
const src=readFileSync(new URL('./probe-controller.mjs',root),'utf8');
test('private probe has no public ingress, default no cron and no persistent secrets',()=>{
 assert.equal(cfg.name,'buffalo-private-origin-router-lab');
 assert.equal(cfg.main,'./probe-controller.mjs');
 assert.equal(cfg.workers_dev,false);
 assert.equal(cfg.preview_urls,false);
 assert.deepEqual(cfg.triggers,{crons:[]});
 assert.equal('routes' in cfg,false);
 assert.equal('route' in cfg,false);
 assert.equal('secrets' in cfg,false);
 assert.deepEqual(Object.keys(cfg.vars).sort(),[
  'BUFFALO_ORIGIN_MODE','BUFFALO_ORIGIN_COMMIT_SHA','BUFFALO_ORIGIN_MODEL_SHA256',
  'BUFFALO_PROBE_MODE'
 ].sort());
 assert.deepEqual(cfg.d1_databases,[{
  binding:'DB',database_name:'buffalo-control-plane-race-lab-20261121',
  database_id:'d1e23807-b076-4c36-8785-7b423fc41614'
 }]);
 assert.equal(cfg.containers.length,1);
 assert.equal(cfg.containers[0].scheduling_policy,'durable_object');
 assert.equal('max_instances' in cfg.containers[0],false);
 assert.equal(cfg.containers[0].images.base.image,
  'registry.cloudflare.com/e0cb52526a69c0f48f001901a5b9a640/'+
  'buffalo-private-origin@sha256:9db33d0be768d4f70e3dfed21b87b0d048f9a5a63739b8301b324deab020ec1d');
});
test('probe uses DO RPC and one-time durable claim, not HTTP public route',()=>{
 assert.match(src,/async runOneShotProbe\(\)/);
 assert.match(src,/this\.ctx\.storage\.transaction\(/);
 assert.match(src,/buffalo-probe-3b6-once/);
 assert.match(src,/getByName\(INSTANCE\)\.runOneShotProbe\(\)/);
 assert.match(src,/fetch:oldController\.fetch/);
 assert.match(src,/if\(env\.BUFFALO_PROBE_MODE!=='ONE_SHOT_NO_INFERENCE'\)return/);
 assert.match(src,/crypto\.getRandomValues\(/);
 assert.match(src,/enableInternet:false/);
 assert.match(src,/instance:'lite'/);
 assert.match(src,/setInactivityTimeout\(60_000\)/);
 assert.match(src,/SOURCE_ATTESTED/);
 assert.match(src,/COUNT\(\*\) AS n FROM buffalo_full_live_grants/);
 assert.match(src,/buffalo_stage3b6_private_probe_receipts/);
 assert.match(src,/type:'disconnect'/);
 assert.equal(src.includes('WorkerSpawner.spawn('),false);
 assert.equal(src.includes('runAgent('),false);
});
test('scheduled RPC receipt persistence is executable, not a commented-out string',()=>{
 const scheduled=src.slice(src.indexOf('async scheduled(_event,env){'));
 assert.ok(scheduled.startsWith('async scheduled(_event,env){'));
 assert.equal(scheduled.includes(String.raw`\\n`),false,
  'literal backslash-n must not hide the D1 receipt block inside a comment');
 const code=scheduled.split('\n').map(line=>line.split('//')[0]).join('\n');
 assert.match(code,/if\(receipt\.status!=='ALREADY_CLAIMED_NO_RETRY'\)\{/);
 assert.match(code,/await env\.DB\.prepare\('INSERT INTO buffalo_stage3b6_private_probe_receipts '/);
 assert.match(code,/console\.log\('BUFFALO_ONE_SHOT_SCHEDULED '/);
});

test('generated model, if present, matches original pinned SHA without simulation',()=>{
 let content;
 try{content=readFileSync(new URL('./probe-initial-model.json',root),'utf8')}
 catch(e){if(e.code==='ENOENT')return;throw e}
 const model=JSON.parse(content);
 assert.ok(Array.isArray(model.variables)&&Array.isArray(model.relationships));
 assert.equal(createHash('sha256').update(JSON.stringify(model)).digest('hex'),
  '57fed6310be45c10c263aecb796eeb72f993b318c5bc770013ff35e014cb4f39');
});
