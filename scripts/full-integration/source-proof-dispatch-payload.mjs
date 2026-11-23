/**
 * GitHub workflow_dispatch payload for Buffalo Full source-proof V1.
 * No network call, no GitHub token, no handoff D1 writes, no inference.
 */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeHandoffId} from './handoff-contract.mjs';

export function makeSourceProofDispatch({handoffId,manifestSha}){
  const id=normalizeHandoffId(handoffId);
  if(typeof manifestSha!=='string'||!/^[a-f0-9]{64}$/.test(manifestSha))
    throw Error('STAGE3B6_MANIFEST_SHA_INVALID');
  return Object.freeze({ref:'main',inputs:Object.freeze({
    handoff_id:id,agent:'merlin',case_index:'0',manifest_sha256:manifestSha
  })});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const payload=makeSourceProofDispatch({
      handoffId:process.env.BUFFALO_HANDOFF_ID,
      manifestSha:process.env.MANIFEST_SHA
    });
    process.stdout.write(JSON.stringify(payload));
  }catch{
    console.error('STAGE3B6_SOURCE_PROOF_DISPATCH_PAYLOAD_INVALID');
    process.exitCode=1;
  }
}
