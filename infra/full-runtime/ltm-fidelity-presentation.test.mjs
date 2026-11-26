import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {prepareFidelityPresentation} from './ltm-fidelity-presentation.mjs';
import {computeLtmFacts,checkLtmClaim} from './ltm-fidelity.mjs';

const runId='cbdb5c99-4dd0-42d5-8de3-c2c127f40248';
const time=[0,.25,.5,.75,1];
const run={revision:1,settings:{timeUnits:'Year'},series:{time,'<stock>':[2,1,1,3,4]}};
const evidence={mode:'exhaustive',time,loops:[
 {id:'b1',partition:0,polarity:'B',signed:[0,-1,-.2,null,-1]},
 {id:'b2',partition:0,polarity:'B',signed:[0,0,-.8,null,0]},
 {id:'r1',partition:1,polarity:'R',signed:[0,1,1,1,1]},
 {id:'u1',partition:null,polarity:'U',signed:null}
]};
const feedback={run_sha256:'a'.repeat(64),source:{evidence_sha256:'b'.repeat(64)}};
const prep=(overrides={})=>prepareFidelityPresentation({runId,run,evidence,feedback,stockNames:['<stock>'],prompt:'Analyze.',...overrides});
test('selected fact references render trusted values and keep all partition transitions and unknown gaps',()=>{
 const p=prep(),answer=p.finalize('<p>BUFFALO_FACTS_V1 '+runId+' F3</p>');
 assert.equal(answer.status,'model_selection_accepted');
 assert.equal(answer.identity.evidence_sha256,feedback.source.evidence_sha256);
 assert(answer.output.includes('&lt;stock&gt;'));
 assert(!answer.output.includes('<stock>'));
 assert(answer.output.includes('minimum: 1 at 0.25, 0.5'));
 assert(answer.output.includes('Partition 0 [0.5, 0.5]: P0/B2'));
 assert(answer.output.includes('Partition 1 [0.25, 1]: P1/R1'));
 assert(answer.unknown.some(x=>x.start===.75&&x.end===.75));
 assert(answer.unknown.some(x=>x.loop==='Pnull/U1'));
 for(const c of answer.claims)assert.equal(checkLtmClaim(computeLtmFacts(run.series,evidence),c.claim).status,'supported');
});
test('malformed, mixed prose, cross-run, duplicate or unknown references cannot escape into factual output',()=>{
 const p=prep();
 for(const raw of [null,'<p>the stock was 999999</p>',
  'BUFFALO_FACTS_V1 '+runId+' F1 F1','BUFFALO_FACTS_V1 '+runId+' F9999',
  'BUFFALO_FACTS_V1 '+runId+' F1 <script>alert(1)</script>',
  '<p>BUFFALO_FACTS_V1 '+runId+' F1</p><p>wrong claim 999999</p>',
  'BUFFALO_FACTS_V1 11111111-1111-4111-8111-111111111111 F1']){
  const a=p.finalize(raw);
  assert.equal(a.status,'deterministic_fallback');
  assert(!a.output.includes('999999')&&!a.output.includes('<script>'));
  assert(a.output.includes('minimum: 1 at 0.25, 0.5'));
  assert(a.output.includes('Partition 0 [0.5, 0.5]: P0/B2'));
 }
});
test('eight archived real outputs replay safely without claiming an accuracy improvement',()=>{
 const cases=JSON.parse(gunzipSync(readFileSync(new URL('./evidence/ltm-fidelity/corpus.json.gz',import.meta.url))));
 assert.equal(cases.length,8);
 for(const c of cases){
  // The archive intentionally contains unstructured historical text. The
  // strict protocol must fall back; this is safety replay, not new LLM output.
  const p=prep({runId:c.run_id,run:{revision:1,settings:{timeUnits:'saved model time'},series:c.series},
    evidence:c.evidence,stockNames:[],prompt:'Analyze saved run.'});
  const answer=p.finalize(c.final);
  assert.equal(answer.status,'deterministic_fallback',c.name);
  const f=computeLtmFacts(c.series,c.evidence);
  for(const row of answer.claims)assert.equal(checkLtmClaim(f,row.claim).status,'supported',c.name);
  const expected=[...f.periods.values()].flat().filter(x=>x.loops!==null).length;
  assert.equal(answer.claims.filter(x=>x.claim.kind==='dominance').length,expected,c.name);
 }
});

test('constant and heavily tied variables use a bounded prompt without losing exact evidence',()=>{
 const grid=Array.from({length:961},(_,i)=>i/16);
 const series={time:grid,...Object.fromEntries(Array.from({length:21},(_,i)=>['constant_'+i,grid.map(()=>i)]))};
 const p=prep({run:{revision:1,settings:{timeUnits:'Month'},series},
   evidence:{time:grid,mode:'exhaustive',loops:[{id:'b1',partition:0,polarity:'B',signed:grid.map((_,i)=>i?-1:0)}]}});
 const a=p.finalize('BUFFALO_FACTS_V1 '+runId+' F3');
 assert.equal(a.status,'model_selection_accepted');
 assert.equal(a.claims.find(x=>x.id==='F3').observed.times.length,961);
 assert(a.output.includes('961 tied saved samples'));
 assert(new TextEncoder().encode(p.message).length<24576);
});
