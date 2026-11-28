import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {session} from '../../../infra/full-runtime/test-session.mjs';
import {GEMMA} from '../../../infra/private-merlin/gemma-response.mjs';
import {LLMWrapper} from '../../../utilities/LLMWrapper.js';
import {SOURCE,CONTRACT,prepareAcceptedCase,matchedSingleCallWires,blindPacket} from './semantic-packets.mjs';
const schema=LLMWrapper.prototype.generateSeldonResponseSchema(true).toJSONSchema();
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export async function exerciseSemanticCapture(request,key,useProvider,file,sourcePath,caseId){
 const report={contract:CONTRACT,source:SOURCE,caseId,status:'PENDING',origin:'controlled_fixture',semantic_accuracy:'not_measured',live_provider_calls:0,calls:[],requests:[],receipts:[],tool_results:[]};
 const save=()=>writeFileSync(file,JSON.stringify(report,null,2)+'\n');save();
 try{
  const raw=readFileSync(sourcePath,'utf8');report.source_json_sha256=createHash('sha256').update(raw).digest('hex');
  const p=await prepareAcceptedCase(JSON.parse(raw),caseId),[a,b]=p.selected;
  report.evidence_sha256=p.evidence_sha256;report.manifest=p.manifest;report.behavior=p.behavior;report.feedback=p.feedbacks;report.reference=p.reference;report.question=p.question;save();
  const actions=[['get_run_info',{}],['get_variable_data',{runIds:p.ids,variableNames:p.names,detailed:false}],['discuss_model_across_runs',{prompt:p.question,difficulty:'normal',runName:b.id,parameters:{runIds:p.ids}}]];
  let turn=0,nested=0;
  const marker='CONTROLLED_NESTED_OUTPUT_NOT_SCIENTIFIC_EVIDENCE',final='CONTROLLED_FINAL_OUTPUT_NOT_SCIENTIFIC_EVIDENCE';
  useProvider((model,wire)=>{
   const call={model,wire,wire_sha256:sha(wire)};report.calls.push(call);save();
   assert.equal(model,GEMMA);assert(report.calls.length<=6);
   let message={role:'assistant'};
   if(wire.response_format){
    assert.equal(turn,3);assert(++nested<=2);assert.deepEqual(wire.response_format,{type:'json_schema',json_schema:schema});
    const user=wire.messages.filter(m=>m.role==='user').map(m=>m.content).join('\n');
    assert(user.includes(JSON.stringify(p.manifest)));assert(user.includes(JSON.stringify(p.behavior)));assert(user.includes(p.question));
    assert(!user.includes('BUFFALO_INTERVENTION_REFERENCE_V1'));
    if(nested===1)assert(!user.includes('"feedbackLoops"'));
    else {assert(user.includes(JSON.stringify(p.feedbacks,null,2)));assert.deepEqual(report.requests.map(m=>m.type),['get_run_info','get_variable_data','feedback_request']);}
    message.content=JSON.stringify({response:nested===1?'Feedback is needed.':marker,feedbackInformationRequired:nested===1});
   }else if(turn<actions.length){
    const [name,args]=actions[turn++];assert(wire.tools.some(t=>t.function.name===name));assert(wire.tools.every(t=>['get_run_info','get_variable_data','discuss_model_across_runs'].includes(t.function.name)));
    message.tool_calls=[{type:'function',id:'capture-'+turn,function:{name,arguments:JSON.stringify(args)}}];
   }else{
    assert.equal(nested,2);assert(wire.messages.some(m=>m.role==='tool'&&m.tool_call_id==='capture-3'&&m.content.includes(marker)));message.content=final;
   }
   const response={model,usage:{prompt_tokens:50,completion_tokens:20,total_tokens:70},choices:[{index:0,finish_reason:message.tool_calls?'tool_calls':'stop',message}]};
   call.response=response;save();return response;
  });
  const result=await session({key,mode:'sfd',agent:'merlin',edit:true,deadline:Date.now()+180000,model:b.model,scenario:{
   readOnly:true,message:p.question,capabilities:{context:{c1Comparison:p.manifest}},
   async clientRequest(m,current){
    assert.deepEqual(current,b.model);report.requests.push(m);save();
    if(m.type==='get_run_info')return {runs:p.selected.map(s=>({id:s.id,name:'Simlin revision '+s.run.revision,variables:Object.keys(s.run.series).filter(k=>k!=='time')}))};
    assert.deepEqual(m.runIds,p.ids);
    if(m.type==='feedback_request'){assert.equal(nested,1);return {runIds:p.ids,feedbackContent:structuredClone(p.feedbacks)};}
    assert.equal(m.type,'get_variable_data');assert.deepEqual(m.variableNames,p.names);assert.equal(m.detailed,false);return structuredClone(p.behavior);
   },
   onToolCompleted(m){report.tool_results.push(m);save();},
   verify(current,tools){assert.deepEqual(current,b.model);const done=tools.filter(t=>t.event==='tool_call_completed');assert.deepEqual(done.map(t=>t.name),actions.map(x=>x[0]));assert(done.every(t=>!t.isError));}
  }});
  assert(result.output.includes(final));assert.equal(nested,2);assert.equal(report.calls.length,6);
  assert.deepEqual(report.requests.map(m=>m.type),['get_run_info','get_variable_data','feedback_request']);
  for(let n=1;n<=6;n++){
   const res=await request('/project/inference/'+n);assert.equal(res.status,200);const receipt=await res.json();report.receipts.push(receipt);
   assert.equal(receipt.status,'OK');assert.equal(receipt.request_sha256,report.calls[n-1].wire_sha256);
   if(n===4||n===5){assert.equal(receipt.channel,'original-engine');assert.equal(receipt.schema_sha256,sha(schema));assert(receipt.invocation_id);}else assert.notEqual(receipt.channel,'original-engine');
  }
  assert.notEqual(report.receipts[3].invocation_id,report.receipts[4].invocation_id);
  assert.equal((await request('/project/inference/7')).status,404);
  // Single-call candidates are exact provider-facing wire and system-only
  // ablation, not executed arms. Retain full raw response for guided route.
  report.candidates=Object.fromEntries(Object.entries(matchedSingleCallWires(report.calls[4].wire)).map(([arm,wire])=>[arm,{wire,wire_sha256:sha(wire),status:'NOT_DISPATCHED'}]));
  report.merlin={output:result.output,session_id:result.session_id,status:'CONTROLLED_CAPTURE'};
  // Exercise blindness mechanically with placeholders, never evaluate them.
  const packet=blindPacket({caseId,reference:p.reference,question:p.question,records:[{arm:'merlin_guided',text:result.output,origin:'controlled_fixture'},{arm:'ile_direct_full_feedback',text:'Controlled dry-run placeholder one.',origin:'controlled_fixture'},{arm:'ile_system_ablation',text:'Controlled dry-run placeholder two.',origin:'controlled_fixture'}]},{allowControlled:true});
  report.dry_run_blind_packet=packet;report.status='PASS';save();
  console.log('C1_SEMANTIC_CAPTURE_PASS '+JSON.stringify({caseId,evidence_sha256:p.evidence_sha256,calls:6,planner:4,nested:2,candidate_wires:2,live_provider_calls:0,semantic_accuracy:'not_measured'}));
 }catch(e){report.status='FAIL';report.error=String(e.stack??e);save();throw e;}
}
