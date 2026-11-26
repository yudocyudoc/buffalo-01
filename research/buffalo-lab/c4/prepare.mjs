import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import {LLMWrapper} from '../../../utilities/LLMWrapper.js';
import Seldon from '../../../engines/seldon/engine.js';
import {groups} from '../../../evals/categories/feedbackExplanation.js';
import {protocol,sha,buildWire} from './wire.mjs';
const dir=process.argv[2]??'c4-pilot';
mkdirSync(dir,{recursive:true});
const cases=Object.values(groups).flat();
const captures={};
let pending=[];
const original=LLMWrapper.prototype.createChatCompletion;
LLMWrapper.prototype.createChatCompletion=async function(messages,model,schema,reasoningEffort){
 const parsed={response:'Controlled capture only.',feedbackInformationRequired:false};
 assert(schema.safeParse(parsed).success);
 pending.push({messages:structuredClone(messages),schema:z.toJSONSchema(schema),sourceModel:model,sourceReasoning:reasoningEffort??null});
 return {parsed};
};
try{
 for(const id of protocol.case_ids){
  const fixture=JSON.parse(readFileSync(new URL('../../../evals/categories/feedbackExplanationData/'+id+'.json',import.meta.url)));
  const matches=cases.filter(t=>JSON.stringify(t.currentModel)===JSON.stringify(fixture.model)&&
   JSON.stringify(t.additionalParameters.feedbackContent)===JSON.stringify(fixture.feedback));
  assert.equal(matches.length,1,id);
  const t=matches[0];pending=[];
  const result=await new Seldon().generate(t.prompt,structuredClone(fixture.model),{underlyingModel:'gemini-3.8-flash',feedbackContent:structuredClone(fixture.feedback)});
  assert(!result.err&&result.output.textContent.includes('Controlled capture'));
  assert.equal(pending.length,1);
  const capture=pending[0];
  assert(capture.messages.some(m=>m.content.includes(JSON.stringify(fixture.model,null,2))));
  assert(capture.messages.some(m=>m.content.includes(JSON.stringify(fixture.feedback,null,2))));
  assert.equal(capture.messages.at(-1).content,t.prompt);
  captures[id]={...capture,fixture_sha256:sha(fixture),messages_sha256:sha(capture.messages),schema_sha256:sha(capture.schema)};
 }
}finally{LLMWrapper.prototype.createChatCompletion=original;}
const payloads=[];
for(const id of protocol.case_ids)for(const config of protocol.configs){
 const capture=captures[id];
 const wire=buildWire(capture,config);
 assert.equal(sha(wire.messages),capture.messages_sha256);
 payloads.push({case_id:id,config_id:config.id,model:config.model,wire,wire_sha256:sha(wire),bytes:Buffer.byteLength(JSON.stringify(wire))});
}
assert.equal(payloads.length,18);
// Balance and interleave cases/models by deterministic cyclic rotation.
// No seed claim: same independent request repeated; provider may cache input.
const matrix=[];
for(let repeat=0;repeat<protocol.repetitions;repeat++)for(let k=0;k<protocol.case_ids.length;k++){
 const id=protocol.case_ids[(k+repeat)%protocol.case_ids.length];
 for(let j=0;j<protocol.configs.length;j++){
  const config=protocol.configs[(j+k+2*repeat)%protocol.configs.length];
  const p=payloads.find(x=>x.case_id===id&&x.config_id===config.id);
  matrix.push({id:'C4-'+id+'-'+config.id+'-r'+(repeat+1),case_id:id,config_id:config.id,repeat:repeat+1,wire_sha256:p.wire_sha256});
 }
}
assert.equal(matrix.length,54);
assert.equal(new Set(matrix.map(x=>x.id)).size,54);
const pilot=matrix.filter(x=>x.case_id==='bassDiffusion'&&x.repeat===1);
assert.equal(pilot.length,6);
const plan={protocol:protocol.protocol,live_provider_calls:0,captures,payloads,pilot,matrix};
writeFileSync(join(dir,'requests.json'),JSON.stringify(plan,null,2)+'\n');
const summary={protocol:protocol.protocol,live_provider_calls:0,case_count:Object.keys(captures).length,unique_payloads:payloads.length,pilot_calls:pilot.length,matrix_calls:matrix.length,
 payloads:payloads.map(({case_id,config_id,model,bytes,wire_sha256})=>({case_id,config_id,model,bytes,wire_sha256})),
 // Planning envelope, not a billing guarantee. Context window is not input
 // token count; actual billable reasoning/cache tokens must be retained.
 illustrative_usd:protocol.configs.reduce((sum,c)=>sum+9*(40000*c.price[0]+8192*c.price[1])/1e6,0)};
writeFileSync(join(dir,'summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary));
