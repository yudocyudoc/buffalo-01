/** Persist independently checked GitHub source metadata; never modify a handoff. */
import {normalizeHandoffId} from '../../scripts/full-integration/handoff-contract.mjs';
import {SOURCE_PROOF_SCHEMA,SOURCE_PROOF_WORKFLOW}
 from '../../scripts/full-integration/source-proof-contract.mjs';
import {REPO} from './github.mjs';
const inserted=r=>r?.meta?.changes===1;
const safeId=(n)=>Number.isSafeInteger(n)&&n>0;
const sha=/^[a-f0-9]{64}$/;
const exact=(a,b)=>[
 'handoff_id','manifest_sha256','repo','commit_sha','workflow_id','github_run_id',
 'github_artifact_id','artifact_sha256','result_sha256'
].every(key=>a?.[key]===b?.[key]);
export function sourceAttestationReceipt(row){
 if(!row)return null;
 return {
  proof_schema:row.proof_schema,proof_status:row.proof_status,
  handoff_id:row.handoff_id,manifest_sha256:row.manifest_sha256,
  repo:row.repo,workflow:row.workflow,workflow_id:row.workflow_id,
  github_run_id:row.github_run_id,github_artifact_id:row.github_artifact_id,
  commit_sha:row.commit_sha,artifact_sha256:row.artifact_sha256,
  result_sha256:row.result_sha256,execution_allowed:false,created_at:row.created_at
 };
}
export class D1FullSourceAttestationStore {
 constructor(db){if(!db?.prepare||!db?.batch)throw Error('D1_BINDING_REQUIRED');this.db=db}
 async read(id){
  return this.db.prepare('SELECT * FROM buffalo_full_source_attestations WHERE handoff_id=?')
   .bind(normalizeHandoffId(id)).first();
 }
 async save(handoff,evidence){
  const id=normalizeHandoffId(handoff?.handoff_id);
  if(handoff?.state!=='REGISTERED_UNVERIFIED'||handoff.execution_allowed!==0||
   handoff.provenance_verified!==0||handoff.github_run_id!==null||
   evidence?.handoff_id!==id||evidence?.manifest_sha256!==handoff.manifest_sha256||
   evidence?.commit_sha!==handoff.commit_sha||evidence?.repo!==REPO||
   !safeId(evidence.workflow_id)||!safeId(evidence.github_run_id)||
   !safeId(evidence.github_artifact_id)||
   !sha.test(evidence.artifact_sha256??'')||!sha.test(evidence.result_sha256??''))
   throw Error('SOURCE_PROOF_BAD_EVIDENCE');
  const statement=this.db.prepare(
   'INSERT INTO buffalo_full_source_attestations ('+
   'handoff_id,proof_schema,proof_status,repo,workflow,workflow_id,'+
   'github_run_id,github_artifact_id,commit_sha,manifest_sha256,'+
   'artifact_sha256,result_sha256,execution_allowed) '+
   "SELECT ?,'BUFFALO_FULL_SOURCE_PROOF_V1','SOURCE_ATTESTED',"+
   "'yudocyudoc/buffalo-01','buffalo-full-source-proof.yml',"+
   '?,?,?,?,?,?,?,0 FROM buffalo_full_handoffs '+
   "WHERE handoff_id=? AND state='REGISTERED_UNVERIFIED' AND "+
   'commit_sha=? AND manifest_sha256=? '+
   'ON CONFLICT(handoff_id) DO NOTHING'
  ).bind(id,evidence.workflow_id,evidence.github_run_id,evidence.github_artifact_id,
   evidence.commit_sha,evidence.manifest_sha256,evidence.artifact_sha256,
   evidence.result_sha256,id,evidence.commit_sha,evidence.manifest_sha256);
  const event=this.db.prepare(
   'INSERT INTO buffalo_full_source_events (handoff_id,actor,event,evidence_sha256) '+
   "SELECT ?,'WORKER_GITHUB_SOURCE_V1','SOURCE_ATTESTED',? WHERE changes()=1"
  ).bind(id,evidence.result_sha256);
  const [change]=await this.db.batch([statement,event]);
  const saved=await this.read(id);
  if(!saved||saved.proof_schema!==SOURCE_PROOF_SCHEMA||
   saved.proof_status!=='SOURCE_ATTESTED'||saved.workflow!==SOURCE_PROOF_WORKFLOW||
   saved.execution_allowed!==0||!exact(saved,evidence))
   throw Error('SOURCE_PROOF_PERSIST_CONFLICT');
  return {created:inserted(change),row:saved};
 }
}
