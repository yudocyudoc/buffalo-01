// Capture the observed original tool result, not hidden provider reasoning or
// the pre-transformation LLM wire. No inference, repair or product write here.
import {digest} from './provider-wire.mjs';
import {diagnoseNarrative} from './run-narrative.mjs';

export async function captureNarrativeAttempt({message,selected,narrativeId,prompt,onCapture}){
  const toolText=message?.result?.[0]?.text;
  const rawKind=typeof toolText==='string'?'tool_text':'tool_result_json';
  const raw=rawKind==='tool_text'?toolText:JSON.stringify(message?.result??null);
  const attempt={narrative_id:narrativeId,call_id:message?.callId??null,
    raw_kind:rawKind,raw,raw_sha256:await digest(raw),
    raw_bytes:new TextEncoder().encode(raw).length,status:'CAPTURED'};
  // Required: the experiment's private receipt is checkpointed BEFORE parsing
  // or validation. A checkpoint failure aborts, rather than losing evidence.
  await onCapture(attempt);
  try{
    if(rawKind!=='tool_text'){
      attempt.status='REJECTED';attempt.error='INVALID_NATIVE_NARRATIVE_TOOL_RESULT';
      throw Error(attempt.error);
    }
    let result;
    try{result=JSON.parse(raw);}catch{
      attempt.status='REJECTED';attempt.error='INVALID_NATIVE_NARRATIVE_JSON';
      throw Error(attempt.error);
    }
    attempt.diagnostic=diagnoseNarrative(result,selected.feedback.content);
    const record=await selected.saveNarrative(narrativeId,prompt,result);
    attempt.status='ACCEPTED';
    // The accepted record itself is durably saved. Retain its observed raw
    // hash, but do not duplicate the accepted prose in the terminal receipt.
    delete attempt.raw;
    return record;
  }catch(error){
    attempt.status=attempt.status==='REJECTED'||attempt.diagnostic?.valid===false?'REJECTED':'SAVE_FAILED';
    attempt.error=String(error?.message??error).slice(0,300);
    throw error;
  }
}
