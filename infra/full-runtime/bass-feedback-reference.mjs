// Frozen upstream reference, NOT a new LTM computation or a simulation run.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {groups} from '../../evals/categories/feedbackExplanation.js';

export const SOURCE=Object.freeze({
 repository:'UB-IAD/sd-ai',
 fork_commit:'d36b52340e3abde5e6880ecae7212dfea054f039',
 json_blob:'c87fc9d8369cdb0abb97bb7ba1e2a88c32df931e',
 stmx_blob:'f760d13c9a17a2deaf2fa6abaeaad38d3ef15fd2',
 evaluator_blob:'0cc2703065ed69156b23c4d973f9592262be1c1a',
 category:'feedbackExplanation',group:'simpleFeedbackExplanation',
 case_name:'Bass diffusion dynamics explanation'
});
const scoreKey='Percent of Model Behavior Explained by Loop';
const root=new URL('../../evals/categories/',import.meta.url);
const bytes=name=>readFileSync(new URL(name,root));
const sha256=x=>createHash('sha256').update(x).digest('hex');
const gitBlob=x=>createHash('sha1').update('blob '+x.length+'\0').update(x).digest('hex');
export function assertBlob(data,expected){assert.equal(gitBlob(data),expected,'UPSTREAM_BLOB_IDENTITY');}
export const EXPECTED_FACTS=Object.freeze([
 'There are two feedback loops in this model.',
 'One of the two feedback loops is balancing (negative).',
 'One of the two feedback loops is reinforcing (positive).',
 "Before time 9.625 the system's behavior is dominated by the reinforcing (positive) feedback loop.",
 "After time 9.625, the system's behavior is dominated by the balancing (negative) feedback loop."
]);
export function validateBassReference({model,feedback}){
 assert.equal(feedback.valid,true);
 assert.deepEqual(model.specs,{dt:0.0625,startTime:0,stopTime:15,timeUnits:'Years'});
 assert.equal(model.variables.length,10);
 const vars=new Map(model.variables.map(v=>[v.name,v]));
 assert.equal(vars.size,10);
 assert.equal(vars.get('Market Size').equation,'1000000');
 assert.equal(vars.get('Adopters').equation,'1');
 assert.equal(vars.get('Potential Adopters').equation,'Market_Size - Adopters');
 assert.equal(vars.get('contact rate').equation,'100');
 assert.equal(vars.get('adoption fraction').equation,'0.015');
 assert.equal(vars.get('adopting').equation,'adoption_from_word_of_mouth');
 assert.deepEqual(feedback.dominantLoopsByPeriod,[
  {dominantLoops:['R1'],startTime:0,endTime:9.625},
  {dominantLoops:['B1'],startTime:9.625,endTime:15}
 ]);
 assert.equal(feedback.feedbackLoops.length,2);
 const loops=new Map(feedback.feedbackLoops.map(l=>[l.identifier,l]));
 assert.equal(loops.size,2);
 const expected={
  R1:{polarity:'+',nodes:['adoption from word of mouth','adopting','Adopters','adopter contacts','potentials contacts with adopters']},
  B1:{polarity:'-',nodes:['adoption from word of mouth','adopting','Potential Adopters','probability of contact with potentials','potentials contacts with adopters']}
 };
 for(const [id,{polarity,nodes}] of Object.entries(expected)){
  const loop=loops.get(id);
  assert.equal(loop.polarity,polarity,'LOOP_POLARITY');
  assert.equal(loop.links.length,nodes.length);
  let sign=1;
  for(let i=0;i<nodes.length;i++){
   const link=loop.links[i];
   assert.equal(link.from,nodes[i]);assert.equal(link.to,nodes[(i+1)%nodes.length]);
   assert(vars.has(link.from)&&vars.has(link.to));
   const edge=model.relationships.find(e=>e.from===link.from&&e.to===link.to);
   assert(edge,'MISSING_MODEL_EDGE');
   assert(['+','-'].includes(link.polarity));
   if(edge.polarity!==undefined)assert.equal(link.polarity,edge.polarity,'EDGE_POLARITY');
   if(link.polarity==='-')sign*=-1;
  }
  assert.equal(sign,polarity==='+'?1:-1,'LOOP_SIGN_PRODUCT');
  assert.equal(loop[scoreKey].length,241);
  for(const [i,point] of loop[scoreKey].entries()){
   assert.equal(point.time,i/16,'SCORE_GRID');
   assert(Number.isFinite(point.value)&&point.value>=0&&point.value<=100,'SCORE_RANGE');
  }
 }
 const R=loops.get('R1')[scoreKey],B=loops.get('B1')[scoreKey];
 assert.equal(R[0].value,0);assert.equal(B[0].value,0);
 let maxError=0;
 for(let i=1;i<R.length;i++){
  const error=Math.abs(R[i].value+B[i].value-100);
  assert(error<=1e-9,'SCORE_NORMALIZATION');maxError=Math.max(error,maxError);
  assert.equal(R[i].value>50,R[i].time<9.625,'R1_PERIOD');
  assert.equal(B[i].value>50,B[i].time>=9.625,'B1_PERIOD');
 }
 return {points_per_loop:R.length,initial_scores:{R1:0,B1:0},max_normalization_error:maxError,
  periods:structuredClone(feedback.dominantLoopsByPeriod),
  samples:[1,153,154,240].map(i=>({time:R[i].time,R1:R[i].value,B1:B[i].value}))};
}
export function loadBassReference(){
 const raw=bytes('feedbackExplanationData/bassDiffusion.json');
 const stmx=bytes('feedbackExplanationData/bassDiffusion.stmx');
 const evaluator=bytes('feedbackExplanation.js');
 assertBlob(raw,SOURCE.json_blob);assertBlob(stmx,SOURCE.stmx_blob);assertBlob(evaluator,SOURCE.evaluator_blob);
 const original=JSON.parse(raw);
 // The SD-JSON fixture omits method; the separate original XMILE file declares Euler.
 // Do not inject it into or rewrite the original model.
 const xml=stmx.toString('utf8');
 const spec=xml.match(/<sim_specs\b[^>]*>[\s\S]*?<\/sim_specs>/)?.[0];
 assert(spec&&/\bmethod="Euler"/.test(spec)&&/\bisee:loop_scores="true"/.test(spec));
 assert.match(spec,/<start>0<\/start>/);assert.match(spec,/<stop>15<\/stop>/);
 assert.match(spec,/<dt reciprocal="true">16<\/dt>/);
 const test=groups[SOURCE.group].find(c=>c.name===SOURCE.case_name);
 assert(test,'UPSTREAM_CASE_PRESENT');
 assert.deepEqual(test.currentModel,original.model);
 assert.deepEqual(test.additionalParameters,{feedbackContent:original.feedback});
 assert.deepEqual(test.expectations,EXPECTED_FACTS);
 const summary=validateBassReference(original);
 return {model:original.model,feedback:original.feedback,prompt:test.prompt,expectations:[...test.expectations],
  provenance:{...SOURCE,source_kind:'upstream-precomputed-reference',computed_by_buffalo:false,
   json_sha256:sha256(raw),stmx_sha256:sha256(stmx),evaluator_sha256:sha256(evaluator),
   model_sha256:sha256(JSON.stringify(original.model)),feedback_sha256:sha256(JSON.stringify(original.feedback)),
   xmile_method:'Euler',trajectory_available:false,source_run_id:null},summary};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const {provenance,summary,prompt,expectations}=loadBassReference();
 console.log('FULL_BASS_FEEDBACK_REFERENCE '+JSON.stringify({status:'UPSTREAM_REFERENCE_VALIDATED',provenance,summary,prompt,expectations}));
}
