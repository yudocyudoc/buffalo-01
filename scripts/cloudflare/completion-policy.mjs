/**
 * Transport-only policy for Workers AI: preserve original Buffalo agents,
 * prompts, original engines and IGC protocol adapters.
 *
 * Gemma 4 uses chat_template_kwargs.enable_thinking (default true).
 * Source: Cloudflare's published Gemma 4 Workers AI model schema.
 * https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/workers-ai-models/gemma-4-26b-a4b-it.json
 *
 * A finish_reason of "length" is a truncated response, not task completion.
 */
export const GEMMA_MODEL = '@cf/google/gemma-4-26b-a4b-it';
export const TRUNCATED_RESPONSE_CODE = 'BUFFALO_CF_OUTPUT_TRUNCATED';

export function configureModelWire(modelId, request) {
  if (!request || typeof request !== 'object' || Array.isArray(request))
    throw Error('BUFFALO_CF_INVALID_MODEL_WIRE');
  if (modelId !== GEMMA_MODEL) return { ...request };

  // The historical IGC adapter can add reasoning_effort:low. Gemma's documented
  // boolean switch is unambiguous. Do not send conflicting effort instructions.
  const {reasoning_effort: _unused, ...wire} = request;
  return {
    ...wire,
    chat_template_kwargs: {
      ...(wire.chat_template_kwargs ?? {}),
      enable_thinking: false
    }
  };
}

export function inspectChatCompletion(payload) {
  const choice = payload?.choices?.[0];
  return {
    finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
    toolCallsCount: Array.isArray(choice?.message?.tool_calls)
      ? choice.message.tool_calls.length : 0,
    truncated: choice?.finish_reason === 'length'
  };
}

/** A provider-200 truncated output is translated to a local client error.
 * No partial assistant content or incomplete tool calls are ever forwarded
 * to Buffalo's original manual loop.
 */
export function truncatedClientResponse() {
  return new Response(JSON.stringify({
    error: {
      message: TRUNCATED_RESPONSE_CODE +
        ': Cloudflare finish_reason=length; incomplete assistant turn was NOT accepted',
      type: 'invalid_response_error',
      code: TRUNCATED_RESPONSE_CODE
    }
  }), {status:422,headers:{'content-type':'application/json'}});
}

/**
 * Runner-only gate: do not call the ORIGINAL graders if transport has evidence
 * of any interruption. A policy must actually complete before it can be graded.
 */
export function interruptedTransport(diagnostics) {
  if ((diagnostics?.truncatedResponses ?? 0) > 0)
    return {status:'output_truncated',stopReason:'CLOUDFLARE_OUTPUT_TRUNCATED'};
  if ((diagnostics?.budgetBlockedAttempts ?? 0) > 0)
    return {status:'budget_exhausted',stopReason:'CLOUDFLARE_POST_BUDGET_EXHAUSTED'};
  if ((diagnostics?.neuronPreflightBlockedAttempts ?? 0) > 0)
    return {status:'neuron_preflight_blocked',stopReason:'CLOUDFLARE_ESTIMATED_NEURON_PREFLIGHT_LIMIT'};
  if (diagnostics?.neuronBudget?.unmetered)
    return {status:'unmetered_fail_closed',stopReason:'CLOUDFLARE_USAGE_UNAVAILABLE_FAIL_CLOSED'};
  if ((diagnostics?.duplicateBlockedAttempts ?? 0) > 0)
    return {status:'duplicate_post_blocked',stopReason:'CLOUDFLARE_DUPLICATE_POST_BLOCKED'};
  return null;
}
