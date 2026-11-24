import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {configs,requireEmptySchema} from './manual.mjs';
import {ARM_WINDOW_MS,OBSERVE_GRACE_MS,CLEANUP_WAIT_MS,EXPIRED,armExpiry,validArmExpiry,observationDeadline} from './timing.mjs';
const template=JSON.parse(readFileSync(new URL('./wrangler.template.json',import.meta.url),'utf8'));
const sha='a'.repeat(40),ref='registry.cloudflare.com/e0cb52526a69c0f48f001901a5b9a640/buffalo-namespace-r1@sha256:'+'b'.repeat(64);
test('dry-run does not consume live arm window; disabled never armed',()=>{
 const dry=configs(template,sha,ref);
 assert.equal(dry.armed.vars.R1_EXPIRES_AT,EXPIRED);assert.equal(dry.disabled.vars.R1_EXPIRES_AT,EXPIRED);
 const now=Date.parse('2026-11-24T00:00:00Z')+45*60_000;
 const expires=armExpiry(now),actual=configs(template,sha,ref,expires);
 assert.equal(Date.parse(actual.armed.vars.R1_EXPIRES_AT)-now,ARM_WINDOW_MS);
 assert.equal(actual.disabled.vars.R1_EXPIRES_AT,EXPIRED);assert.deepEqual(actual.disabled.triggers.crons,[]);
});
test('arm covers propagation and next tick; observation and cleanup separate',()=>{
 const now=Date.now(),expires=armExpiry(now);
 assert(ARM_WINDOW_MS>=20*60_000);assert(CLEANUP_WAIT_MS>=16*60_000);
 assert(validArmExpiry(expires,now+16*60_000));assert(!validArmExpiry(expires,Date.parse(expires)));
 assert(!validArmExpiry(armExpiry(now+60000),now));
 assert.equal(observationDeadline(expires),Date.parse(expires)+OBSERVE_GRACE_MS);
});
test('preflight rejects absent or nonempty schema',async()=>{
 let calls=0;
 await assert.rejects(requireEmptySchema(async()=>{calls++;return []}),/R1_SCHEMA_MUST_BE_PREAPPLIED_SEPARATELY/);
 assert.equal(calls,1);
 const read=n=>async sql=>sql.includes('sqlite_master')?[{name:'buffalo_stage3b8r1_receipts'}]:[{n}];
 await assert.rejects(requireEmptySchema(read(1)),/R1_PRIOR_EVIDENCE_NO_REPLAY/);
 await requireEmptySchema(read(0));
});
test('workflow requires schema before publish; no DDL; arm after disabled check',()=>{
 const w=readFileSync(new URL('../../.github/workflows/buffalo-stage3b8r1-private-manual.yml',import.meta.url),'utf8');
 assert(!w.includes('d1 execute'));assert(!w.includes('schema.sql'));
 assert(w.indexOf('manual.mjs preflight')<w.indexOf('containers push'));
 assert(w.indexOf('manual.mjs disabled-check')<w.indexOf('manual.mjs arm'));
 assert(w.indexOf('manual.mjs arm')<w.indexOf('manual.mjs observe'));
 assert(w.includes('timeout-minutes: 100'));assert(w.includes('timeout-minutes: 27'));assert(w.includes('timeout-minutes: 18'));
});
