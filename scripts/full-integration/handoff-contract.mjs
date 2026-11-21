/** Stage 2 handoff: descriptor only, never an executable job or provider approval. */
export const HANDOFF_KIND='BUFFALO_FULL_HANDOFF_V1';
export const HANDOFF_SCHEMA='BUFFALO_FULL_HANDOFF_MANIFEST_V1';
export const HANDOFF_STATE='REGISTERED_UNVERIFIED';
export const HANDOFF_AGENTS=Object.freeze(['merlin','socrates','themis','athena_SFD']);
export const HANDOFF_FIELDS=Object.freeze([
 'schema_version','handoff_id','kind','agent','benchmark','scenario_id','case_index','mode',
 'commit_sha','source_sha256','agent_config_sha256','prompt_sha256',
 'initial_model_sha256','parameters_sha256'
]);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[0-9a-f]{64}$/i, COMMIT=/^[0-9a-f]{40}$/i;
const sameKeys=(value,keys)=>Object.keys(value).sort().join(',')===[...keys].sort().join(',');
function assertString(value,re,code){
 if(typeof value!=='string'||!re.test(value))throw Error('FULL_HANDOFF_INVALID_'+code);
 return value.toLowerCase();
}
export function normalizeHandoffId(id){return assertString(id,UUID,'ID')}
export function normalizeHandoff(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||
  !sameKeys(value,HANDOFF_FIELDS))throw Error('FULL_HANDOFF_INVALID_FIELDS');
 if(value.kind!==HANDOFF_KIND||value.schema_version!==HANDOFF_SCHEMA)
  throw Error('FULL_HANDOFF_INVALID_SCHEMA_OR_KIND');
 if(!HANDOFF_AGENTS.includes(value.agent))throw Error('FULL_HANDOFF_INVALID_AGENT');
 if(value.benchmark!=='policyImplementation'||value.mode!=='sfd')
  throw Error('FULL_HANDOFF_INVALID_BENCHMARK');
 if(typeof value.scenario_id!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value.scenario_id))
  throw Error('FULL_HANDOFF_INVALID_SCENARIO');
 if(!Number.isSafeInteger(value.case_index)||value.case_index<0||value.case_index>999)
  throw Error('FULL_HANDOFF_INVALID_CASE_INDEX');
 // Rebuild in the ONLY allowed property order. No user commands, prompts, tokens,
 // spending authorizations, URLs, provider parameters or result claims can enter.
 return Object.freeze({
  schema_version:HANDOFF_SCHEMA,
  handoff_id:normalizeHandoffId(value.handoff_id),
  kind:HANDOFF_KIND,agent:value.agent,benchmark:'policyImplementation',
  scenario_id:value.scenario_id,case_index:value.case_index,mode:'sfd',
  commit_sha:assertString(value.commit_sha,COMMIT,'COMMIT'),
  source_sha256:assertString(value.source_sha256,HASH,'SOURCE_SHA'),
  agent_config_sha256:assertString(value.agent_config_sha256,HASH,'AGENT_SHA'),
  prompt_sha256:assertString(value.prompt_sha256,HASH,'PROMPT_SHA'),
  initial_model_sha256:assertString(value.initial_model_sha256,HASH,'INITIAL_MODEL_SHA'),
  parameters_sha256:assertString(value.parameters_sha256,HASH,'PARAMETERS_SHA')
 });
}
export async function digestHandoff(value){
 const normalized=normalizeHandoff(value);
 const bytes=new TextEncoder().encode(JSON.stringify(normalized));
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
 return [...digest].map(x=>x.toString(16).padStart(2,'0')).join('');
}
/** Strict status is an admission receipt, not independent GitHub provenance. */
export function handoffReceipt(row){
 if(!row)return null;
 return {
  schema_version:row.schema_version,handoff_id:row.handoff_id,kind:row.kind,
  state:row.state,agent:row.agent,benchmark:row.benchmark,scenario_id:row.scenario_id,
  case_index:row.case_index,mode:row.mode,commit_sha:row.commit_sha,
  source_sha256:row.source_sha256,agent_config_sha256:row.agent_config_sha256,
  prompt_sha256:row.prompt_sha256,initial_model_sha256:row.initial_model_sha256,
  parameters_sha256:row.parameters_sha256,manifest_sha256:row.manifest_sha256,
  execution_allowed:false,provenance_verified:false,github_run_id:null
 };
}
