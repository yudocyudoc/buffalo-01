// C1.1a: original engine and original built-in handler boundary.
// Capture the actual parameters reaching LLMWrapper.createChatCompletion,
// not the subsequent provider SDK wire. No provider or agent-planning call.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {LLMWrapper} from '../../../utilities/LLMWrapper.js';
import Seldon from '../../../engines/seldon/engine.js';
import Narrative from '../../../engines/ltm-narrative/engine.js';
import {createDiscussModelWithSeldonTool} from '../../../agent/tools/builtin/discussModelWithSeldon.js';
import {createGenerateLtmNarrativeTool} from '../../../agent/tools/builtin/generateLtmNarrative.js';
import {groups} from '../../../evals/categories/feedbackExplanation.js';

const prompt='Please explain the behavior of this model over time based on the feedback loop dominance analysis provided.';
const modelName='gemini-3.8-flash';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const root=new URL('../../../',import.meta.url);
const names=['armsRace','bassDiffusion','inventoryWorkforce','predatorPrey','marketGrowth','maibab'];
const report={mode:'controlled_wrapper_boundary',live_provider_calls:0,agent_planner_exercised:false,
  semantic_accuracy:'NOT_MEASURED',rows:[]};
const original=LLMWrapper.prototype.createChatCompletion;
let captures=[],fixture;
LLMWrapper.prototype.createChatCompletion=async function(messages,model,schema,reasoningEffort){
 const format=z.toJSONSchema(schema);
 const parsed=Object.hasOwn(format.properties,'narrativeMarkdown')?
 {feedbackLoops:fixture.feedback.feedbackLoops.map((l,i)=>({identifier:l.identifier,name:'Controlled loop '+i,description:'Controlled description.'})),
 narrativeMarkdown:'Controlled narrative, not semantic evidence.'}:
 {response:'Controlled discussion, not semantic evidence.',feedbackInformationRequired:false};
 assert(schema.safeParse(parsed).success,'Controlled result must match original schema');
 captures.push({messages:structuredClone(messages),model,reasoningEffort:reasoningEffort??null,schema:format,controlled_response:parsed});
 return {parsed};
};
const marker='C1_SYNTHETIC_CACHE_SENTINEL';
const cache={time:[0,1], [marker]:[123,456]};
function observe(capture){
 const {messages}=capture;
 const hasJSON=value=>messages.some(m=>m.content.includes(JSON.stringify(value,null,2))||m.content.includes(JSON.stringify(value)));
 const feedback=structuredClone(fixture.feedback);
 // LTM strips certain default names before constructing the request.
 for(const l of feedback.feedbackLoops)if(l.identifier&&l.name&&/^(B\d|Bu\d|R\d|Ru\d|U\d)/.test(l.name))delete l.name;
 return {model_structure_present:hasJSON(fixture.model),feedback_present:hasJSON(fixture.feedback)||hasJSON(feedback),
   behavior_marker_present:messages.some(m=>m.content.includes(marker)),
   user_prompt_present:messages.some(m=>m.content.includes(prompt)),
   brevity_instruction_present:messages.some(m=>m.content.includes('Be brief in your response.')),
   request_sha256:sha(capture),message_count:messages.length};
}
async function run(name,route,behavior,call){
 captures=[];
 const output=await call();
 assert.equal(captures.length,1,name+' '+route);
 assert(!output.err&&!output.isError,JSON.stringify(output));
 const c=captures[0],o=observe(c);
 assert.equal(o.feedback_present,true,name+' feedback');
 assert.equal(o.model_structure_present,route.includes('seldon'),name+' model structure');
 assert.equal(o.behavior_marker_present,behavior,name+' behavior');
 assert.equal(o.brevity_instruction_present,route==='tool_seldon',name+' brevity');
 assert.equal(o.user_prompt_present,route!=='tool_ltm',name+' user prompt');
 report.rows.push({name,route,synthetic_behavior_cache:behavior,...o,capture:c,output});
}
try{
 const tests=Object.values(groups).flat();
 assert.equal(tests.length,names.length);
 for(let i=0;i<names.length;i++){
  const name=names[i];
  fixture=JSON.parse(readFileSync(new URL('evals/categories/feedbackExplanationData/'+name+'.json',root)));
  assert.deepEqual(tests[i].currentModel,fixture.model);
  assert.deepEqual(tests[i].additionalParameters.feedbackContent,fixture.feedback);
  assert.equal(tests[i].prompt,prompt);
  const params=()=>({underlyingModel:modelName,feedbackContent:structuredClone(fixture.feedback)});
  await run(name,'direct_seldon',false,()=>new Seldon().generate(prompt,structuredClone(fixture.model),params()));
  await run(name,'direct_ltm',false,()=>new Narrative().generate(prompt,structuredClone(fixture.model),params()));
  for(const behavior of [false,true]){
   const dir=mkdtempSync(join(tmpdir(),'buffalo-c1-'));
   try{
    const runId='reference-run';
    writeFileSync(join(dir,'feedback.json'),JSON.stringify({feedbackContent:fixture.feedback,runIds:[runId]}));
    if(behavior)writeFileSync(join(dir,'variable_data_0001.json'),JSON.stringify({[runId]:cache}));
    const manager={getSession:()=>({clientId:'offline-c1',agentName:'merlin'}),getClientModel:()=>structuredClone(fixture.model),getSessionTempDir:()=>dir};
    const profile={provider:'google',toolModels:{nonBuild:{normal:modelName,hard:modelName}}};
    const unexpected=()=>{throw Error('UNEXPECTED_CLIENT_REQUEST')};
    const opts={difficulty:'normal',parameters:{runIds:[runId]}};
    await run(name,'tool_seldon',behavior,()=>createDiscussModelWithSeldonTool(manager,'offline',unexpected,profile).handler({prompt,...opts}));
    await run(name,'tool_ltm',behavior,()=>createGenerateLtmNarrativeTool(manager,'offline',unexpected,profile).handler(opts));
   }finally{rmSync(dir,{recursive:true,force:true})}
  }
 }
 assert.equal(report.rows.length,36);
 report.complete=true;
}finally{
 LLMWrapper.prototype.createChatCompletion=original;
 writeFileSync(process.argv[2]??'c1-route-controls.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({mode:report.mode,complete:report.complete??false,rows:report.rows.length,live_provider_calls:0,
   route_counts:Object.fromEntries(['direct_seldon','direct_ltm','tool_seldon','tool_ltm'].map(r=>[r,report.rows.filter(x=>x.route===r).length]))}));
}
