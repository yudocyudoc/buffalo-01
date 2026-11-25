// Use only the pinned reference pair. No arbitrary mixing of feedback and models,
// no persisted run identity, no synthesized behavior, no grading or retry.
import {loadBassReference} from './bass-feedback-reference.mjs';
const engines=new Set(['seldon','seldon-mentor','seldon-ile-user']);
export function bassDiscussionRequest(engine){
 if(!engines.has(engine))throw Error('UNSUPPORTED_BASS_DISCUSSION_ENGINE');
 const ref=loadBassReference();
 return {body:{prompt:ref.prompt,currentModel:ref.model,feedbackContent:ref.feedback,
  backgroundKnowledge:'Evidence provenance: upstream precomputed reference, not a Buffalo LTM calculation. No simulation trajectory or source run identifier was supplied. Do not infer absolute amounts of change from relative loop percentages. '+JSON.stringify(ref.provenance)},
  provenance:ref.provenance};
}
export async function discussBassReference(request,engine,key){
 const {body,provenance}=bassDiscussionRequest(engine);
 const response=await request('/api/v1/engines/'+engine+'/generate',{method:'POST',
  headers:{Authentication:key,'content-type':'application/json'},body:JSON.stringify(body)});
 if(response.status!==200)throw Error('BASS_DISCUSSION_HTTP_FAILURE');
 const result=await response.json();
 if(result.success!==true||typeof result.output?.textContent!=='string'||typeof result.output.feedbackInformationRequired!=='boolean')
  throw Error('BASS_DISCUSSION_ENGINE_FAILURE');
 return {output:result.output,provenance};
}
