/** D1 stage-2 declarations are separate from the proven offline task table. */
import {
 normalizeHandoff,normalizeHandoffId,digestHandoff,
 HANDOFF_STATE,HANDOFF_KIND
} from '../../scripts/full-integration/handoff-contract.mjs';

const inserted=r=>r?.meta?.changes===1;
export class D1FullHandoffStore {
 constructor(db){if(!db?.prepare||!db?.batch)throw Error('D1_BINDING_REQUIRED');this.db=db}
 async read(id){
  return this.db.prepare('SELECT * FROM buffalo_full_handoffs WHERE handoff_id=?')
   .bind(normalizeHandoffId(id)).first();
 }
 async create(candidate){
  const manifest=normalizeHandoff(candidate);
  const digest=await digestHandoff(manifest);
  const insert=this.db.prepare('INSERT INTO buffalo_full_handoffs ('+
   'handoff_id,kind,schema_version,state,agent,benchmark,scenario_id,case_index,mode,'+
   'commit_sha,source_sha256,agent_config_sha256,prompt_sha256,initial_model_sha256,'+
   'parameters_sha256,manifest_sha256,execution_allowed,provenance_verified,github_run_id'+
   ") VALUES (?,?,?,'REGISTERED_UNVERIFIED',?,?,?,?,?,?,?,?,?,?,?,?,0,0,NULL) "+
   'ON CONFLICT(handoff_id) DO NOTHING').bind(
   manifest.handoff_id,HANDOFF_KIND,manifest.schema_version,
   manifest.agent,manifest.benchmark,manifest.scenario_id,manifest.case_index,manifest.mode,
   manifest.commit_sha,manifest.source_sha256,manifest.agent_config_sha256,
   manifest.prompt_sha256,manifest.initial_model_sha256,manifest.parameters_sha256,digest
  );
  const event=this.db.prepare('INSERT INTO buffalo_full_handoff_events '+
   '(handoff_id,actor,event,manifest_sha256) '+
   "SELECT ?,'WORKER_HANDOFF_V1','DECLARATION_ADMITTED',? WHERE changes()=1")
   .bind(manifest.handoff_id,digest);
  const [result]=await this.db.batch([insert,event]);
  const saved=await this.read(manifest.handoff_id);
  if(!saved||saved.kind!==HANDOFF_KIND||saved.state!==HANDOFF_STATE||
   saved.manifest_sha256!==digest||saved.execution_allowed!==0||
   saved.provenance_verified!==0||saved.github_run_id!==null)
   throw Error('FULL_HANDOFF_ID_CONFLICT');
  return {created:inserted(result),row:saved};
 }
}
