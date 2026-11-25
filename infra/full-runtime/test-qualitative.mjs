import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {evaluate as translation, groups as graphs} from '../../evals/categories/qualitativeTranslation.js';
import {evaluate as conformance, groups as constraints} from '../../evals/categories/conformance.js';
import {LLMWrapper} from '../../utilities/LLMWrapper.js';
import {GEMMA} from '../private-merlin/gemma-response.mjs';
import {session} from './test-session.mjs';

const named=(items,name)=>{
  const item=items.find(candidate=>candidate.name===name);
  assert(item,name);
  return item;
};
const positive=named(graphs.singleRelationship,'extract a reinforcing relationship down');
const reinforcing=named(graphs.singleFeedbackLoop,'extract a reinforcing feedback loop with 3 variables');
const balancing=named(graphs.singleFeedbackLoop,'extract a balancing feedback loop with 3 variables');
const road=named(constraints.specificConformance,'include requested variables for Road Rage');
const cases=[positive,reinforcing,balancing,road];
const roadEdges=[
  {from:'Traffic Congestion',to:'Driver Stress',polarity:'+'},
  {from:'Driver Stress',to:'Accidents',polarity:'+'},
  {from:'Accidents',to:'Traffic Congestion',polarity:'+'}
];
const schema=LLMWrapper.prototype.generateQualitativeSDJSONResponseSchema(false).toJSONSchema();
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const schemaHash=digest(schema);

// Only the provider reply is scripted. REST, schema generation, evaluation,
// AgentWorker, the client acknowledgement and the durable gateway are real.
export function qualitativeFixture(model,wire){
  assert.equal(model,GEMMA);
  let message,finish='stop';
  if(wire.response_format){
    assert.deepEqual(wire.response_format,{type:'json_schema',json_schema:schema});
    // The upstream SDK lane joins the engine's background, user request and
    // feedback instruction into one user message separated by blank lines.
    const userText=wire.messages.filter(m=>m.role==='user').map(m=>m.content).join('\n\n');
    const example=cases.find(c=>userText.includes(c.additionalParameters.backgroundKnowledge)
      &&userText.includes(c.prompt));
    assert(example,'original case prompt and background must reach the binding');
    const edges=example===road?roadEdges:example.expectations;
    const relationships=edges.map(edge=>({...edge,reasoning:'Controlled case',polarityReasoning:'Controlled sign'}));
    message={role:'assistant',content:JSON.stringify({title:example.name,explanation:'Offline example',relationships})};
  }else if(wire.messages.some(m=>m.role==='tool'&&m.tool_call_id==='cld-generation')){
    message={role:'assistant',content:'Diagram generated.'};
  }else{
    assert(wire.tools.some(t=>t.function.name==='generate_qualitative_model'));
    assert(!wire.tools.some(t=>t.function.name==='generate_quantitative_model'));
    const args={prompt:balancing.prompt,difficulty:'normal',parameters:{backgroundKnowledge:balancing.additionalParameters.backgroundKnowledge}};
    message={role:'assistant',tool_calls:[{id:'cld-generation',type:'function',
      function:{name:'generate_qualitative_model',arguments:JSON.stringify(args)}}]};
    finish='tool_calls';
  }
  return {model,choices:[{index:0,finish_reason:finish,message}],usage:{prompt_tokens:100,completion_tokens:50}};
}

function checkModel(model,example){
  if(example===road){
    assert.deepEqual(conformance({model},road.expectations),[]);
  }else{
    assert.deepEqual(translation({model},example.expectations),[]);
    const names=[...new Set(example.expectations.flatMap(r=>[r.from,r.to]))].sort();
    assert.deepEqual(model.variables.map(v=>v.name).sort(),names);
  }
}

export async function exerciseQualitative(base,key,save,receipt){
  for(const [i,example] of cases.entries()){
    const response=await fetch(base+'/api/v1/engines/qualitative/generate',{method:'POST',
      headers:{Authentication:key,'content-type':'application/json'},body:JSON.stringify({prompt:example.prompt,...example.additionalParameters})});
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.success,true,result.message);
    checkModel(result.model,example);
    const recorded=await receipt(i+1);
    assert.equal(recorded.status,'OK');assert.equal(recorded.schema_sha256,schemaHash);
    assert.equal(recorded.predicates.schema_valid,true);
    // Upstream varies the English phrasing. Preserve the actual public test
    // input and graph so this CI result can be interpreted independently.
    console.log(JSON.stringify({case:example.name,category:example===road?'conformance':'qualitativeTranslation',
      provider:'controlled',prompt:example.prompt,parameters:example.additionalParameters,
      expected:example.expectations,observed:result.model.relationships.map(({from,to,polarity})=>({from,to,polarity})),
      schema_sha256:schemaHash,model_sha256:digest(result.model)}));
    if(example===positive){
      const [e]=result.model.relationships;
      for(const [relationships,failure] of [
        [[{...e,from:e.to,to:e.from}],'Real relationships not found'],
        [[{...e,polarity:'-'}],'Incorrect polarity discovered'],
        [[e,{...e,to:'Invented'}],'Fake relationships found']
      ])assert(translation({model:{relationships}},example.expectations).some(f=>f.type===failure));
    }
    if(example===road){
      const incomplete={model:{variables:[],relationships:[roadEdges[0]]}};
      assert(conformance(incomplete,road.expectations).some(f=>f.type==='Missing required variable'));
    }
  }
  await session({mode:'cld',key,agent:'merlin',model:{variables:[],relationships:[]},edit:true,save,
    scenario:{message:balancing.prompt+' '+balancing.additionalParameters.backgroundKnowledge,
      verify(model,tools){
        checkModel(model,balancing);
        assert(tools.some(t=>t.event==='tool_call_completed'&&t.name==='generate_qualitative_model'&&t.isError===false));
      }}});
}

export async function reopenQualitative(key,model){
  checkModel(model,balancing);
  await session({mode:'cld',key,agent:'merlin',model});
}
