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
export const INVALID_RESPONSE_CODE = 'BUFFALO_CF_PROVIDER_INVALID_RESPONSE';

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

/**
 * Validate non-stream Chat Completions BEFORE the original Buffalo manual loop
 * is allowed to see them. Only a structurally complete turn may be forwarded.
 *
 * This is a narrow safety gate, NOT a general JSON Schema validator.
 * Original handlers still own full semantic validation of nested arguments.
 * No tool result, prompt, or argument payload is saved in provider receipts.
 */
export function validateAgentCompletion(payload, wireRequest) {
  const basic = inspectChatCompletion(payload);
  const failure = reason => ({...basic, invalidReason: reason});
  if (basic.truncated) return {...basic, invalidReason: null};
  const choice = payload?.choices?.[0];
  const msg = choice?.message;
  if (!msg || msg.role !== 'assistant') return failure('MISSING_ASSISTANT_MESSAGE');
  if (!['stop', 'tool_calls'].includes(basic.finishReason))
    return failure('UNSUPPORTED_FINISH_REASON');

  const calls = msg.tool_calls;
  // Chat Completions may legitimately encode absent tool calls as null.
  if (calls != null && !Array.isArray(calls))
    return failure('TOOL_CALLS_NOT_ARRAY');
  const actualCalls = calls ?? [];
  if (basic.finishReason === 'tool_calls' && actualCalls.length === 0)
    return failure('EMPTY_TOOL_CALLS');
  if (basic.finishReason === 'stop' && actualCalls.length !== 0)
    return failure('STOP_WITH_TOOL_CALLS');

  if (actualCalls.length === 0) {
    if (typeof msg.content !== 'string' || !msg.content.trim())
      return failure('EMPTY_ASSISTANT_STOP');
    return {...basic, invalidReason:null};
  }

  const declaredTools = new Map((wireRequest?.tools ?? [])
    .filter(tool => tool?.type === 'function' &&
      typeof tool.function?.name === 'string')
    .map(tool => [tool.function.name, tool.function.parameters ?? {}]));
  const seenIds = new Set();
  for (const call of actualCalls) {
    if (!call || call.type !== 'function' ||
      typeof call.id !== 'string' || !call.id.trim() ||
      typeof call.function?.name !== 'string' || !call.function.name.trim())
      return failure('MALFORMED_TOOL_CALL');
    if (seenIds.has(call.id)) return failure('DUPLICATE_TOOL_CALL_ID');
    seenIds.add(call.id);
    if (!declaredTools.has(call.function.name))
      return failure('UNDECLARED_TOOL_NAME');
    if (typeof call.function.arguments !== 'string')
      return failure('ARGUMENTS_NOT_JSON_STRING');
    let args;
    try { args = JSON.parse(call.function.arguments); }
    catch { return failure('ARGUMENTS_INVALID_JSON'); }
    if (!args || typeof args !== 'object' || Array.isArray(args))
      return failure('ARGUMENTS_NOT_OBJECT');
    const schema = declaredTools.get(call.function.name);
    // Validate required TOP-LEVEL names before the original agent can silently
    // substitute {}. Nested JSON-Schema constraints remain handler-owned.
    if (Array.isArray(schema?.required) &&
      schema.required.some(key => !Object.hasOwn(args,key)))
      return failure('ARGUMENTS_MISSING_REQUIRED_FIELD');
  }
  return {...basic, invalidReason:null};
}

export function invalidClientResponse(reason) {
  return new Response(JSON.stringify({
    error: {
      message: INVALID_RESPONSE_CODE + ': invalid provider assistant turn (' + reason + ')',
      type: 'invalid_response_error',
      code: INVALID_RESPONSE_CODE
    }
  }), {status:422,headers:{'content-type':'application/json'}});
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
export function interruptedTransport(diagnostics, receipts = []) {
  if ((diagnostics?.invalidResponses ?? 0) > 0)
    return {status:'provider_invalid_response',
      stopReason:'CLOUDFLARE_PROVIDER_INVALID_RESPONSE'};
  if ((diagnostics?.truncatedResponses ?? 0) > 0)
    return {status:'output_truncated',stopReason:'CLOUDFLARE_OUTPUT_TRUNCATED'};
  // The last Gemma attempt returned a real 499 from Cloudflare, but the runner
  // previously relabeled it only as USAGE_UNAVAILABLE. HTTP failure is the
  // primary incident; missing metering is an additional cost uncertainty.
  const failedHttp = receipts.find(r =>
    Number.isInteger(r?.http_status) && r.http_status >= 400
  );
  if (failedHttp)
    return {status:'provider_http_error',
      stopReason:'CLOUDFLARE_PROVIDER_HTTP_'+failedHttp.http_status};
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
