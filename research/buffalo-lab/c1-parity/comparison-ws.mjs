import assert from 'node:assert/strict';
import {loadInterventionReference} from './intervention-reference.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {session} from '../../../infra/full-runtime/test-session.mjs';
import {openNativeLtmRun} from '../../../infra/full-runtime/native-ltm-client.mjs';
import {comparisonHash,validatePairData} from '../../../agent/tools/builtin/c1ParityComparison.js';
import {GEMMA} from '../../../infra/private-merlin/gemma-response.mjs';
import {LLMWrapper} from '../../../utilities/LLMWrapper.js';
import SeldonILEUserBrain from '../../../engines/seldon-ile-user/SeldonILEUserBrain.js';
const schema=LLMWrapper.prototype.generateSeldonResponseSchema(true).toJSONSchema();
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const names=['Inventory','Workers','Expected Demand'],question='Compare the sampled Inventory and workforce behavior of the selected baseline and comparison. Do not attribute loop dominance.';
const marker='C1_COMPARISON_CONTROLLED',final='C1_COMPARISON_FINAL';
export async function exerciseComparisonSession(request,key,useProvider,file,{pairFeedback=false,interventionReference=false}={}){
 const report={status:'PENDING',provider:'scripted-local-binding',semantic_accuracy:'not_measured',pairFeedback,interventionReference,live_provider_calls:0,calls:[],requests:[],receipts:[],tool_results:[]};
 const save=()=>writeFileSync(file,JSON.stringify(report,null,2)+'\n');save();
 try{
  const fixture=JSON.parse(readFileSync(new URL('../../../evals/categories/feedbackExplanationData/inventoryWorkforce.json',import.meta.url)));
  const baseline=structuredClone(fixture.model);baseline.specs.integrationMethod='RK4';baseline.specs.saveStep=.0625;
  const comparison=structuredClone(baseline);comparison.variables.find(v=>v.name==='Desired Inventory').equation='110';
  let etag;const selected=[];
  for(const model of [baseline,comparison]){
   const saved=await request('/project/model',{method:'PUT',headers:etag?{'if-match':etag}:{'if-none-match':'*'},body:JSON.stringify(model)});
   assert.equal(saved.status,etag?204:201);etag=saved.headers.get('etag');
   const identity={revision:Number(JSON.parse(etag)),model_sha256:saved.headers.get('x-buffalo-model-sha256')};
   const id=randomUUID();assert.equal((await request('/project/runs/'+id+'/ltm',{method:'PUT',body:JSON.stringify(identity)})).status,201);
   const opened=await openNativeLtmRun(request,id);assert.deepEqual(opened.model,model);selected.push(opened);
  }
  const ids=selected.map(x=>x.runId),[a,b]=selected;
  assert.notEqual(a.run.model_sha256,b.run.model_sha256);assert.notDeepEqual(a.run.series.inventory,b.run.series.inventory);
  assert.deepEqual(a.run.series.time,b.run.series.time);assert.equal(a.run.series.time.length,961);
  assert.deepEqual(a.run.settings,b.run.settings);assert.deepEqual(a.run.execution,b.run.execution);assert.deepEqual(a.run.simulator,b.run.simulator);
  const requestData={type:'get_variable_data',runIds:ids,variableNames:names,detailed:false};
  const data={};
  for(const s of selected)Object.assign(data,await s.clientRequest({...requestData,runIds:[s.runId]}));
  const indices=Array.from({length:50},(_,i)=>Math.round(i*960/49));
  for(const s of selected){assert.deepEqual(data[s.runId].time,indices.map(i=>s.run.series.time[i]));for(const name of names){
   const k=Object.keys(s.run.series).find(x=>x===name.toLowerCase().replace(/ /g,'_'));assert(k);
   assert.deepEqual(data[s.runId][name],indices.map(i=>s.run.series[k][i]));
  }}
  const manifest={runs:selected.map(s=>({run_id:s.runId,revision:s.run.revision,model_sha256:s.run.model_sha256,run_sha256:s.feedback.run_sha256,simulator:s.run.simulator,settings:s.run.settings,execution:s.run.execution,model:s.model})),variables:names,detailed:false,behavior_sha256:comparisonHash(data)};
  const feedbacks=[];
  if(pairFeedback){
   for(const s of selected){assert.equal(s.assessment.dominance.status,'supported_by_partition_scores');const f=await s.clientRequest({type:'feedback_request',runIds:[s.runId]});assert.deepEqual(f.runIds,[s.runId]);feedbacks.push(f.feedbackContent);}
   manifest.feedback_sha256=feedbacks.map(comparisonHash);report.feedback=feedbacks;
  }
  validatePairData(data,manifest);report.manifest=manifest;report.behavior=data;save();
  if(interventionReference){
   assert(pairFeedback);
   const measured=await loadInterventionReference(request,ids,{variable:'Desired Inventory',from:'100',to:'110',seriesNames:['inventory','workers','expected_demand']});
   report.intervention_reference=measured.reference;report.intervention_originals=measured.originals;save();
   assert.equal(measured.reference.samples,961);
   assert.equal(measured.reference.trajectories[0].baseline.initial,100);
   assert.equal(measured.reference.trajectories[0].comparison.initial,110);
   assert.equal(measured.reference.structural_cycles.shared.length,3);
   assert.deepEqual(measured.reference.structural_cycles.added,[]);assert.deepEqual(measured.reference.structural_cycles.removed,[]);
   assert.equal(measured.reference.unmatchedGroups.length,0);
   assert(measured.reference.trajectories[0].delta.max_abs>0);
   console.log('C1_INTERVENTION_REFERENCE_PASS '+JSON.stringify({samples:measured.reference.samples,cycles:measured.reference.structural_cycles.shared.length,groups:measured.reference.comparableGroups.length,trajectory_delta:measured.reference.trajectories.map(x=>({variable:x.variable,max_abs:x.delta.max_abs})),dominance_changed_samples:measured.reference.comparableGroups.map(x=>x.dominance_changed_samples),score_max_abs_delta:measured.reference.comparableGroups.map(x=>x.loopScores.map(l=>l.max_abs_signed_relative_delta)),semantic_accuracy:'not_measured'}));
  }
  const actions=[['get_run_info',{}],['get_variable_data',{runIds:ids,variableNames:names,detailed:false}],
   ['discuss_model_across_runs',{prompt:question,difficulty:'normal',runName:a.runId,parameters:{runIds:[...ids].reverse()}}],
   ['discuss_model_across_runs',{prompt:question,difficulty:'normal',runName:b.runId,parameters:{runIds:ids}}]];
  const expectedNested=pairFeedback?2:1,expectedCalls=5+expectedNested;
  let turn=0,nested=0;
  useProvider((model,wire)=>{
   const call={model,wire};report.calls.push(call);save();
   assert.equal(model,GEMMA);assert(report.calls.length<=expectedCalls);
   let message={role:'assistant'};
   if(wire.response_format){
    assert.equal(turn,4);assert(++nested<=expectedNested);
    assert.deepEqual(wire.response_format,{type:'json_schema',json_schema:schema});
    const user=wire.messages.filter(m=>m.role==='user').map(m=>m.content).join('\n');
    // Context may be normalized by IPC; compare canonical manifest rather than
    // assuming identical property insertion order after protocol validation.
    const expectedBehavior=JSON.stringify(data);assert(user.includes(expectedBehavior));
    assert(user.includes(JSON.stringify(manifest)),'EXACT_COMPARISON_MANIFEST_MISSING');
    assert(user.includes('The current simulation run the user is working with is called: "'+b.runId+'"'));
    assert(user.includes(question));
    if(pairFeedback&&nested===2){assert(user.includes(JSON.stringify(feedbacks,null,2)),'EXACT_PAIR_FEEDBACK_MISSING');assert.deepEqual(report.requests.map(x=>x.type),['get_run_info','get_variable_data','feedback_request']);}
    else assert(!user.includes('"feedbackLoops"'));
    assert(wire.messages.find(m=>m.role==='system').content.includes(SeldonILEUserBrain.DEFAULT_SYSTEM_PROMPT));
    const current=JSON.parse(wire.messages.find(m=>m.role==='assistant').content);
    assert.deepEqual(current.variables.map(v=>[v.name,v.equation]),comparison.variables.map(v=>[v.name,v.equation]));
    message.content=JSON.stringify({response:pairFeedback&&nested===1?'C1_PAIR_FEEDBACK_REQUIRED':marker,feedbackInformationRequired:pairFeedback&&nested===1});
   }else if(turn<actions.length){
    if(turn)assert(wire.messages.some(m=>m.role==='tool'&&m.tool_call_id==='comparison-'+turn));
    if(turn===3)assert(wire.messages.some(m=>m.role==='tool'&&m.tool_call_id==='comparison-3'&&m.content.includes('C1_COMPARE_ORDERED_PAIR_REQUIRED')));
    const [name,args]=actions[turn++];assert(wire.tools.some(t=>t.function.name===name));
    assert(wire.tools.every(t=>['get_run_info','get_variable_data','discuss_model_across_runs'].includes(t.function.name)),'COMPARISON_TOOL_CEILING');
    message.tool_calls=[{type:'function',id:'comparison-'+turn,function:{name,arguments:JSON.stringify(args)}}];
   }else{
    assert.equal(nested,expectedNested);assert(wire.messages.some(m=>m.role==='tool'&&m.tool_call_id==='comparison-4'&&m.content.includes(marker)));
    message.content=final;
   }
   return {model,usage:{prompt_tokens:50,completion_tokens:20,total_tokens:70},choices:[{index:0,finish_reason:message.tool_calls?'tool_calls':'stop',message}]};
  });
  const result=await session({key,mode:'sfd',agent:'merlin',edit:true,deadline:Date.now()+180000,model:b.model,scenario:{
   readOnly:true,message:question,capabilities:{context:{c1Comparison:manifest}},
   async clientRequest(m,current){
    assert.deepEqual(current,b.model);report.requests.push(m);save();
    if(m.type==='get_run_info')return {runs:selected.map(s=>({id:s.runId,name:'Simlin revision '+s.run.revision,variables:Object.keys(s.run.series).filter(k=>k!=='time')}))};
    if(m.type==='feedback_request'){assert(pairFeedback);assert.equal(nested,1);assert.deepEqual(m.runIds,ids);return {runIds:[...ids],feedbackContent:structuredClone(feedbacks)};}
    assert.equal(m.type,'get_variable_data');assert.deepEqual(m.runIds,ids);assert.deepEqual(m.variableNames,names);assert.equal(m.detailed,false);
    return structuredClone(data);
   },
   onToolCompleted(m){report.tool_results.push(m);save();},
   verify(current,tools){assert.deepEqual(current,b.model);const done=tools.filter(t=>t.event==='tool_call_completed');assert.deepEqual(done.map(t=>t.name),actions.map(a=>a[0]));assert.deepEqual(done.map(t=>!!t.isError),[false,false,true,false]);}
  }});
  assert(result.output.includes(final));assert(!result.output.includes(marker));assert.equal(nested,expectedNested);assert.equal(report.calls.length,expectedCalls);
  assert.deepEqual(report.requests.map(x=>x.type),['get_run_info','get_variable_data',...(pairFeedback?['feedback_request']:[])]);
  for(let n=1;n<=expectedCalls;n++){const r=await request('/project/inference/'+n);assert.equal(r.status,200);const receipt=await r.json();report.receipts.push(receipt);assert.equal(receipt.status,'OK');if(n>=5&&n<5+expectedNested){assert.equal(receipt.channel,'original-engine');assert.equal(receipt.schema_sha256,sha(schema));assert.equal(receipt.request_sha256,sha(report.calls[n-1].wire));assert(receipt.invocation_id);}else assert.notEqual(receipt.channel,'original-engine');}
  assert.equal(new Set(report.receipts.filter(r=>r.channel==='original-engine').map(r=>r.invocation_id)).size,expectedNested);
  assert.equal((await request('/project/inference/'+(expectedCalls+1))).status,404);
  for(const s of selected){const reopened=await openNativeLtmRun(request,s.runId);assert.deepEqual(reopened.run,s.run);assert.deepEqual(reopened.feedback,s.feedback);assert.deepEqual(reopened.model,s.model);}
  report.status='PASS';save();console.log('C1_PARITY_COMPARISON_PASS '+JSON.stringify({pairFeedback,calls:expectedCalls,planner:5,nested:expectedNested,runs:ids,full_samples:961,behavior_samples:50,live_provider_calls:0}));
 }catch(e){report.status='FAIL';report.error=String(e.stack??e);save();throw e;}
}
