import test from 'node:test';
import assert from 'node:assert/strict';
import {run,evidence,check} from './inventory.mjs';
import {nativeSelection} from '../../../infra/full-runtime/dominance-evidence.mjs';
test('known fixture: two synthetic surfaces and actual C4 anchors preserve text and expected verdicts',()=>{
 const r=run();
 for(const surface of [...r.synthetic,r.real])for(const row of surface.rows){assert.equal(row.status,row.expected,JSON.stringify(row));assert.equal(surface.text_preserved.slice(row.start,row.end),row.anchor);assert.ok(row.witness)}
 assert.ok(r.real.unannotated_spans.length>0);
 assert.equal(r.synthetic[0].text_sha256,r.synthetic[1].text_sha256);
 assert.deepEqual(r.synthetic[0].rows,r.synthetic[1].rows);
 assert.deepEqual(new Set(r.native_f1_f3.map(x=>x.surface)),new Set(['narrative','final']));
 for(const row of r.native_f1_f3)assert.equal(row.status,row.expected);
});
test('exact analytic modal properties and independent Euler reconstruction',()=>{
 const e=evidence();
 assert.ok(Math.abs(e.modal.period-15.721616)<1e-6);
 assert.ok(Math.abs(e.modal.ratio-.269784)<1e-6);
 assert.ok(Math.abs(e.modal.eulerPeriod-15.643019)<1e-6);
 assert.deepEqual(e.extrema.slice(0,4).map(x=>x.t),[5.625,13.8125,21.4375,29.3125]);
 [87.483283,104.783137,96.882957,101.543053].forEach((x,i)=>assert.ok(Math.abs(e.extrema[i].I-x)<1e-5));
 assert.equal(check(e,{kind:'historical_stock_period',value:e.modal.period}).status,'unverified');
});
test('native tie convention differs from inactive and historical ambiguity remains explicit',()=>{
 const l=[{identifier:'P0/B1',polarity:'B',signed:[-.5,0]},{identifier:'P0/B2',polarity:'B',signed:[-.5,0]}];
 assert.deepEqual(nativeSelection(l,0),['P0/B1']);
 assert.deepEqual(nativeSelection(l,1),[]);
});
