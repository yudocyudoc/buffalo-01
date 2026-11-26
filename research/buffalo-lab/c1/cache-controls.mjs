// C1.1c: probe cache identity and availability using original loader/handlers.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {LLMWrapper} from '../../../utilities/LLMWrapper.js';
import {loadBehaviorContent} from '../../../agent/tools/builtin/toolHelpers.js';
import {createDiscussModelWithSeldonTool} from '../../../agent/tools/builtin/discussModelWithSeldon.js';
import {createGenerateLtmNarrativeTool} from '../../../agent/tools/builtin/generateLtmNarrative.js';
const fixture=JSON.parse(readFileSync(new URL('../../../evals/categories/feedbackExplanationData/bassDiffusion.json',import.meta.url)));
const report={mode:'synthetic_cache_identity',live_provider_calls:0,rows:[]};
const old=LLMWrapper.prototype.createChatCompletion;
const dir=mkdtempSync(join(tmpdir(),'buffalo-c1-cache-'));
const model='gemini-3.8-flash';
const profile={provider:'google',toolModels:{nonBuild:{normal:model,hard:model}}};
let captured=[];
LLMWrapper.prototype.createChatCompletion=async function(messages,model,schema){
 captured.push(structuredClone(messages));
 const response=schema.shape.narrativeMarkdown?
 {feedbackLoops:fixture.feedback.feedbackLoops.map((x,i)=>({identifier:x.identifier,name:'Loop '+i,description:'Controlled.'})),narrativeMarkdown:'Controlled.'}:
 {response:'Controlled.',feedbackInformationRequired:false};
 assert(schema.safeParse(response).success);
 return {parsed:response};
};
const write=(name,data)=>writeFileSync(join(dir,name),JSON.stringify(data));
const a={time:[0,1],C1_COLUMN_A:[1,2]},b={time:[0,1],C1_COLUMN_B:[3,4]},c={time:[0,1],C1_COLUMN_C:[5,6]};
const feedback=structuredClone(fixture.feedback);
write('feedback.json',{feedbackContent:feedback,runIds:['run-A']});
const manager={getSession:()=>({clientId:'offline-c1',agentName:'merlin'}),getClientModel:()=>structuredClone(fixture.model),getSessionTempDir:()=>dir};
const unexpected=()=>{throw Error('Unexpected client request');};
const seldon=createDiscussModelWithSeldonTool(manager,'offline',unexpected,profile);
const ltm=createGenerateLtmNarrativeTool(manager,'offline',unexpected,profile);
async function exercise(label,runIds,expected,expectedMarkers){
 const actual=loadBehaviorContent(dir,runIds);
 assert.equal(actual,expected===undefined?undefined:JSON.stringify(expected),label);
 for(const [route,tool] of [['seldon',seldon],['ltm',ltm]]){
  captured=[];
  const result=await tool.handler({prompt:'Explain the model.',difficulty:'normal',parameters:{runIds}});
  assert.equal(result.isError,false,JSON.stringify(result));
  assert.equal(captured.length,1);
  const messages=captured[0];
  const markers=['C1_COLUMN_A','C1_COLUMN_B','C1_COLUMN_C'].filter(x=>messages.some(m=>m.content.includes(x)));
  assert.deepEqual(markers,expectedMarkers,label+' '+route);
  report.rows.push({label,route,requestedRuns:runIds,cachedFeedbackRuns:['run-A'],loaderResult:actual??null,markers,messages,
    // Both tools consume feedback.json without checking whether its runIds
    // match requested behavior. Their request succeeds even on mismatched runs.
    toolAccepted:true});
 }
}
try{
 await exercise('no cache',['run-A'],undefined,[]);
 write('variable_data_0001.json',{'run-A':a,'run-B':b});
 await exercise('two runs explicit',['run-A','run-B'],{'run-A':a,'run-B':b},['C1_COLUMN_A','C1_COLUMN_B']);
 await exercise('default selects last run',[],b,['C1_COLUMN_B']);
 await exercise('different run from feedback',['run-B'],b,['C1_COLUMN_B']);
 await exercise('nonexistent run',['run-X'],{},[]);
 write('variable_data_0002.json',{'run-A':c});
 await exercise('latest file replaces earlier columns',['run-A'],c,['C1_COLUMN_C']);
 await exercise('earlier run lost in latest file',['run-B'],{},[]);
 report.complete=true;
 console.log(JSON.stringify({mode:report.mode,complete:true,rows:report.rows.length,live_provider_calls:0,
  observations:report.rows.map(({label,route,markers,toolAccepted})=>({label,route,markers,toolAccepted}))}));
}finally{
 LLMWrapper.prototype.createChatCompletion=old;
 writeFileSync(process.argv[2]??'c1-cache-controls.json',JSON.stringify(report,null,2)+'\n');
 rmSync(dir,{recursive:true,force:true});
}
