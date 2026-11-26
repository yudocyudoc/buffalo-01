import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseNarrative,validNarrative} from './run-narrative.mjs';
import {captureNarrativeAttempt} from './narrative-attempt.mjs';
import {checkpointNarrativeAttempt} from './remote-ltm-operator.mjs';
import {digest} from './provider-wire.mjs';

const feedback={feedbackLoops:[{identifier:'P0/B1'},{identifier:'P1/B1'}]};
const row=(identifier,name='Name',description='Description')=>({identifier,name,description});
const result=(feedbackLoops)=>({output:{textContent:'A narrative.'},feedbackLoops});
const codes=d=>d.issues.map(x=>x.code);
test('contract reports missing, unexpected, duplicate, invalid fields and exact paths without relaxing acceptance',()=>{
 const valid=result([row('P1/B1'),row('P0/B1')]);
 assert(validNarrative(valid,feedback));assert(diagnoseNarrative(valid,feedback).valid);
 const bad=result([row('P0/B1',' ',' '),row('P0/B1'),row('B1')]);
 const d=diagnoseNarrative(bad,feedback);
 assert(!d.valid);assert(!validNarrative(bad,feedback));
 assert.equal(d.expectedCount,2);assert.equal(d.receivedCount,3);
 for(const code of ['LOOP_COUNT_MISMATCH','MISSING_OR_EMPTY_NAME','MISSING_OR_EMPTY_DESCRIPTION','DUPLICATE_IDENTIFIER','UNEXPECTED_IDENTIFIER','MISSING_IDENTIFIER'])
  assert(codes(d).includes(code),code);
 assert(d.issues.some(i=>i.path==='feedbackLoops[0].name'&&i.identifier==='P0/B1'));
 assert(d.issues.some(i=>i.code==='MISSING_IDENTIFIER'&&i.identifier==='P1/B1'));
 for(const value of [null,{},result([null,row(42)]),{...valid,output:{textContent:' '}}])
  assert(!validNarrative(value,feedback));
 assert(codes(diagnoseNarrative({},feedback)).includes('EXPECTED_LOOP_ARRAY'));
 assert(codes(diagnoseNarrative(result([null,row(42)]),feedback)).includes('INVALID_IDENTIFIER_TYPE'));
});
test('bounded issue reporting never turns an invalid output into an accepted one',()=>{
 const bad=result(Array.from({length:1000},()=>row('x'.repeat(300),'','')));
 const d=diagnoseNarrative(bad,feedback);
 assert.equal(d.issues.length,128);assert(d.omittedIssueCount>0);assert(!d.valid);
 assert(d.issues.some(i=>i.identifier_truncated===true&&i.identifier.length===256));
});
test('malformed tool JSON and non-text result are captured exactly, with no save attempt',async()=>{
 for(const [message,error,kind,raw] of [
  [{callId:'bad-json',result:[{text:'{\ninvalid'}]},'INVALID_NATIVE_NARRATIVE_JSON','tool_text','{\ninvalid'],
  [{callId:'bad-shape',result:[{type:'other'}]},'INVALID_NATIVE_NARRATIVE_TOOL_RESULT','tool_result_json','[{"type":"other"}]']
 ]){
  let attempt,checkpoint,saves=0;
  const selected={feedback:{content:feedback},saveNarrative(){saves++;throw Error('must not save')}};
  await assert.rejects(captureNarrativeAttempt({message,selected,narrativeId:'id',prompt:'Explain',
   onCapture(x){attempt=x;checkpoint=structuredClone(x);}}),new RegExp(error));
  assert.equal(checkpoint.status,'CAPTURED');assert.equal(attempt.raw,raw);
  assert.equal(attempt.raw_kind,kind);assert.equal(attempt.raw_sha256,await digest(raw));
  assert.equal(attempt.error,error);assert.equal(attempt.status,'REJECTED');assert.equal(saves,0);
 }
});
test('private D1 checkpoint precedes save; accepted record keeps hash; failed save retains original bytes',async()=>{
 const raw=JSON.stringify(result([row('P0/B1'),row('P1/B1')]),null,2);
 const claim={probe_id:'probe',run_id:'run',status:'CLAIMED'},evidence={simulation_id:'sim',evidence_sha256:'a'.repeat(64)};
 let writes=[],attempt,saves=0,fail=false;
 const db={prepare(sql){assert.match(sql,/SET receipt_json=\? WHERE probe_id=\? AND run_id=\? AND status=\?/);
  return{bind(...args){return{run:async()=>{writes.push(args);return{meta:{changes:1}}}}}}}};
 const selected={feedback:{content:feedback},async saveNarrative(id,prompt,value){
  saves++;assert.equal(JSON.parse(writes.at(-1)[0]).narrative_attempt.raw,raw);
  assert.deepEqual(value,JSON.parse(raw));if(fail)throw Error('NATIVE_NARRATIVE_SAVE_FAILED_409');return value;
 }};
 const options={message:{callId:'actual-tool',result:[{text:raw}]},selected,narrativeId:'id',prompt:'Explain',
  async onCapture(x){attempt=x;await checkpointNarrativeAttempt(db,claim,evidence,x);}};
 assert.deepEqual(await captureNarrativeAttempt(options),JSON.parse(raw));
 assert.equal(attempt.status,'ACCEPTED');assert.equal(attempt.raw,undefined);
 assert.equal(attempt.raw_sha256,await digest(raw));assert.deepEqual(writes[0].slice(1),['probe','run','CLAIMED']);
 assert.equal(JSON.parse(writes[0][0]).simulation_id,'sim');
 fail=true;await assert.rejects(captureNarrativeAttempt(options),/SAVE_FAILED_409/);
 assert.equal(attempt.status,'SAVE_FAILED');assert.equal(attempt.raw,raw);assert.equal(attempt.diagnostic.valid,true);
 assert.equal(saves,2);
 const failingDB={prepare(){return{bind(){return{run:async()=>({meta:{changes:0}})}}}}};
 await assert.rejects(captureNarrativeAttempt({...options,onCapture:x=>checkpointNarrativeAttempt(failingDB,claim,evidence,x)}),/CAPTURE_CHECKPOINT_FAILED/);
 assert.equal(saves,2);
});
