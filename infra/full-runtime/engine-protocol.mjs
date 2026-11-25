// Virtual alias only: the original LLMWrapper chooses its OpenRouter SDK
// branch by the namespaced model ID. The only actual binding target is Gemma.
export const ENGINE_ALIAS='buffalo/gemma-4-26b-a4b-it';
export const ENGINE_ENDPOINT='http://merlin-provider.internal/v1/engine/completions';
export const ENGINE_MAX_TOKENS=8192;

// Unique per logical SDK transport invocation, independent of prompt content.
export const validInvocationId=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
