// C1.1b — real original eval runner and Merlin manual loop, scripted SDK
// boundary. Tool choices are controlled, not evidence of autonomous planning.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {z} from 'zod';
import {AgentOrchestrator} from '../../../agent/AgentOrchestrator.js';
import {runAgent} from '../../../agent/utilities/AgentEvalRunner.js';
import {LLMWrapper} from '../../../utilities/LLMWrapper.js';
import {completion} from '../../../infra/full-runtime/gateway.mjs';
import {ENDPOINT} from '../../../infra/private-merlin/protocol.mjs';
import {GEMMA} from '../../../infra/private-merlin/gemma-response.mjs';

const root=new URL('../../../',import.meta.url);
const names=['armsRace','bassDiffusion','inventoryWorkforce','predatorPrey','marketGrowth','maibab'];
const prompt='Please explain the behavior of this model over time based on the feedback loop dominance analysis provided.';
const toolModel='gemini-3.8-flash';
const report={mode:'original_eval_runner_google_manual_scripted_sdk',live_provider_calls:0,
 autonomous_tool_selection:'NOT_MEASURED',semantic_accuracy:'NOT_MEASURED',rows:[],gateway:[]};
const originalCompletion=LLMWrapper.prototype.createChatCompletion;
const originalStart=AgentOrchestrator.prototype.startConversation;
let active;
const clone=structuredClone;
const engineText='C1_CONTROLLED_ENGINE_OUTPUT';
const finalText='C1_CONTROLLED_FINAL_OUTPUT';
LLMWrapper.prototype.createChatCompletion=async function(messages,model,schema,reasoningEffort){
 assert(active,'Unexpected nested engine call');
 assert.equal(model,toolModel);
 const format=z.toJSONSchema(schema);
 const isNarrative=Object.hasOwn(format.properties,'narrativeMarkdown');
 assert.equal(isNarrative,active.route==='merlin_ltm');
 const parsed=isNarrative?
  {feedbackLoops:active.fixture.feedback.feedbackLoops.map((l,i)=>({identifier:l.identifier,name:'Controlled loop '+i,description:'Controlled description.'})),narrativeMarkdown:engineText}:
  {response:engineText,feedbackInformationRequired:false};
 assert(schema.safeParse(parsed).success);
 active.engines.push({messages:clone(messages),model,reasoningEffort:reasoningEffort??null,schema:format,response:parsed});
 return {parsed};
};
AgentOrchestrator.prototype.startConversation=async function(...args){
 assert(active);
 const a=active;
 assert.equal(this.provider,'google');
 assert.equal(this.configManager.getAgentMode(),'manual');
 const response=part=>({candidates:[{content:{role:'model',parts:[part]},finishReason:'STOP'}],
   usageMetadata:{promptTokenCount:100,candidatesTokenCount:20,totalTokenCount:120}});
 this.gemini={
  caches:{
   create:async request=>{
    a.cacheRequests.push(clone(request));
    return {name:'cachedContents/c1-offline-'+a.name+'-'+a.route};
   },
   delete:async request=>{a.cacheDeletes.push(clone(request));}
  },
  models:{generateContent:async request=>{
   const step=a.planner.length;
   const available=a.cacheRequests.at(-1)?.config?.tools?.flatMap(t=>t.functionDeclarations??[]).map(t=>t.name)??[];
   assert(available.includes('get_feedback_information'));
   assert(available.includes(a.tool),'Tool absent in original Merlin declarations');
   let part;
   if(step===0)part={functionCall:{name:'get_feedback_information',args:{runIds:[]}}};
   else if(step===1){
    const feedbackResponse=request.contents.flatMap(m=>m.parts??[]).find(p=>p.functionResponse?.name==='get_feedback_information');
    assert(feedbackResponse,'Feedback result did not return to agent');
    part={functionCall:{name:a.tool,args:{difficulty:'normal',...(a.route==='merlin_seldon'?{prompt}:{parameters:{problemStatement:prompt}})}}};
   }else if(step===2){
    const nested=request.contents.flatMap(m=>m.parts??[]).filter(p=>p.functionResponse?.name===a.tool);
    assert.equal(nested.length,1);
    assert(JSON.stringify(nested[0]).includes(engineText),'Nested engine result did not reach synthesis');
    part={text:finalText};
   }else throw Error('UNEXPECTED_PLANNER_ITERATION');
   const r=response(part);
   a.planner.push({request:clone(request),response:clone(r)});
   return r;
  }}
 };
 try{return await originalStart.apply(this,args);}
 finally{this.destroy();}
};
async function gatewayProbe(engineEnabled){
 let offered,providerCalls=0;
 const tools=['get_feedback_information','discuss_model_with_seldon','generate_ltm_narrative'].map(name=>({type:'function',function:{name,description:'controlled',parameters:{type:'object',properties:{}}}}));
 const request=new Request(ENDPOINT,{method:'POST',body:JSON.stringify({model:GEMMA,messages:[{role:'user',content:prompt}],tools,stream:false})});
 const ai={run:async(model,wire)=>{
  providerCalls++;assert.equal(model,GEMMA);
  offered=wire.tools.map(t=>t.function.name);
  return {model:GEMMA,choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:finalText}}],
    usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}};
 }};
 const result=await completion(request,ai,async()=>1,async()=>{}, {engineEnabled});
 assert.equal(result.status,200);
 assert.equal(providerCalls,1);
 assert.deepEqual(offered,engineEnabled?['get_feedback_information','generate_ltm_narrative']:['get_feedback_information']);
 report.gateway.push({engineEnabled,requested:tools.map(t=>t.function.name),offered,status:result.status,controlled_calls:providerCalls});
}
try{
 // Test the actual product allowlist without changing it. This is a transport
 // compatibility finding, separate from the unmodified original agent route.
 await gatewayProbe(false);await gatewayProbe(true);
 for(const name of names){
  const fixture=JSON.parse(readFileSync(new URL('evals/categories/feedbackExplanationData/'+name+'.json',root)));
  for(const route of ['merlin_seldon','merlin_ltm']){
   const a={name,route,fixture,tool:route==='merlin_seldon'?'discuss_model_with_seldon':'generate_ltm_narrative',
    planner:[],engines:[],cacheRequests:[],cacheDeletes:[]};
   active=a;
   const row={name,route,tool:a.tool,planner:a.planner,engines:a.engines,cacheRequests:a.cacheRequests,cacheDeletes:a.cacheDeletes};
   report.rows.push(row);
   try{
    const out=await runAgent(prompt,clone(fixture.model),{agentName:'merlin',agentMode:'manual',provider:'google',mode:'sfd-discuss',
      toolModels:{nonBuild:{normal:toolModel,hard:toolModel}},feedbackContent:clone(fixture.feedback)});
    row.output=out.explanation;row.tools=out.toolLog;
    assert.equal(a.planner.length,3);assert.equal(a.engines.length,1);
    const used=out.toolLog.filter(t=>['get_feedback_information',a.tool].includes(t.toolName));
    assert.deepEqual(used.map(t=>t.toolName),['get_feedback_information',a.tool]);
    assert(used.every(t=>t.isError===false),JSON.stringify(used));
    assert(out.explanation.includes(finalText));
    assert(!out.explanation.includes(engineText),'Raw tool output incorrectly passed as user-facing synthesis');
    for(const key of ['variables','relationships','specs'])assert.deepEqual(out.lastModel[key],fixture.model[key]);
    row.status='PASS';
   }catch(e){row.status='FAIL';row.error=String(e?.stack??e);}
   finally{active=null;writeFileSync(process.argv[2]??'c1-agent-routes.json',JSON.stringify(report,null,2)+'\n');}
  }
 }
 report.complete=report.rows.length===12&&report.rows.every(x=>x.status==='PASS');
 console.log(JSON.stringify({mode:report.mode,complete:report.complete,rows:report.rows.map(r=>({name:r.name,route:r.route,status:r.status,
  planner:r.planner.length,engines:r.engines.length,...(r.error?{error:r.error}: {})})),gateway:report.gateway,live_provider_calls:0}));
 assert(report.complete,'Agent route controls failed');
}finally{
 active=null;LLMWrapper.prototype.createChatCompletion=originalCompletion;AgentOrchestrator.prototype.startConversation=originalStart;
 writeFileSync(process.argv[2]??'c1-agent-routes.json',JSON.stringify(report,null,2)+'\n');
}
