// Real original Merlin WebSocket loop and nested engine transport. The only
// substitute is the binding response. No LLMWrapper stub and no historical LTM mix.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {session} from '../../../infra/full-runtime/test-session.mjs';
import {openNativeLtmRun} from '../../../infra/full-runtime/native-ltm-client.mjs';
import {GEMMA} from '../../../infra/private-merlin/gemma-response.mjs';
import {LLMWrapper} from '../../../utilities/LLMWrapper.js';
import SeldonBrain from '../../../engines/seldon/SeldonBrain.js';
import {createEvidenceClient} from './evidence-client.mjs';

const marker='C1_PARITY_NESTED_REAL_TRANSPORT';
const final='C1_PARITY_FINAL_CONTROLLED';
const question='Explain the oscillations in Inventory Workforce using the selected run.';
const schema=LLMWrapper.prototype.generateSeldonResponseSchema(true).toJSONSchema();
const sha=x=>createHash('sha256').update(x).digest('hex');
const names=['Inventory','Workers','Expected Demand'];
const matches=(wire,text)=>wire.messages.some(m=>m.role==='user'&&m.content.includes(text));

export async function exerciseParitySession(request,key,useProvider,file,{accumulate=false,strictCache=false,demand=false}={}){
 const report={status:'PENDING',provider:'scripted-local-binding',live_provider_calls:0,planner_selection:'scripted',semantic_accuracy:'not_measured',accumulate,strictCache,demand,calls:[],client_requests:[],tool_results:[],receipts:[]};
 const save=()=>writeFileSync(file,JSON.stringify(report,null,2)+'\n');
 save();
 try{
  const fixture=JSON.parse(readFileSync(new URL('../../../evals/categories/feedbackExplanationData/inventoryWorkforce.json',import.meta.url)));
  const model=structuredClone(fixture.model);
  model.specs.integrationMethod='RK4';model.specs.saveStep=.0625;
  const stored=await request('/project/model',{method:'PUT',headers:{'if-none-match':'*'},body:JSON.stringify(model)});
  assert.equal(stored.status,201);
  const identity={revision:Number(JSON.parse(stored.headers.get('etag'))),model_sha256:stored.headers.get('x-buffalo-model-sha256')};
  const id=randomUUID(),path='/project/runs/'+id;
  report.identity={...identity,run_id:id};
  const calc=await request(path+'/ltm',{method:'PUT',body:JSON.stringify(identity)});
  assert.equal(calc.status,201,'native Inventory simulation');
  const selected=await openNativeLtmRun(request,id);
  assert.deepEqual(selected.model,model);
  assert.equal(selected.run.series.time.length,961);
  assert.equal(selected.assessment.dominance.status,'supported_by_partition_scores');
  report.source={run:selected.run,feedback:selected.feedback,assessment:selected.assessment};
  await assert.rejects(selected.clientRequest({type:'feedback_request',runIds:[randomUUID()]}),/RUN_OUTSIDE_SELECTED_ANALYSIS/);
  const evidence=accumulate?createEvidenceClient(selected):null;
  const actions=[
   ['get_run_info',{}],
   ...(accumulate?[
    ['get_variable_data',{runIds:[id],variableNames:[names[0]],detailed:true}],
    ['get_variable_data',{runIds:[id],variableNames:names.slice(1),detailed:true}]
   ]:[['get_variable_data',{runIds:[id],variableNames:names,detailed:true}]]),
   ...(demand?[]:[['get_feedback_information',{runIds:[id]}]]),
   ...(strictCache&&!demand?[
    ['discuss_model_with_seldon',{prompt:question,difficulty:'normal',parameters:{runIds:[randomUUID()]}}],
    ['generate_ltm_narrative',{difficulty:'normal',parameters:{runIds:[]}}]
   ]:[]),
   ['discuss_model_with_seldon',{prompt:question,difficulty:'normal',parameters:{runIds:[id]}}]
  ];
  const expectedNested=demand?2:1;
  const expectedCalls=actions.length+1+expectedNested;
  let turn=0,nested=0,behavior;
  if(evidence){
   const before=evidence.snapshot();
   await assert.rejects(evidence.clientRequest({type:'get_variable_data',runIds:[randomUUID()],variableNames:names,detailed:true},selected.model),/EVIDENCE_RUN_EXPLICIT_REQUIRED/);
   await assert.rejects(evidence.clientRequest({type:'get_variable_data',runIds:[id],variableNames:['unknown'],detailed:true},selected.model),/EVIDENCE_VARIABLE_UNKNOWN_OR_AMBIGUOUS/);
   await assert.rejects(evidence.clientRequest({type:'feedback_request',runIds:[id]},{...selected.model,variables:[]}),/EVIDENCE_MODEL_CHANGED/);
   assert.deepEqual(evidence.snapshot(),before);
  }
  useProvider((model,wire)=>{
   const call={wire,model,status:'RECEIVED'};report.calls.push(call);save();
   try{
    assert.equal(model,GEMMA);assert(report.calls.length<=expectedCalls);
    let message={role:'assistant'};
    if(wire.response_format){
     assert.equal(turn,actions.length);assert(++nested<=expectedNested);
     assert.deepEqual(wire.response_format,{type:'json_schema',json_schema:schema});
     assert(behavior,'missing selected behavior');
     assert(matches(wire,JSON.stringify(behavior)),'EXACT_BEHAVIOR_MISSING');
     const hasFeedback=matches(wire,JSON.stringify(selected.feedback.content,null,2));
     assert.equal(hasFeedback,!demand||nested===2,'EXACT_FEEDBACK_STATE');
     if(demand&&nested===1)assert(!wire.messages.some(m=>m.role==='user'&&m.content.includes('"feedbackLoops"')),'UNEXPECTED_FEEDBACK');
     assert(matches(wire,question),'QUESTION_MISSING');
     const sys=wire.messages.find(m=>m.role==='system').content;
     assert(sys.includes(SeldonBrain.DEFAULT_SYSTEM_PROMPT));assert(sys.includes('Be brief in your response.'));
     const originalModel=JSON.parse(wire.messages.find(m=>m.role==='assistant').content);
     assert.deepEqual(originalModel.variables.map(v=>[v.name,v.equation]),modelVariables(selected.model));
     message.content=JSON.stringify({response:demand&&nested===1?'C1_DEMAND_REQUEST_FEEDBACK':marker,feedbackInformationRequired:demand&&nested===1});
    }else if(turn<actions.length){
     if(turn>0)assert(wire.messages.some(m=>m.role==='tool'&&m.tool_call_id==='parity-'+turn),'PREVIOUS_RESULT_MISSING');
     if(strictCache&&!demand&&turn===actions.length-2){
      assert(wire.messages.some(m=>m.role==='tool'&&m.tool_call_id==='parity-'+turn&&m.content.includes('C1_CACHE_FEEDBACK_RUN_MISMATCH')),'WRONG_RUN_NOT_REJECTED');
     }
     if(strictCache&&!demand&&turn===actions.length-1){
      assert(wire.messages.some(m=>m.role==='tool'&&m.tool_call_id==='parity-'+turn&&m.content.includes('C1_CACHE_EXPLICIT_SINGLE_RUN_REQUIRED')),'IMPLICIT_RUN_NOT_REJECTED');
     }
     const [name,args]=actions[turn++];
     assert(wire.tools.some(t=>t.function.name===name),'MISSING_TOOL '+name);
     message.tool_calls=[{type:'function',id:'parity-'+turn,function:{name,arguments:JSON.stringify(args)}}];
    }else{
     assert.equal(nested,expectedNested);
     const result=wire.messages.find(m=>m.role==='tool'&&m.tool_call_id==='parity-'+actions.length);
     assert(result?.content.includes(marker),'ACTUAL_NESTED_RESULT_MISSING');
     message.content=final;
    }
    const response={model,usage:{prompt_tokens:50,completion_tokens:20,total_tokens:70},choices:[{index:0,finish_reason:message.tool_calls?'tool_calls':'stop',message}]};
    call.status='RETURNED';call.response=response;save();return response;
   }catch(e){call.status='FAILED';call.error=String(e.stack??e);save();throw e;}
  });
  const result=await session({key,mode:'sfd',agent:'merlin',edit:true,deadline:Date.now()+180000,model:selected.model,scenario:{
   readOnly:true,message:question,
   async clientRequest(m,current){
    assert.deepEqual(current,selected.model,'MODEL_CHANGED');
    const answer=await (evidence?evidence.clientRequest(m,current):selected.clientRequest(m));
    report.client_requests.push({request:m,response:answer});save();
    if(m.type==='get_variable_data'){
     assert.deepEqual(m.runIds,[id]);assert.equal(m.detailed,true);
     const requested=accumulate?(behavior?names.slice(1):[names[0]]):names;
     assert.deepEqual(m.variableNames,requested);
     const returned=accumulate&&!behavior?[names[0]]:names;
     behavior=answer[id];assert.deepEqual(Object.keys(behavior),['time',...returned]);
     const indices=Array.from({length:200},(_,i)=>Math.round(i*960/199));
     assert.deepEqual(behavior.time,indices.map(i=>selected.run.series.time[i]));
     for(const name of returned){
      const col=Object.keys(selected.run.series).find(k=>k.toLowerCase()===name.toLowerCase().replace(/\s+/g,'_'));
      assert(col);assert.deepEqual(behavior[name],indices.map(i=>selected.run.series[col][i]));
     }
    }
    if(evidence&&m.type==='get_variable_data'){
     const before=evidence.snapshot();
     await assert.rejects(evidence.clientRequest({...m,detailed:false},current),/EVIDENCE_RESOLUTION_CHANGED/);
     assert.deepEqual(evidence.snapshot(),before);
     report.evidence_client=evidence.snapshot();save();
    }
    if(m.type==='feedback_request'){assert.deepEqual(m.runIds,[id]);assert.deepEqual(answer.feedbackContent,selected.feedback.content);}
    return answer;
   },
   onToolCompleted(m){report.tool_results.push(m);save();},
   verify(current,tools){
    assert.deepEqual(current,selected.model);
    const completed=tools.filter(t=>t.event==='tool_call_completed');
    assert.deepEqual(completed.map(t=>t.name),actions.map(a=>a[0]));
    assert.deepEqual(completed.map(t=>!!t.isError),actions.map((_,i)=>strictCache&&!demand&&(i===actions.length-3||i===actions.length-2)));
   }
  }});
  report.session=result;save();
  assert(result.output.includes(final));assert(!result.output.includes(marker));
  assert.equal(report.calls.length,expectedCalls);assert.equal(nested,expectedNested);assert.equal(turn,actions.length);
  assert.deepEqual(report.client_requests.map(x=>x.request.type),['get_run_info','get_variable_data',...(accumulate?['get_variable_data']:[]),'feedback_request']);
  for(let n=1;n<=expectedCalls;n++){
   const r=await request('/project/inference/'+n);assert.equal(r.status,200);
   const receipt=await r.json();report.receipts.push(receipt);save();assert.equal(receipt.status,'OK');
   if(n>actions.length&&n<=actions.length+expectedNested){
    assert.equal(receipt.channel,'original-engine');assert.equal(receipt.schema_sha256,sha(JSON.stringify(schema)));
    assert.equal(receipt.request_sha256,sha(JSON.stringify(report.calls[n-1].wire)));
    assert(receipt.invocation_id);assert(receipt.max_completion_tokens<=8192);
   }else assert.notEqual(receipt.channel,'original-engine');
  }
  assert.equal(new Set(report.receipts.filter(r=>r.channel==='original-engine').map(r=>r.invocation_id)).size,expectedNested);
  assert.equal((await request('/project/inference/'+(expectedCalls+1))).status,404);
  const latest=await request('/project/model');assert.equal(latest.headers.get('x-buffalo-model-sha256'),identity.model_sha256);
  const reopened=await openNativeLtmRun(request,id);
  assert.deepEqual(reopened.run,selected.run);assert.deepEqual(reopened.feedback,selected.feedback);
  if(evidence)report.evidence_client=evidence.snapshot();
  report.status='PASS';save();console.log('C1_PARITY_WS_PASS '+JSON.stringify({accumulate,strictCache,demand,calls:expectedCalls,planner:actions.length+1,nested:expectedNested,live_provider_calls:0,run_id:id,samples:961,behavior_samples:200}));
 }catch(e){report.status='FAIL';report.error=String(e.stack??e);save();throw e;}
}
function modelVariables(model){return model.variables.map(v=>[v.name,v.equation]);}
