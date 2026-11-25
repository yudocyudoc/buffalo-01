import {test} from 'node:test';
import assert from 'node:assert/strict';
import pluralize from 'pluralize';
import {CASE_ID,REQUEST,EXPECTED,SCHEMA_SHA256} from './qualitative-smoke-case.mjs';
import {PASS} from './remote-qualitative.mjs';
import {verifyQualitative} from './verify-remote-qualitative.mjs';
import {GEMMA} from '../private-merlin/gemma-response.mjs';

const model=edges=>({relationships:edges,variables:[...new Set(edges.flatMap(e=>[e.from,e.to]))].map(name=>({name,type:'variable'}))});
const receipt=edges=>({
 fixture_only:true,status:PASS,case_id:CASE_ID,case_input:REQUEST,
 model:model(edges),container_stopped:true,single_reservation:true,
 inference:{channel:'original-engine',status:'OK',response_format:'json_schema',
 response_model:GEMMA,finish_reason:'stop',invocation_id:'58532b8a-b25e-4b67-a90b-10db57da263b',
 request_sha256:'a'.repeat(64),schema_sha256:SCHEMA_SHA256,
 predicates:{schema_valid:true,total_tokens_valid:true,json_valid:true},failed_predicates:[],
 usage:{prompt_tokens:100,completion_tokens:50,total_tokens:null},max_completion_tokens:8192,neurons:1.5}
});
test('fixed original case accepts singular names and reordered directed edges',()=>{
 const edges=EXPECTED.map(e=>({...e,from:pluralize.singular(e.from),to:pluralize.singular(e.to)})).reverse();
 const input=receipt(edges),snapshot=structuredClone(input);
 const out=verifyQualitative(input);
 assert.equal(out.status,'FULL_REMOTE_QUALITATIVE_TRANSLATION_PASS');assert.equal(out.passed,1);
 assert.equal(out.evidence_source,'controlled-provider-fixture');assert.deepEqual(out.failures,[]);
 assert.deepEqual(input,snapshot);
});
test('wrong direction, polarity, invented and missing edges remain semantic failures',()=>{
 const [a,b,c]=EXPECTED;
 for(const [edges,failure] of [
  [[{...a,from:a.to,to:a.from},b,c],'Real relationships not found'],
  [[{...a,polarity:'+'},b,c],'Incorrect polarity discovered'],
  [[a,b,c,{from:'Invented',to:a.from,polarity:'+'}],'Fake relationships found'],
  [[a,b],'Real relationships not found']
 ]){
  const out=verifyQualitative(receipt(edges));
  assert.equal(out.status,'FULL_REMOTE_QUALITATIVE_TRANSLATION_FAIL');
  assert.equal(out.passed,0);assert(out.failures.some(f=>f.type===failure));
 }
});
test('receipt, case identity and endpoint integrity are separate from semantic scoring',()=>{
 const valid=receipt(EXPECTED);
 assert.throws(()=>verifyQualitative({...valid,case_id:'wrong'}));
 assert.throws(()=>verifyQualitative({...valid,case_input:{...REQUEST,depth:2}}));
 assert.throws(()=>verifyQualitative({...valid,inference:{...valid.inference,schema_sha256:'f'.repeat(64)}}));
 assert.throws(()=>verifyQualitative({...valid,model:{...valid.model,variables:[]}}),/CLD_ENDPOINT_INTEGRITY/);
 assert.throws(()=>verifyQualitative({...valid,single_reservation:false}));
 assert.throws(()=>verifyQualitative({...valid,container_stopped:false}));
});
