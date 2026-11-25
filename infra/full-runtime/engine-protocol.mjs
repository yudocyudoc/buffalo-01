// Virtual alias only: the original LLMWrapper chooses its OpenRouter SDK
// branch by the namespaced model ID. The only actual binding target is Gemma.
export const ENGINE_ALIAS='cloudflare/glm-5.3-flash';
export const ENGINE_ENDPOINT='http://merlin-provider.internal/v1/engine/completions';
export const ENGINE_MAX_TOKENS=8192;
