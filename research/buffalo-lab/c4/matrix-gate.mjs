// Offline only. Verify pilot and export the remaining frozen matrix, never invoke a provider.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {protocol,sha} from './wire.mjs';
import {acceptedGemmaModel} from '../../../infra/private-merlin/gemma-response.mjs';
const dir=process.argv[2];
assert(dir,'Pass prepared artifact directory');
const load=name=>JSON.parse(readFileSync(new URL('./'+name,import.meta.url)));
const plan=JSON.parse(readFileSync(join(dir,'requests.json')));
const pilot=load('pilot-requests.json'),ledger=load('pilot-ledger.json'),audit=load('pilot-semantic-review.json');
assert.equal(ledger.max_attempts,6);
assert.equal(ledger.attempts.length,6);
assert.equal(audit.items.length,6);
const receipts=[];
for(const attempt of ledger.attempts){
 const p=pilot.pilot.find(p=>p.id===attempt.id);
 const row=plan.matrix.find(r=>r.id===attempt.id);
 const config=protocol.configs.find(c=>c.id===attempt.config);
 assert(p&&row&&config);
 assert.equal(attempt.status,'RETURNED');
 assert.equal(sha(p.wire),p.wire_sha256);
 assert.equal(row.wire_sha256,p.wire_sha256);
 assert.equal(attempt.wire_sha256,p.wire_sha256);
 const r=load('pilot-receipts/'+attempt.config+'.json');
 assert.equal(r.transport,'RETURNED');
 assert.equal(r.finish_reason,'stop');
 assert(r.parsed_schema_valid);
 assert.equal(r.result.choices.length,1);
 assert.equal(r.result.choices[0].message.role,'assistant');
 const model=r.observed_model;
 assert(config.id.startsWith('gemma-')?acceptedGemmaModel(model):model===config.model);
 assert(Number.isSafeInteger(r.usage.prompt_tokens)&&r.usage.prompt_tokens>0);
 assert(Number.isSafeInteger(r.usage.completion_tokens)&&r.usage.completion_tokens>0&&r.usage.completion_tokens<=protocol.max_output_tokens);
 assert.equal(r.usage.total_tokens,r.usage.prompt_tokens+r.usage.completion_tokens);
 const output=JSON.parse(r.result.choices[0].message.content);
 for(const c of audit.items.find(x=>x.id===attempt.id).claims)assert(output.response.includes(c.quote),'Unanchored claim');
 receipts.push({id:attempt.id,config:attempt.config,model,usage:r.usage,estimated_usd:(r.usage.prompt_tokens*config.price[0]+r.usage.completion_tokens*config.price[1])/1e6,html_only:false});
}
const seen=new Set(receipts.map(r=>r.id));
assert.equal(seen.size,6);
const pending=plan.matrix.filter(r=>!seen.has(r.id));
assert.equal(pending.length,48);
assert.equal(new Set(pending.map(x=>x.id)).size,48);
const payloadDir=join(dir,'matrix-payloads');mkdirSync(payloadDir,{recursive:true});
const payloads=[];
for(const p of plan.payloads){
 assert.equal(sha(p.wire),p.wire_sha256);
 const config=protocol.configs.find(c=>c.id===p.config_id);
 assert(config&&p.model===config.model);
 const name=p.case_id+'-'+p.config_id+'.json';
 writeFileSync(join(payloadDir,name),JSON.stringify(p,null,2)+'\n');
 payloads.push({case_id:p.case_id,config_id:p.config_id,model:p.model,wire_sha256:p.wire_sha256,bytes:p.bytes,file:'matrix-payloads/'+name});
}
const matrix=pending.map(r=>{
 const p=payloads.find(p=>p.case_id===r.case_id&&p.config_id===r.config_id);
 assert(p&&p.wire_sha256===r.wire_sha256);
 return {...r,model:p.model,payload_file:p.file,bytes:p.bytes};
});
const next={protocol:protocol.protocol,source_commit:ledger.source_commit,phase:'C4.2',execution:'DISABLED',
 max_additional_attempts:48,max_cumulative_attempts:54,completed_pilot:receipts,pending:matrix,
 policy:{reserve_before_call:true,retries:0,parallelism:1,no_truncation:true,keep_failed_attempts:true,case_input_gate:'Provider-specific context check; bytes are not tokens. Record rejects and stop on ambiguous transport.',budget:'Requires explicit spend authorization and verified live transport for larger inputs. Estimated charges are not a hard cap.'}};
writeFileSync(join(dir,'matrix-manifest.json'),JSON.stringify(next,null,2)+'\n');
console.log(JSON.stringify({protocol:protocol.protocol,verified_pilot:receipts.length,pending:matrix.length,pending_by_case:Object.fromEntries(protocol.case_ids.map(id=>[id,matrix.filter(r=>r.case_id===id).length])),pilot_estimated_usd:receipts.reduce((s,r)=>s+r.estimated_usd,0),live_provider_calls:0}));
