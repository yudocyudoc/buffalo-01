/** Stage 2.5: an explicit read-only GitHub check followed by immutable D1 receipt.
 * NO GitHub dispatch; no paid workflow, model, grader or simulation.
 */
import {normalizeHandoffId} from '../../scripts/full-integration/handoff-contract.mjs';
import {sourceAttestationReceipt} from './full-source-attestation-store.mjs';

export class FullSourceAttestationService {
 constructor(handoffs,attestations,github){
  this.handoffs=handoffs;this.attestations=attestations;this.github=github;
 }
 async inspect(id){
  const handoffId=normalizeHandoffId(id);
  const row=await this.handoffs.read(handoffId);
  if(!row)return {code:404,body:{error:'HANDOFF_NOT_FOUND'}};
  const proof=await this.attestations.read(handoffId);
  return {code:200,body:{handoff_id:handoffId,
   attested:!!proof,source_proof:sourceAttestationReceipt(proof),
   execution_allowed:false}};
 }
 async attest(id,runId){
  const handoffId=normalizeHandoffId(id);
  if(!Number.isSafeInteger(runId)||runId<1)
   return {code:400,body:{error:'INVALID_RUN_ID'}};
  const row=await this.handoffs.read(handoffId);
  if(!row)return {code:404,body:{error:'HANDOFF_NOT_FOUND'}};
  const existing=await this.attestations.read(handoffId);
  if(existing){
   if(existing.github_run_id!==runId)
    return {code:409,body:{error:'SOURCE_PROOF_ALREADY_BOUND'}};
   return {code:200,body:{attested:true,created:false,
    source_proof:sourceAttestationReceipt(existing),execution_allowed:false}};
  }
  let verified;
  try{verified=await this.github.verify(row,runId)}
  catch{
   // External failure or mismatch must never create an attestation.
   // Do not leak GitHub bodies, resource identifiers or tokens.
   return {code:409,body:{error:'SOURCE_PROOF_NOT_VERIFIED',attested:false}};
  }
  try{
   const saved=await this.attestations.save(row,verified);
   return {code:saved.created?201:200,body:{attested:true,created:saved.created,
    source_proof:sourceAttestationReceipt(saved.row),execution_allowed:false}};
  }catch{
   return {code:409,body:{error:'SOURCE_PROOF_NOT_PERSISTED',attested:false}};
  }
 }
}
