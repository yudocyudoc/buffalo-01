// Frozen source: accepted #107 artifact. No solver reruns or provider dispatch here.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {digest} from '../../../infra/full-runtime/provider-wire.mjs';
import {comparisonHash,validatePairData,MAX_COMPARISON_MANIFEST_BYTES} from '../../../agent/tools/builtin/c1ParityComparison.js';
import {validateComparativeFeedback} from '../../../agent/tools/builtin/c1ParityComparativeFeedback.js';
import {loadInterventionReference} from './intervention-reference.mjs';
import {PLAN,RUBRIC,NUMERIC_TOLERANCE,evaluateHypothesis} from './intervention-families.mjs';
export const SOURCE=Object.freeze({run:46175868699,artifact:15275418147,archive_sha256:'594b25f3fc1344352cd92585527edb9cc8d3ba29d7ca3fbc463d80aad4436bd4',plan_sha256:'54f6f56ca4d24d78b6aedbe2ec2748e1ce54084a7dc2afc93be8428e985dafde'});
export const CONTRACT='BUFFALO_COMPARATIVE_CAPTURE_V1';
export const ARMS=Object.freeze(['merlin_guided','ile_direct_full_feedback','ile_system_ablation']);
export const TARGETS=Object.freeze(['trajectories','structure','activity','relative_scores','dominance','limits']);
export const ABLATION_SYSTEM='Answer the question using only the supplied simulation evidence. Distinguish observed results from interpretation and uncertainty. Return a JSON object with response and feedbackInformationRequired. Be brief.';
const same=(a,b)=>assert.deepEqual(a,b);
const normalize=s=>s.toLowerCase().replace(/\s+/g,'_');
const bytes=x=>Buffer.byteLength(JSON.stringify(x),'utf8');
export async function prepareAcceptedCase(report,caseId){
 assert.equal(report.contract,'BUFFALO_INTERVENTION_FAMILIES_V1');assert.equal(report.status,'PASS');
 assert.equal(report.plan_sha256,SOURCE.plan_sha256);
 assert.equal(await digest(JSON.stringify({PLAN:report.plan,RUBRIC:report.rubric,NUMERIC_TOLERANCE:report.numeric_tolerance})),SOURCE.plan_sha256);
 same(report.plan,PLAN);same(report.rubric,RUBRIC);assert.equal(report.numeric_tolerance,NUMERIC_TOLERANCE);
 assert.equal(report.first_inference_receipt_status,404);assert.equal(report.live_provider_calls,0);
 same(report.cases.map(c=>c.id),PLAN.map(c=>c.id));assert(report.cases.every(c=>c.status==='REFERENCE_VALID'));
 const spec=PLAN.find(x=>x.id===caseId),c=report.cases.find(x=>x.id===caseId);assert(spec&&c);
 const rows=new Map(),ids=c.runs.map(r=>r.runId);assert.equal(ids.length,2);
 for(const r of c.runs){
  const o=r.originals,p='/project/runs/'+r.runId;
  rows.set(p,o.runBody);rows.set(p+'/feedback',o.feedbackBody);rows.set(p+'/ltm',o.evidenceBody);rows.set('/project/model/revisions/'+r.identity.revision,o.modelBody);
 }
 // Reverify exact original bodies and full-grid reference, not just report flags.
 const loaded=await loadInterventionReference(async p=>rows.has(p)?new Response(rows.get(p)):new Response(null,{status:404}),ids,spec);
 same(loaded.reference,c.reference);same(evaluateHypothesis(spec,loaded.reference,loaded.originals),c.hypothesis);
 const selected=loaded.originals.map((o,i)=>({id:ids[i],run:JSON.parse(o.runBody),model:JSON.parse(o.modelBody),feedback:JSON.parse(o.feedbackBody)}));
 const names=spec.seriesNames.map(n=>{
  const matches=selected[1].model.variables.filter(v=>normalize(v.name)===n);
  assert.equal(matches.length,1);assert.equal(selected[0].model.variables.filter(v=>v.name===matches[0].name).length,1);return matches[0].name;
 });
 const behavior={};
 for(const s of selected){
  const t=s.run.series.time,count=Math.min(50,t.length),indices=Array.from({length:count},(_,i)=>count===1?0:Math.round(i*(t.length-1)/(count-1)));
  const data={time:indices.map(i=>t[i])};for(const n of names){const col=s.run.series[normalize(n)];assert(Array.isArray(col));data[n]=indices.map(i=>col[i]);}behavior[s.id]=data;
 }
 const feedbacks=selected.map(s=>s.feedback.content);
 const manifest={runs:selected.map(s=>({run_id:s.id,revision:s.run.revision,model_sha256:s.run.model_sha256,run_sha256:s.feedback.run_sha256,simulator:s.run.simulator,settings:s.run.settings,execution:s.run.execution,model:s.model})),variables:names,detailed:false,behavior_sha256:comparisonHash(behavior),feedback_sha256:feedbacks.map(comparisonHash)};
 assert(bytes(manifest)<=MAX_COMPARISON_MANIFEST_BYTES);validatePairData(behavior,manifest);validateComparativeFeedback({runIds:ids,feedbackContent:feedbacks},manifest);
 return {caseId,ids,names,selected,manifest,behavior,feedbacks,reference:loaded.reference,question:RUBRIC.question,evidence_sha256:comparisonHash({manifest,behavior,feedbacks})};
}
export function matchedSingleCallWires(wire){
 assert(Array.isArray(wire.messages)&&wire.messages.filter(m=>m.role==='system').length===1);
 assert(wire.response_format?.type==='json_schema'&&!wire.tools?.length);
 const direct=structuredClone(wire),ablation=structuredClone(wire);
 ablation.messages.find(m=>m.role==='system').content=ABLATION_SYSTEM;
 same(direct.messages.filter(m=>m.role!=='system'),ablation.messages.filter(m=>m.role!=='system'));
 const strip=w=>({...w,messages:w.messages.filter(m=>m.role!=='system')});same(strip(direct),strip(ablation));
 return {ile_direct_full_feedback:direct,ile_system_ablation:ablation};
}
// No arm name, provider label, routing trace, hypothesis or mapping in reviewer packet.
// Real provider outputs are required; a controlled capture cannot be scored.
export function blindPacket({caseId,reference,question,records},{allowControlled=false,idFactory=randomUUID}={}){
 assert(records.length===ARMS.length);same(records.map(r=>r.arm).sort(),[...ARMS].sort());
 const outputs=[],key=[];
 for(const r of records){
  assert(r.origin==='real_provider'||(allowControlled&&r.origin==='controlled_fixture'),'CONTROLLED_OUTPUT_NOT_SEMANTIC_EVIDENCE');
  assert(typeof r.text==='string'&&r.text.trim()&&r.text.length<=24000);
  const id=idFactory();assert(typeof id==='string'&&id.length&& !key.some(x=>x.id===id));
  key.push({id,arm:r.arm,output_sha256:comparisonHash(r.text),origin:r.origin});outputs.push({id,text:r.text});
 }
 outputs.sort((a,b)=>a.id.localeCompare(b.id));key.sort((a,b)=>a.id.localeCompare(b.id));
 return {review:{contract:CONTRACT,caseId,question,reference,targets:[...TARGETS],outputs,semantic_accuracy:allowControlled?'not_measured':'pending_annotation'},privateKey:key};
}
export function validateAnnotation(review,annotation){
 const output=review.outputs.find(o=>o.id===annotation.output_id);assert(output,'UNKNOWN_OUTPUT');
 assert(typeof annotation.reviewer==='string'&&annotation.reviewer.trim());
 assert(Array.isArray(annotation.claims)&&Array.isArray(annotation.omissions));
 for(const c of annotation.claims){
  assert(Number.isSafeInteger(c.start)&&Number.isSafeInteger(c.end)&&c.start>=0&&c.end>c.start&&c.end<=output.text.length);
  assert.equal(output.text.slice(c.start,c.end),c.quote);
  assert(typeof c.proposition==='string'&&c.proposition.trim()&&Object.hasOwn(RUBRIC.labels,c.label)&&typeof c.reason==='string'&&c.reason.trim());
  assert(Array.isArray(c.reference_paths)&&c.reference_paths.every(p=>typeof p==='string'));
  if(c.label==='supported'||c.label==='contradicted')assert(c.reference_paths.length>0);
  for(const p of c.reference_paths){
   assert(p.startsWith('/'));let value=review.reference;for(const token of p.slice(1).split('/').map(t=>t.replaceAll('~1','/').replaceAll('~0','~'))){assert(value!==null&&typeof value==='object'&&Object.hasOwn(value,token),'UNKNOWN_REFERENCE_PATH');value=value[token];}
  }
 }
 assert.equal(new Set(annotation.omissions).size,annotation.omissions.length);assert(annotation.omissions.every(t=>TARGETS.includes(t)));
 return {status:'annotation_shape_valid_not_semantically_adjudicated',counts:Object.fromEntries(Object.keys(RUBRIC.labels).map(l=>[l,annotation.claims.filter(c=>c.label===l).length])),omissions:[...annotation.omissions]};
}
