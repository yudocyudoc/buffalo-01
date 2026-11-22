/**
 * GitHub Actions-only source proof producer. No agent run or simulation.
 * Reconstructs an original DEV case from the exact checked-out commit.
 * Assert that the caller-supplied handoff digest matches fresh repository bytes.
 */
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {inspectOriginalSources} from './original-gate.mjs';
import {buildHandoff} from './prepare-handoff.mjs';
import {sourceProofFor} from './source-proof-contract.mjs';
import {normalizeHandoffId,HANDOFF_AGENTS} from './handoff-contract.mjs';

const die=reason=>{throw Error('FULL_SOURCE_PROOF_'+reason)};
const sha256=value=>createHash('sha256').update(value).digest('hex');
export async function produceSourceProof({handoff_id,agent,case_index,commit_sha,
 expected_manifest_sha256,groups,sourceManifest}){
 if(!HANDOFF_AGENTS.includes(agent))die('AGENT_NOT_ALLOWED');
 if(!Number.isSafeInteger(case_index)||case_index<0||case_index>999)die('CASE_INVALID');
 if(!/^[a-f0-9]{40}$/.test(commit_sha))die('COMMIT_INVALID');
 if(!/^[a-f0-9]{64}$/.test(expected_manifest_sha256))die('DIGEST_INVALID');
 const prepared=await buildHandoff({handoff_id:normalizeHandoffId(handoff_id),
  agent,case_index,commit_sha,groups,sourceManifest});
 if(prepared.manifest_sha256!==expected_manifest_sha256)die('MANIFEST_MISMATCH');
 return sourceProofFor(prepared.manifest,prepared.manifest_sha256);
}
export async function main(env=process.env){
 const handoff_id=env.BUFFALO_HANDOFF_ID,agent=env.BUFFALO_HANDOFF_AGENT,
  index=env.BUFFALO_HANDOFF_CASE_INDEX,commit_sha=env.GITHUB_SHA?.toLowerCase(),
  digest=env.BUFFALO_HANDOFF_MANIFEST_SHA256?.toLowerCase(),
  destination=env.BUFFALO_SOURCE_PROOF_PATH;
 if(typeof index!=='string'||!/^(0|[1-9][0-9]{0,2})$/.test(index))
  die('INDEX_INVALID');
 if(typeof destination!=='string'||destination.length===0)die('PATH_REQUIRED');
 const sourceManifest=inspectOriginalSources();
 // Metadata-only load; we never call evaluate(), runAgent(), simulateModel() or providers.
 const {groups}=await import('../../evals/categories/policyImplementation.js');
 const proof=await produceSourceProof({handoff_id,agent,case_index:Number(index),
  commit_sha,expected_manifest_sha256:digest,groups,sourceManifest});
 const bytes=JSON.stringify(proof,null,2)+'\n';
 await writeFile(destination,bytes,{flag:'wx'});
 console.log(JSON.stringify({schema:proof.schema,handoff_id,commit:commit_sha,
  proof_sha256:sha256(bytes),metadata_only:true,model_calls:0}));
}
if(process.argv[1]){
 const {resolve}=await import('node:path'),{fileURLToPath}=await import('node:url');
 if(resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{await main()}catch(error){console.error(String(error?.message??'FULL_SOURCE_PROOF_FAILED'));process.exitCode=1;}
 }
}
