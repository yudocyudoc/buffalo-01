// Actual native binding response from run 45496578147, artifact 14970300619.
export const GEMMA='@cf/google/gemma-4-26b-a4b-it';
export const GEMMA_OBSERVED_ALIAS='@cf/google/gemma-4-26b-a4b-it-external';
export const acceptedGemmaModel=m=>m===GEMMA||m===GEMMA_OBSERVED_ALIAS;
export function responsePredicates(result,maxOutput,allowAlias){
 const u=result?.usage,c=result?.choices?.[0],m=c?.message;
 return {
  usage_present:!!u,
  prompt_tokens_valid:Number.isSafeInteger(u?.prompt_tokens)&&u.prompt_tokens>0,
  completion_tokens_valid:Number.isSafeInteger(u?.completion_tokens)&&u.completion_tokens>0&&u.completion_tokens<=maxOutput,
  model_accepted:allowAlias?acceptedGemmaModel(result?.model):result?.model===GEMMA,
  one_choice:Array.isArray(result?.choices)&&result.choices.length===1,
  stop:c?.finish_reason==='stop',
  assistant_role:m?.role==='assistant',
  no_tool_calls:m?.tool_calls==null||(Array.isArray(m.tool_calls)&&m.tool_calls.length===0),
  no_function_call:m?.function_call==null,
  content_string:typeof m?.content==='string',
  content_nonempty:typeof m?.content==='string'&&!!m.content.trim(),
  content_bounded:typeof m?.content==='string'&&m.content.length<=16000
 };
}
export const passedPredicates=p=>!!p&&Object.keys(p).length===12&&Object.values(p).every(v=>v===true);
