// Evaluate the exact CLD returned by original REST; no equation or graph repair.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {LLMWrapper} from '../../utilities/LLMWrapper.js';
import {evaluate as translation,groups} from '../../evals/categories/qualitativeTranslation.js';
import {CASE_ID,CASE_NAME,REQUEST,EXPECTED,SCHEMA_SHA256} from './qualitative-smoke-case.mjs';
import {PASS,validInference} from './remote-qualitative.mjs';

const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function verifyQualitative(receipt){
 assert.equal(receipt.status,PASS);
 assert(receipt.container_stopped&&receipt.single_reservation&&validInference(receipt.inference));
 assert.equal(receipt.case_id,CASE_ID);
 assert.deepEqual(receipt.case_input,REQUEST);
 const schema=LLMWrapper.prototype.generateQualitativeSDJSONResponseSchema(false).toJSONSchema();
 assert.equal(hash(schema),SCHEMA_SHA256,'EXACT_ORIGINAL_QUALITATIVE_SCHEMA_HASH');
 // Upstream randomizes the wording at import; compare its ground truth and
 // non-random parameters while using the precommitted wording for inference.
 const original=groups.singleFeedbackLoop.find(x=>x.name===CASE_NAME);
 assert(original,'ORIGINAL_CASE_PRESENT');
 assert.deepEqual(original.expectations,EXPECTED);
 const {backgroundKnowledge,...parameters}=original.additionalParameters;
 const {backgroundKnowledge:fixed,...requestParameters}=REQUEST;
 assert.deepEqual({prompt:original.prompt,...parameters},requestParameters);
 const model=receipt.model;
 assert(Array.isArray(model?.variables)&&Array.isArray(model?.relationships));
 const before=hash(model);
 // Transport integrity concerns only the graph returned by the engine.
 const endpoints=new Set(model.relationships.flatMap(r=>[r.from,r.to]));
 assert.deepEqual(model.variables.map(v=>v.name).sort(),[...endpoints].sort(),'CLD_ENDPOINT_INTEGRITY');
 // Semantic scoring is exclusively the original upstream evaluator, which
 // tolerates singular/plural and compares directed endpoints and polarities.
 const failures=translation({model},EXPECTED);
 assert.equal(hash(model),before,'MODEL_MUTATED');
 return {
  status:failures.length?'FULL_REMOTE_QUALITATIVE_TRANSLATION_FAIL':'FULL_REMOTE_QUALITATIVE_TRANSLATION_PASS',
  evidence_source:receipt.fixture_only===true?'controlled-provider-fixture':'remote-receipt',
  case_id:CASE_ID,case_name:CASE_NAME,category:'qualitativeTranslation',
  denominator:1,passed:failures.length?0:1,case_input:REQUEST,
  schema_sha256:SCHEMA_SHA256,model_sha256:before,
  expected:EXPECTED,observed:model.relationships.map(({from,to,polarity})=>({from,to,polarity})),failures,
  provider_model:receipt.inference.response_model,usage:receipt.inference.usage,neurons:receipt.inference.neurons
 };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const receipt=JSON.parse(readFileSync(process.argv[2],'utf8'));
 assert.equal(receipt.fixture_only===true,process.argv[3]==='--fixture','FIXTURE_MODE_MISMATCH');
 const result=verifyQualitative(receipt);
 console.log(JSON.stringify(result));
 if(result.passed!==1)process.exitCode=1;
}
