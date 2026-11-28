import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {digest} from '../../../infra/full-runtime/provider-wire.mjs';
import {loadInterventionReference} from './intervention-reference.mjs';
import {PLAN,PLAN_VERSION,RUBRIC,NUMERIC_TOLERANCE,evaluateHypothesis} from './intervention-families.mjs';
export async function exerciseInterventionFamilies(request,file){
 const report={contract:PLAN_VERSION,plan:PLAN,rubric:RUBRIC,numeric_tolerance:NUMERIC_TOLERANCE,plan_sha256:await digest(JSON.stringify({PLAN,RUBRIC,NUMERIC_TOLERANCE})),status:'PENDING',semantic_accuracy:'not_measured',live_provider_calls:0,cases:[]};
 const save=()=>writeFileSync(file,JSON.stringify(report,null,2)+'\n');save();
 let etag;
 async function seed(model,row){
  row.model=model;save();
  const r=await request('/project/model',{method:'PUT',headers:etag?{'if-match':etag}:{'if-none-match':'*'},body:JSON.stringify(model)});
  row.model_status=r.status;save();assert.equal(r.status,etag?204:201);
  etag=r.headers.get('etag');
  row.identity={revision:Number(JSON.parse(etag)),model_sha256:r.headers.get('x-buffalo-model-sha256')};
  row.runId=randomUUID();save();
  const res=await request('/project/runs/'+row.runId+'/ltm',{method:'PUT',body:JSON.stringify(row.identity)});
  row.compute_status=res.status;save();assert.equal(res.status,201);
  // Preserve exact stored records even if reference validation subsequently fails.
  row.originals={};
  for(const [name,path] of [['runBody','/project/runs/'+row.runId],['feedbackBody','/project/runs/'+row.runId+'/feedback'],['evidenceBody','/project/runs/'+row.runId+'/ltm'],['modelBody','/project/model/revisions/'+row.identity.revision]]){
   const r=await request(path);assert.equal(r.status,200);row.originals[name]=await r.text();save();
  }
  return row.runId;
 }
 for(const spec of PLAN){
  const c={id:spec.id,status:'PENDING',runs:[{},{}]};report.cases.push(c);save();
  try{
   const fixture=JSON.parse(readFileSync(new URL('../../../evals/categories/feedbackExplanationData/'+spec.fixture+'.json',import.meta.url)));
   const baseline=structuredClone(fixture.model);baseline.specs.integrationMethod=spec.method;baseline.specs.saveStep=spec.saveStep;
   if(spec.stopTime!==undefined)baseline.specs.stopTime=spec.stopTime;
   const comparison=structuredClone(baseline),vars=comparison.variables.filter(v=>v.name===spec.variable);
   assert.equal(vars.length,1);assert.equal(vars[0].equation,spec.from);vars[0].equation=spec.to;
   const ids=[await seed(baseline,c.runs[0]),await seed(comparison,c.runs[1])];
   const result=await loadInterventionReference(request,ids,spec);
   assert.deepEqual(result.originals,c.runs.map(r=>r.originals));
   c.reference=result.reference;c.hypothesis=evaluateHypothesis(spec,result.reference,result.originals);c.status='REFERENCE_VALID';
  }catch(e){c.status='REFERENCE_UNAVAILABLE';c.error={message:String(e.message??e),stack:String(e.stack??e)};}
  save();
 }
 const receipt=await request('/project/inference/1');report.first_inference_receipt_status=receipt.status;
 report.status=report.cases.every(c=>c.status==='REFERENCE_VALID')&&receipt.status===404?'PASS':'FAIL';save();
 console.log('C1_INTERVENTION_FAMILIES_RESULT '+JSON.stringify({status:report.status,plan_sha256:report.plan_sha256,cases:report.cases.map(c=>({id:c.id,status:c.status,hypothesis:c.hypothesis?.status,checks:c.hypothesis?.checks,trajectory_delta:c.hypothesis?.observed,reactivated:c.hypothesis?.reactivated?.length,cycles:c.reference&&{shared:c.reference.structural_cycles.shared.length,added:c.reference.structural_cycles.added.length,removed:c.reference.structural_cycles.removed.length},dominance_changed_samples:c.reference?.comparableGroups.map(g=>g.dominance_changed_samples),score_max_abs_delta:c.reference?.comparableGroups.map(g=>g.loopScores.map(l=>l.max_abs_signed_relative_delta)),error:c.error?.message})),first_inference_receipt_status:receipt.status,live_provider_calls:0}));
 assert.equal(report.status,'PASS','Reference failure preserved; hypotheses never gate pipeline success');
}
