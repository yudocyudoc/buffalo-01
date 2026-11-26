import {digest} from './provider-wire.mjs';
import {RUN_ID} from './project-runs.mjs';
import {assessRunFeedback,validNarrative} from './run-narrative.mjs';

// Bind the original SD-AI client protocol to one immutable project run.
// Reopening by UUID reloads both the model revision and the matching evidence.
export async function openNativeLtmRun(request,runId) {
  if (!RUN_ID.test(runId)) throw Error('INVALID_RUN_ID');
  const path='/project/runs/'+runId;
  async function read(path) {
    const response=await request(path);
    if (!response.ok) throw Error('NATIVE_RUN_UNAVAILABLE');
    return response.text();
  }
  const [runBody,feedbackBody]=await Promise.all([read(path),read(path+'/feedback')]);
  const run=JSON.parse(runBody), feedback=JSON.parse(feedbackBody);
  const modelBody=await read('/project/model/revisions/'+run.revision);
  if (run.simulator.source!=='server' || feedback.run_id!==runId ||
      feedback.run_sha256!==await digest(runBody) || run.model_sha256!==await digest(modelBody))
    throw Error('NATIVE_RUN_IDENTITY_MISMATCH');
  const model=JSON.parse(modelBody);
  const assessment=await assessRunFeedback(run,feedback,()=>read(path+'/ltm'));
  const requireConsistentPeriods=()=>{
    if (assessment.dominance.status==='contradicted') throw Error('NARRATIVE_DOMINANCE_CONTRADICTED',{cause:assessment.dominance});
  };
  async function saveNarrative(narrativeId,prompt,result) {
    requireConsistentPeriods();
    if (!RUN_ID.test(narrativeId) || !validNarrative(result,feedback.content)) throw Error('INVALID_NATIVE_NARRATIVE');
    const record={run_id:runId,run_sha256:feedback.run_sha256,feedback_sha256:await digest(feedbackBody),
      prompt,output:result.output,feedbackLoops:result.feedbackLoops,assessment};
    const res=await request(path+'/narratives/'+narrativeId,{method:'PUT',body:JSON.stringify(record)});
    if (!res.ok) throw Error('NATIVE_NARRATIVE_SAVE_FAILED_'+res.status);
    return record;
  }
  return {model,runId,run,feedback,assessment,saveNarrative, async clientRequest(message) {
    if ((message.runIds??[]).some(id=>id!==runId)) throw Error('RUN_OUTSIDE_SELECTED_ANALYSIS');
    if (message.type==='feedback_request') {
      requireConsistentPeriods();
      return {runIds:[runId],feedbackContent:feedback.content};
    }
    if (message.type==='get_run_info') return {runs:[{id:runId,name:'Simlin revision '+run.revision,
      variables:Object.keys(run.series).filter(name=>name!=='time')}]};
    if (message.type==='get_variable_data') {
      const time=run.series.time, count=Math.min(time.length,message.detailed?200:50);
      const indices=Array.from({length:count},(_,i)=>count===1?0:Math.round(i*(time.length-1)/(count-1)));
      const data={time:indices.map(i=>time[i])};
      for (const key of message.variableNames??[]) {
        const column=Object.keys(run.series).find(name=>name.toLowerCase()===key.toLowerCase().replace(/\s+/g,'_'));
        if(column) data[key]=indices.map(i=>run.series[column][i]);
      }
      return {[runId]:data};
    }
    throw Error('UNSUPPORTED_NATIVE_RUN_REQUEST');
  }};
}
