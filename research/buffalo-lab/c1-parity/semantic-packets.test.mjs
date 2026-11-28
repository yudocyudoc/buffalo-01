import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {matchedSingleCallWires,blindPacket,validateAnnotation,ARMS,ABLATION_SYSTEM,TARGETS,verifyCaptureReceipt} from './semantic-packets.mjs';
test('matched one-call ablation changes only system message and never mutates original',()=>{
 const wire={model:'x',messages:[{role:'system',content:'special'},{role:'assistant',content:'model'},{role:'user',content:'evidence'},{role:'user',content:'question'}],response_format:{type:'json_schema'},max_tokens:8192};
 const {ile_direct_full_feedback:a,ile_system_ablation:b}=matchedSingleCallWires(wire);
 assert.deepEqual(a,wire);assert.equal(b.messages[0].content,ABLATION_SYSTEM);b.messages[1].content='changed';assert.equal(wire.messages[1].content,'model');
 assert.throws(()=>matchedSingleCallWires({...wire,messages:[...wire.messages,wire.messages[0]]}));
});
const reference={samples:3,trajectories:[{variable:'x',delta:{max_abs:10}}]};
const records=ARMS.map((arm,i)=>({arm,text:'Claim '+i,origin:'controlled_fixture'}));
test('controlled output cannot enter real review; blind packet excludes arm and private key',()=>{
 const input={caseId:'A',reference,question:'Compare.',records};
 assert.throws(()=>blindPacket(input),/CONTROLLED_OUTPUT_NOT_SEMANTIC_EVIDENCE/);
 let i=0;const {review,privateKey}=blindPacket(input,{allowControlled:true,idFactory:()=>String(++i)});
 assert.equal(review.semantic_accuracy,'not_measured');assert.deepEqual(review.targets,TARGETS);assert.equal(privateKey.length,3);
 for(const a of ARMS)assert(!JSON.stringify(review).includes(a));
 assert(!Object.hasOwn(review,'privateKey'));assert.throws(()=>blindPacket(input,{allowControlled:true,idFactory:()=> 'same'}));
});
test('annotation validates exact quoted span, reference paths, label and omissions without claiming correctness',()=>{
 const review={reference,outputs:[{id:'1',text:'Inventory changed.'}]};
 const valid={output_id:'1',reviewer:'r',claims:[{start:0,end:17,quote:'Inventory changed',proposition:'Inventory changed',label:'supported',reason:'Computed difference',reference_paths:['/trajectories/0/delta/max_abs']}],omissions:['dominance']};
 assert.equal(validateAnnotation(review,valid).status,'annotation_shape_valid_not_semantically_adjudicated');
 for(const mutate of [a=>a.claims[0].quote='incorrect',a=>a.claims[0].reference_paths=['/missing'],a=>a.claims[0].label='made-up',a=>a.omissions.push('dominance'),a=>a.output_id='unknown']){
  const a=structuredClone(valid);mutate(a);assert.throws(()=>validateAnnotation(review,a));
 }
});

test('planner receipt without hash is valid only with size and response checks; engine hash is mandatory',()=>{
 const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
 const schema={type:'object'},wire={messages:[{role:'user',content:'evidence ñ'}]},response={model:'fixture',choices:[{finish_reason:'stop'}],usage:{prompt_tokens:50,completion_tokens:20}};
 const call={wire,wire_sha256:sha(wire),response};
 const receipt={status:'OK',request_bytes:Buffer.byteLength(JSON.stringify(wire)),response_model:'fixture',finish_reason:'stop',usage:{prompt_tokens:50,completion_tokens:20},predicates:{model_accepted:true}};
 assert.equal(verifyCaptureReceipt(receipt,call,{nested:false,schema}),'planner_receipt_size_and_response_verified_local_wire_hash_only');
 const engine={...receipt,channel:'original-engine',request_sha256:sha(wire),schema_sha256:sha(schema),invocation_id:'fixture'};
 assert.equal(verifyCaptureReceipt(engine,call,{nested:true,schema}),'engine_receipt_hash_verified');
 for(const mutate of [r=>delete r.request_sha256,r=>r.request_sha256='bad',r=>r.schema_sha256='bad',r=>delete r.invocation_id,r=>r.channel='planner']){
  const r=structuredClone(engine);mutate(r);assert.throws(()=>verifyCaptureReceipt(r,call,{nested:true,schema}));
 }
 for(const mutate of [r=>r.request_bytes++,r=>r.request_sha256='bad',r=>r.finish_reason='length',r=>r.usage.prompt_tokens++,r=>r.predicates.model_accepted=false]){
  const r=structuredClone(receipt);mutate(r);assert.throws(()=>verifyCaptureReceipt(r,call,{nested:false,schema}));
 }
 assert.throws(()=>verifyCaptureReceipt(receipt,{...call,wire_sha256:'bad'},{nested:false,schema}));
});
