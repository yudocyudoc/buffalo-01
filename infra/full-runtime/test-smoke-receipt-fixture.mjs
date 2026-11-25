// Synthetic receipt solely for the offline OCI verifier contract.
import {createHash} from 'node:crypto';
import {LLMWrapper} from '../../utilities/LLMWrapper.js';
import {simulationModel} from './simulation-fixture.mjs';
import {GEMMA} from '../private-merlin/gemma-response.mjs';
import {PASS} from './remote-quantitative.mjs';
const schema=LLMWrapper.prototype.generateQuantitativeSDJSONResponseSchema(false,false,false,false).toJSONSchema();
const model=simulationModel();model.variables[0].equation='5';model.specs.stopTime=4;
const receipt={fixture_only:true,status:PASS,container_stopped:true,single_reservation:true,model,
 inference:{channel:'original-engine',status:'OK',response_format:'json_schema',response_model:GEMMA,
 finish_reason:'stop',invocation_id:'58532b8a-b25e-4b67-a90b-10db57da263b',request_sha256:'c'.repeat(64),
 schema_sha256:createHash('sha256').update(JSON.stringify(schema)).digest('hex'),
 predicates:{schema_valid:true,total_tokens_valid:true,json_valid:true},failed_predicates:[],
 usage:{prompt_tokens:500,completion_tokens:100,total_tokens:null},max_completion_tokens:8192,neurons:1.5}};
console.log(JSON.stringify(receipt));
