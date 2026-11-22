/**
 * Stage 3B-1: read-only admission preflight for the ORIGINAL interactive
 * Buffalo WebSocket protocol (initialize_session -> select_agent -> chat).
 *
 * This module neither opens a socket nor dispatches GitHub/Workers AI.
 * A SOURCE_ATTESTED proof NEVER grants inference permission by itself.
 */
export const LIVE_GRANT_SCHEMA='BUFFALO_ORIGINAL_LIVE_GRANT_V1';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA40=/^[a-f0-9]{40}$/;
const SHA64=/^[a-f0-9]{64}$/;
const AGENTS=new Set(['merlin','socrates','themis','athena_SFD']);

const receipt=(grantId,reason,code,other={})=>({
 code,body:{
  schema:'BUFFALO_ORIGINAL_LIVE_ADMISSION_PREFLIGHT_V1',
  grant_id:grantId,reason_code:reason,execution_started:false,
  websocket_connected:false,provider_post_count:0,
  ...other
 }
});
const parseDate=value=>{
 if(typeof value!=='string')return null;
 const v=Date.parse(value.includes('T')?value:value.replace(' ','T')+'Z');
 return Number.isFinite(v)?v:null;
};
export class OriginalLiveAdmission {
 constructor(db,{now=()=>new Date(),runtimeCommit=null}={}){
  if(!db?.prepare)throw Error('LIVE_DB_NOT_BOUND');
  this.db=db;this.now=now;this.runtimeCommit=runtimeCommit;
 }
 async preflight(grantId){
  if(typeof grantId!=='string'||!UUID.test(grantId))
   return receipt(null,'INVALID_GRANT_ID',400);
  // Read-only JOIN: no minting approval, dispatch, updates or grant via SOURCE_ATTESTED.
  const sql=[
   'SELECT g.grant_id,g.handoff_id,g.grant_schema,g.agent,g.provider,g.mode,',
   'g.commit_sha,g.manifest_sha256,g.state,g.consent_for_inference,',
   'g.max_posts,g.max_neurons,g.approval_actor,g.approval_receipt_sha256,',
   'g.approved_at,g.expires_at,g.claimed_at,g.revoked_at,',
   'a.proof_status,a.commit_sha AS proof_commit_sha,',
   'a.manifest_sha256 AS proof_manifest_sha256,',
   'h.agent AS original_agent,h.mode AS original_mode,',
   'h.commit_sha AS original_commit_sha,',
   'h.manifest_sha256 AS original_manifest_sha256',
   'FROM buffalo_full_live_grants g',
   'LEFT JOIN buffalo_full_source_attestations a ON a.handoff_id=g.handoff_id',
   'LEFT JOIN buffalo_full_handoffs h ON h.handoff_id=g.handoff_id',
   'WHERE g.grant_id=?'
  ].join(' ');
  const row=await this.db.prepare(sql).bind(grantId).first();
  if(!row)return receipt(grantId,'LIVE_GRANT_NOT_FOUND',404);
  if(row.grant_schema!==LIVE_GRANT_SCHEMA||
    row.proof_status!=='SOURCE_ATTESTED'||
    !AGENTS.has(row.agent)||row.provider!=='cloudflare'||row.mode!=='sfd'||
    row.original_agent!==row.agent||row.original_mode!==row.mode||
    !SHA40.test(row.commit_sha??'')||row.commit_sha!==row.proof_commit_sha||
    row.commit_sha!==row.original_commit_sha||
    !SHA64.test(row.manifest_sha256??'')||
    row.manifest_sha256!==row.proof_manifest_sha256||
    row.manifest_sha256!==row.original_manifest_sha256)
   return receipt(grantId,'LIVE_SOURCE_IDENTITY_MISMATCH',409);
  if(row.revoked_at||row.state==='REVOKED')
   return receipt(grantId,'LIVE_GRANT_REVOKED',403);
  if(row.state!=='APPROVED'||row.consent_for_inference!==1)
   return receipt(grantId,'LIVE_INFERENCE_NOT_AUTHORIZED',403);
  if(!Number.isInteger(row.max_posts)||row.max_posts<1||row.max_posts>50||
   !Number.isInteger(row.max_neurons)||row.max_neurons<1||row.max_neurons>1_000_000||
   !row.approval_actor||!SHA64.test(row.approval_receipt_sha256??'')||
   !parseDate(row.approved_at))
   return receipt(grantId,'LIVE_APPROVAL_INVALID',409);
  const expiry=parseDate(row.expires_at);
  if(!expiry||expiry<=this.now().getTime())
   return receipt(grantId,'LIVE_GRANT_EXPIRED',403);
  if(row.claimed_at)
   return receipt(grantId,'LIVE_GRANT_ALREADY_CLAIMED',409);
  // No real WebSocket upgrade before a pinned original runtime and measured
  // per-session neuron/post budget are independently verified.
  if(!SHA40.test(this.runtimeCommit??'')||
    this.runtimeCommit!==row.commit_sha)
   return receipt(grantId,'LIVE_RUNTIME_COMMIT_NOT_VERIFIED',503);
  return receipt(grantId,'ADMISSION_CONDITIONS_MET_RUNTIME_NOT_INVOKED',200,{
   preflight:'PASS_READ_ONLY',agent:row.agent,provider:row.provider,mode:row.mode,
   commit_sha:row.commit_sha,manifest_sha256:row.manifest_sha256,
   max_posts:row.max_posts,max_neurons:row.max_neurons,
   websocket_gateway_implemented:false,
   runtime_budget_enforcement_verified:false
  });
 }
}
