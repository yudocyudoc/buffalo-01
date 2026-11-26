import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {computeLtmFacts,checkLtmClaim} from './ltm-fidelity.mjs';
import {fidelityBaseline} from './ltm-fidelity-baseline.mjs';

test('eight historical runs retain two independently annotated output surfaces', () => {
  const rows = fidelityBaseline();
  assert.equal(new Set(rows.map(row => row.run_id)).size,8);
  assert.equal(new Set(rows.map(row => row.name + '/' + row.surface)).size,16);
  for (const row of rows) assert.equal(row.status,row.expected,JSON.stringify(row));
  const late = rows.filter(row => row.name === 'maibab' && row.claim.start === 1947);
  assert.equal(late.length,2);
  for (const row of late) {
    assert.equal(row.observed.time,1975);
    assert.deepEqual(row.observed.loops.toSorted(),['P0/B1','P0/B6']);
  }
});

test('reconstructed coalitions agree with the archived accepted feedback at every saved sample', () => {
  const cases = JSON.parse(gunzipSync(readFileSync(new URL('./evidence/ltm-fidelity/corpus.json.gz',import.meta.url))));
  for (const {name,series,evidence,feedback} of cases) {
    const facts = computeLtmFacts(series,evidence);
    for (const [partition,periods] of facts.periods) {
      for (const t of series.time) {
        const expected = feedback.dominantLoopsByPeriod.filter(p =>
          p.partition === partition && p.startTime <= t && t <= p.endTime);
        assert.ok(expected.length <= 1,name);
        const matched = periods.find(p => p.start <= t && t <= p.end);
        assert.deepEqual(matched.loops.toSorted(),(expected[0]?.dominantLoops ?? []).toSorted(),name + ' @ ' + t);
      }
    }
  }
});

test('ties, missing scores, inactive cycles, ambiguous times and unsupported interpretations', () => {
  const time = [0,0.25,0.5,0.75];
  const series = {time, stock:[2,1,1,3]};
  const evidence = {mode:'exhaustive',time,loops:[
    {id:'b1',partition:0,polarity:'B',signed:[0,-1,null,-1]},
    {id:'r1',partition:0,polarity:'R',signed:[0,0,0,0]},
    {id:'r2',partition:null,polarity:'R',signed:null},
  ]};
  const facts = computeLtmFacts(series,evidence);
  const check = claim => checkLtmClaim(facts,claim);
  assert.deepEqual(facts.variables.get('stock').min,{value:1,times:[0.25,0.5]});
  assert.equal(check({kind:'min',variable:'stock',at:0.5,value:1}).status,'supported');
  assert.equal(check({kind:'value',variable:'stock',at:0,value:2,timeDecimals:0}).reason,'ambiguous_time');
  assert.equal(check({kind:'value',variable:'stock',at:0.125,value:2}).reason,'time_off_grid');
  assert.equal(check({kind:'active',loop:'P0/R1',value:false}).status,'supported');
  assert.equal(check({kind:'active',loop:'Pnull/R2',value:false}).status,'unverified');
  assert.equal(check({kind:'active',loop:'P0/B1',value:true}).status,'supported');
  const coalition = {kind:'dominance',partition:0,start:0.25,end:0.75,loops:['P0/B1']};
  assert.equal(check(coalition).status,'unverified');
  assert.equal(check({...coalition,loops:['P0/R1']}).status,'contradicted');
  assert.equal(check({...coalition,start:0,end:0,loops:[]}).status,'supported');
  assert.equal(check({kind:'mechanism'}).status,'unverified');
  const partial = computeLtmFacts(series,{...evidence,mode:'sampled'});
  assert.equal(checkLtmClaim(partial,coalition).status,'unverified');
  assert.throws(() => computeLtmFacts(series,{...evidence,time:[1,2,3,4]}),/grid/);
});
