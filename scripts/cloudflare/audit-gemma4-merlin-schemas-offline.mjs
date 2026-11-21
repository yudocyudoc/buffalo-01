/**
 * Evidence-only audit: reconstruct EXACT Buffalo builtin Zod->JSON Schema tool
 * declarations offered in Merlin's original policyImplementation/dialysisClinic
 * sfd eval. The script does NOT instantiate AgentOrchestrator, send requests,
 * execute tools, mutate a model or use any Cloudflare credentials.
 *
 * The test intentionally creates the real BuiltInToolProvider and calls the
 * same isToolActive / toJSONSchema branch in AgentOrchestrator, NOT a manually
 * recreated collection of toy schemas.
 */
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {BuiltInToolProvider} from '../../agent/tools/BuiltInToolProvider.js';
import {isToolActive} from '../../agent/tools/toolAvailability.js';
import {hydrateMessagesForOpenAi} from '../../agent/utilities/ToolResultFormatter.js';
import {groups} from '../../evals/categories/policyImplementation.js';

const scenarioId='dialysisClinic';
const baseline=groups.policyImplementation.find(
  t=>t.expectations?.scenario===scenarioId
);
assert.ok(baseline?.currentModel?.variables?.length,
  'Original dialysisClinic case must exist with a populated model');
assert.equal(baseline.additionalParameters.mode,'sfd');
assert.ok(!baseline.additionalParameters.analysisTools,
  'This case should have zero dynamic analysis tools');

const session={
  mode:'sfd',clientModel:structuredClone(baseline.currentModel),
  clientTools:[],supportsArrays:true,supportsModules:true,supportsSubTypes:false,
  clientId:'offline-schema-audit',agentName:'merlin'
};
const sessionManager={
  getSession:()=>session,
  getSessionTempDir:()=>tmpdir(),
  getClientModel:()=>session.clientModel
};
const provider=new BuiltInToolProvider(
  sessionManager,'audit-gemma4-schemas',async()=>{},
  {provider:'cloudflare',intelligence:'standard'},
  {},true // Original Merlin frontmatter grants can_write_to_local_sandbox
);
const collection=provider.getTools().tools;
const wire=Object.entries(collection)
  .filter(([name,tool])=>isToolActive(tool,{
    mode:'sfd',session,canWriteToLocalSandbox:true
  }))
  .map(([name,tool])=>({type:'function',function:{
    name,description:tool.description,parameters:tool.inputSchema.toJSONSchema()
  }}));
assert.ok(wire.length>=15,'Expected substantial real Merlin tool set');
assert.ok(wire.some(t=>t.function.name==='read_model_section'));
assert.ok(wire.some(t=>t.function.name==='edit_variables'));
assert.ok(wire.some(t=>t.function.name==='run_model'));

const watch=new Set(['anyOf','oneOf','allOf','$ref','$defs',
  'const','not','if','then','else','patternProperties']);
const reserved=new Set(['type','description','properties','required','nullable']);
const findings=[];
let totalSchemaChars=0;
let totalDescriptionChars=0;
const keywordTotals={};
for(const {function:fn} of wire){
  const schema=fn.parameters;
  const risks=[];
  let schemaNodes=0,depthMax=0,propertyCount=0;
  const visit=(node,path,depth)=>{
    if(!node||typeof node!=='object')return;
    schemaNodes++;depthMax=Math.max(depthMax,depth);
    if(Array.isArray(node)){
      node.forEach((x,i)=>visit(x,path+'['+i+']',depth+1));
      return;
    }
    for(const [key,value] of Object.entries(node)){
      if(watch.has(key)){
        risks.push({kind:key,path});
        keywordTotals[key]=(keywordTotals[key]||0)+1;
      }
      if(key==='type'&&Array.isArray(value)){
        risks.push({kind:'union-type',path});
        keywordTotals['union-type']=(keywordTotals['union-type']||0)+1;
      }
      if(key==='properties'&&value&&typeof value==='object'){
        const names=Object.keys(value);
        propertyCount+=names.length;
        for(const name of names){
          if(reserved.has(name)){
            risks.push({kind:'reserved-property-name',path:path+'.properties.'+name});
            keywordTotals['reserved-property-name']=(keywordTotals['reserved-property-name']||0)+1;
          }
        }
      }
      visit(value,path+'.'+key,depth+1);
    }
  };
  visit(schema,'parameters',0);
  const schemaChars=JSON.stringify(schema).length;
  const descriptionChars=fn.description?.length||0;
  totalSchemaChars+=schemaChars;
  totalDescriptionChars+=descriptionChars;
  findings.push({
    name:fn.name,schemaChars,descriptionChars,
    propertyCount,schemaNodes,maxDepth:depthMax,riskCount:risks.length,
    riskPaths:risks.slice(0,60)
  });
}
// The original OpenAI hydration formatter is an identity transform on
// text-only function turns. No tool execution is attempted.
const toolExchange=[
 {role:'user',content:'Please inspect model specs'},
 {role:'assistant',content:'',tool_calls:[{
   id:'call_probe',type:'function',
   function:{name:'read_model_section',arguments:'{"section":"specs"}'}
 }]},
 {role:'tool',tool_call_id:'call_probe',content:'{"startTime":0,"stopTime":24,"dt":1}'}
];
assert.deepEqual(hydrateMessagesForOpenAi(toolExchange,{}),toolExchange);
const withReasoning=structuredClone(toolExchange);
withReasoning[1].reasoning_content='synthetic-reasoning-metadata';
assert.deepEqual(hydrateMessagesForOpenAi(withReasoning,{}),withReasoning,
  'Formatter should preserve reasoning if it is present; another layer drops it');

const metrics={
 scenarioId,agent:'merlin',mode:'sfd',
 source:'Original BuiltInToolProvider + isToolActive + Zod toJSONSchema',
 dynamicClientTools:session.clientTools.length,
 toolCount:wire.length,
 totalSchemaChars,totalDescriptionChars,
 fullToolDeclarationChars:JSON.stringify(wire).length,
 totalPotentialSerializationChars:JSON.stringify({tools:wire}).length,
 keywordTotals,
 highestSchemaSize:findings.slice().sort((a,b)=>b.schemaChars-a.schemaChars)
   .slice(0,8).map(({name,schemaChars,riskCount})=>({name,schemaChars,riskCount})),
 toolSummaries:findings
};
console.log('AUDIT_GEMMA4_TOOL_SCHEMA_JSON_BEGIN');
console.log(JSON.stringify(metrics,null,2));
console.log('AUDIT_GEMMA4_TOOL_SCHEMA_JSON_END');
console.log('PASS: real Merlin builtin Zod schemas and OpenAI tool-turn formatter audited, no network');
