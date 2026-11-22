/** Read-only GitHub attestation verifier for one declared handoff.
 * An authenticated GitHub API response + verified ZIP, not a cryptographic
 * signature or proof of successful agent behaviour.
 */
import {GitHubOffline,REPO,extractSingleMemberZip} from './github.mjs';
import {SOURCE_PROOF_WORKFLOW,SOURCE_PROOF_MEMBER,checkSourceProof}
 from '../../scripts/full-integration/source-proof-contract.mjs';

const expectedPath='.github/workflows/'+SOURCE_PROOF_WORKFLOW;
const hashBytes=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
 .map(x=>x.toString(16).padStart(2,'0')).join('');

export class GitHubFullSourceProof {
 constructor(token,transport){this.api=new GitHubOffline(token,transport)}
 async verify(row,runId){
  if(!Number.isSafeInteger(runId)||runId<1)throw Error('SOURCE_PROOF_BAD_RUN_ID');
  if(!row||row.state!=='REGISTERED_UNVERIFIED'||row.execution_allowed!==0||
   row.provenance_verified!==0||row.github_run_id!==null)
   throw Error('SOURCE_PROOF_BAD_HANDOFF_STATE');
  const workflow=await this.api.get('/actions/workflows/'+SOURCE_PROOF_WORKFLOW);
  if(workflow?.path!==expectedPath||!Number.isSafeInteger(workflow.id)||workflow.id<1)
   throw Error('SOURCE_PROOF_BAD_WORKFLOW');
  const run=await this.api.get('/actions/runs/'+runId);
  if(!run||run.id!==runId||run.workflow_id!==workflow.id||
   run.event!=='workflow_dispatch'||run.head_branch!=='main'||
   run.head_sha!==row.commit_sha||
   run.display_title!=='Buffalo full source proof '+row.handoff_id||
   run.repository?.full_name!==REPO||run.head_repository?.full_name!==REPO||
   run.run_attempt!==1)
   throw Error('SOURCE_PROOF_BAD_RUN_IDENTITY');
  if(run.status!=='completed'||run.conclusion!=='success')
   throw Error('SOURCE_PROOF_RUN_NOT_SUCCESSFUL');
  if(!Number.isFinite(Date.parse(run.created_at??'')))
   throw Error('SOURCE_PROOF_BAD_RUN_TIMESTAMP');
  const list=await this.api.get('/actions/runs/'+runId+'/artifacts?per_page=100');
  if(!Array.isArray(list?.artifacts)||list.total_count!==1||list.artifacts.length!==1)
   throw Error('SOURCE_PROOF_ARTIFACT_CARDINALITY');
  const artifact=list.artifacts[0];
  if(!Number.isSafeInteger(artifact.id)||artifact.id<1||
   artifact.name!=='buffalo-full-source-'+row.handoff_id||
   artifact.expired||!Number.isSafeInteger(artifact.size_in_bytes)||
   artifact.size_in_bytes<98||artifact.size_in_bytes>65536)
   throw Error('SOURCE_PROOF_BAD_ARTIFACT_IDENTITY');
  const archive=await this.api.get('/actions/artifacts/'+artifact.id+'/zip',{raw:true});
  const artifact_sha256=await hashBytes(archive);
  if(artifact.digest!=='sha256:'+artifact_sha256)
   throw Error('SOURCE_PROOF_BAD_ARTIFACT_DIGEST');
  const extracted=extractSingleMemberZip(archive,SOURCE_PROOF_MEMBER);
  const result_sha256=await hashBytes(extracted);
  let proof;
  try{proof=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(extracted))}
  catch{throw Error('SOURCE_PROOF_INVALID_JSON')}
  await checkSourceProof(row,run,proof);
  return Object.freeze({handoff_id:row.handoff_id,manifest_sha256:row.manifest_sha256,
   repo:REPO,commit_sha:run.head_sha,workflow_id:workflow.id,
   github_run_id:run.id,github_artifact_id:artifact.id,
   artifact_sha256,result_sha256});
 }
}
