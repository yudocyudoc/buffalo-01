import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {claimScheduledEntry,markStage,safeCode,FINAL_PHASES,PROBE_ID} from './bridge-diagnostics.mjs';

function db(){
 const phases=new Map();
 return {
  phases,
  prepare(sql){
   assert.match(sql,/INSERT INTO buffalo_stage3b7_private_bridge_events/);
   assert.match(sql,/ON CONFLICT\(probe_id,phase\) DO NOTHING/);
   return {bind(id,phase,code){
    assert.equal(id,PROBE_ID);
    return {async run(){
     if(phases.has(phase))return {success:true,meta:{changes:0}};
     phases.set(phase,code);
     return {success:true,meta:{changes:1}};
    }};
   }};
  }
 };
}
const source=p=>readFileSync(new URL(p,import.meta.url),'utf8');

test('first cron writes exactly one immutable SCHEDULED_ENTERED admission marker',async()=>{
 const x=db();
 assert.equal(await claimScheduledEntry(x),true);
 assert.equal(await claimScheduledEntry(x),false);
 assert.equal(x.phases.size,1);
 assert.equal(x.phases.has('SCHEDULED_ENTERED'),true);
 await markStage(x,'CLAIM_READ_REQUESTED');
 await markStage(x,'CLAIM_READ_REQUESTED');
 assert.equal(x.phases.size,2);
});
test('missing D1 acknowledgement or changes metadata fails CLOSED',async()=>{
 for(const value of [{success:true,meta:{}},{success:false,meta:{changes:1}},
                        {success:true,meta:{changes:2}}]){
  const x={prepare(){return {bind(){return {run:async()=>value}}}}};
  await assert.rejects(()=>claimScheduledEntry(x),/BRIDGE_D1_ENTRY_ADMISSION/);
 }
});
test('phase codes are allowlisted; rejects injection and secrets',async()=>{
 const x=db();
 await assert.rejects(()=>markStage(x,'SCHEDULED_ENTERED'),/BAD_PHASE/);
 await assert.rejects(()=>markStage(x,'chat'),/BAD_PHASE/);
 await assert.rejects(()=>markStage(x,'PREFLIGHT_FAILED','Bearer secret123'),/BAD_CODE/);
 assert.equal(safeCode(new Error('x-buffalo-origin-token abc123')),'UNCLASSIFIED_ERROR');
 assert.equal(safeCode(new Error('BRIDGE_PROBE_SOURCE_DENIED')),'BRIDGE_PROBE_SOURCE_DENIED');
 for(const phase of FINAL_PHASES)await markStage(x,phase);
 assert.equal(x.phases.size,FINAL_PHASES.length);
});
test('manual D1 migration precreates BOTH independent tables and primary-key gates',()=>{
 const sql=source('../../migrations/control-plane/lab/0003_stage3b7_observability.sql');
 assert.match(sql,/CREATE TABLE IF NOT EXISTS buffalo_stage3b7_private_bridge_receipts/);
 assert.match(sql,/CREATE TABLE IF NOT EXISTS buffalo_stage3b7_private_bridge_events/);
 assert.match(sql,/PRIMARY KEY\(probe_id,phase\)/);
 assert.doesNotMatch(sql,/INSERT INTO|UPDATE |DELETE FROM|DROP TABLE|GRANT /);
});
test('the Bridge checks persisted DO claim AFTER cron entry but BEFORE any prepare RPC',()=>{
 const client=source('./bridge-one-shot.mjs');
 const origin=source('./bridge-probe-controller.mjs');
 const handler=client.slice(client.indexOf('async scheduled(_event,env)'));
 const entry=handler.indexOf('claimScheduledEntry(env.DB)');
 const lookup=handler.indexOf('readBridgeOnce()');
 const prepare=handler.indexOf('runPrivateBridgeOnce(env,advance)');
 assert.ok(entry>=0&&lookup>entry&&prepare>lookup);
 assert.match(handler,/if\(!entered\)return/);
 assert.match(handler,/DO_CLAIM_ALREADY_USED/);
 assert.match(origin,/async readBridgeOnce\(\)\{/);
 assert.match(origin,/getByName\(INSTANCE\)\.readBridgeOnce\(\)/);
 assert.match(origin,/UNRECOGNIZED_CLAIM/);
 assert.doesNotMatch(origin,/CREATE TABLE IF NOT EXISTS buffalo_stage3b7_private_bridge_receipts/);
 assert.match(client,/markStage\(env.DB,'REAL_BRIDGE_HANDSHAKE_PASS'\)/);
});
test('manual workflow waits for 17-minute D1 statuses and always restores BOTH Workers',()=>{
 const flow=source('../../.github/workflows/buffalo-stage3b7-one-shot-private-bridge.yml');
 assert.doesNotMatch(flow,/sleep 600/);
 assert.match(flow,/Date\.now\(\)\+17\*60_000/);
 assert.match(flow,/STAGE3B7_CRON_NOT_OBSERVED_WITHIN_17_MINUTES/);
 assert.match(flow,/STAGE3B7_SCHEMA_NOT_PREAPPLIED/);
 assert.match(flow,/STAGE3B7_D1_HTTP_/);
 assert.match(flow,/ALWAYS restore bridge without cron or service binding/);
 assert.match(flow,/ALWAYS restore original private origin without cron/);
 assert.match(flow,/steps\.bridge_arm\.outputs\.cleanup_needed/);
 assert.match(flow,/steps\.origin_arm\.outputs\.cleanup_needed/);
 assert.match(flow,/workflow_dispatch:/);
 assert.doesNotMatch(flow,/^[ ]+push:/m);
});
