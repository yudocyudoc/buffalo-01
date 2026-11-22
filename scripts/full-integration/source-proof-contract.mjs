/**
 * Buffalo Full source-proof V1: authenticated GitHub evidence, NOT an agent result.
 * No model execution, provider request, grader result or paid consent.
 */
import {HANDOFF_KIND,HANDOFF_SCHEMA,normalizeHandoff,digestHandoff} from './handoff-contract.mjs';

export const SOURCE_PROOF_SCHEMA='BUFFALO_FULL_SOURCE_PROOF_V1';
export const SOURCE_PROOF_WORKFLOW='buffalo-full-source-proof.yml';
export const SOURCE_PROOF_MEMBER='buffalo-full-source-proof.json';
export const SOURCE_PROOF_EVIDENCE='GITHUB_SOURCE_METADATA_ONLY';
export const SOURCE_PROOF_KEYS=Object.freeze([
 'schema','handoff_id','kind','commit','workflow','manifest_sha256','agent','benchmark',
 'scenario_id','case_index','mode','source_sha256','agent_config_sha256','prompt_sha256',
 'initial_model_sha256','parameters_sha256','evidence'
]);
const SHA256_RE=/^[a-f0-9]{64}$/;
const keysEqual=(v,expected)=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).sort().join(',')===[...expected].sort().join(',');
function check(v,error){if(!v)throw Error('SOURCE_PROOF_'+error)}
export function sourceProofFor(manifest,manifestSha){
 const normalized=normalizeHandoff(manifest);
 check(typeof manifestSha==='string'&&SHA256_RE.test(manifestSha),'BAD_DIGEST');
 return Object.freeze({
  schema:SOURCE_PROOF_SCHEMA,handoff_id:normalized.handoff_id,
  kind:HANDOFF_KIND,commit:normalized.commit_sha,workflow:SOURCE_PROOF_WORKFLOW,
  manifest_sha256:manifestSha,agent:normalized.agent,benchmark:normalized.benchmark,
  scenario_id:normalized.scenario_id,case_index:normalized.case_index,mode:normalized.mode,
  source_sha256:normalized.source_sha256,
  agent_config_sha256:normalized.agent_config_sha256,
  prompt_sha256:normalized.prompt_sha256,
  initial_model_sha256:normalized.initial_model_sha256,
  parameters_sha256:normalized.parameters_sha256,
  evidence:{kind:SOURCE_PROOF_EVIDENCE}
 });
}
export async function checkSourceProof(row,run,claimedProof){
 check(row?.kind===HANDOFF_KIND&&row.schema_version===HANDOFF_SCHEMA&&
  row.state==='REGISTERED_UNVERIFIED'&&row.execution_allowed===0&&
  row.provenance_verified===0&&row.github_run_id===null,'INVALID_HANDOFF_ROW');
 const input={
  schema_version:row.schema_version,handoff_id:row.handoff_id,kind:row.kind,
  agent:row.agent,benchmark:row.benchmark,scenario_id:row.scenario_id,
  case_index:row.case_index,mode:row.mode,commit_sha:row.commit_sha,
  source_sha256:row.source_sha256,agent_config_sha256:row.agent_config_sha256,
  prompt_sha256:row.prompt_sha256,initial_model_sha256:row.initial_model_sha256,
  parameters_sha256:row.parameters_sha256
 };
 check(await digestHandoff(input)===row.manifest_sha256,'HANDOFF_DB_DIGEST_DRIFT');
 check(run?.head_sha===row.commit_sha,'COMMIT_MISMATCH');
 const expected=sourceProofFor(input,row.manifest_sha256);
 check(keysEqual(claimedProof,SOURCE_PROOF_KEYS)&&
  keysEqual(claimedProof.evidence,['kind']),'RESULT_FIELDS');
 for(const [key,value] of Object.entries(expected)){
  if(key==='evidence')check(claimedProof.evidence.kind===value.kind,'EVIDENCE_KIND');
  else check(claimedProof[key]===value,'RESULT_'+key.toUpperCase());
 }
 return expected;
}
