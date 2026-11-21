/**
 * Effective Workers AI target for the original Buffalo agent AND engine tools.
 *
 * The IGC adapter's historical 'cloudflare/glm-5.3-flash' is a virtual
 * OpenRouter SDK routing alias, not a Cloudflare inference target. Do not
 * change or send it to Workers AI.
 *
 * Published unit rates in USD per million tokens, 2026-11-20:
 * https://developers.cloudflare.com/workers-ai/models/inkling-2-small/
 * https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/
 * These are for estimating a PER-RUN neuron budget, not a billing statement.
 */
export const BUFFALO_CF_MODEL_CATALOG = Object.freeze({
  '@cf/thinkingmachines/inkling-2-small': Object.freeze({
    displayName: 'Inkling 2 Small',
    inputUsdPerMillion: 0.30,
    outputUsdPerMillion: 1.00,
    cachedInputUsdPerMillion: 0.10,
  }),
  '@cf/google/gemma-4-26b-a4b-it': Object.freeze({
    displayName: 'Gemma 4 26B A4B',
    inputUsdPerMillion: 0.10,
    outputUsdPerMillion: 0.30,
    // Gemma's published model page has no separate cached-input rate.
    cachedInputUsdPerMillion: null,
  }),
});
const defaultModel = '@cf/thinkingmachines/inkling-2-small';
const requestedModel = process.env.BUFFALO_CF_MODEL_ID || defaultModel;
if (!Object.hasOwn(BUFFALO_CF_MODEL_CATALOG, requestedModel))
  throw Error('BUFFALO_CF_UNSUPPORTED_MODEL: select a model from active-model.mjs');

export const BUFFALO_CF_MODEL = requestedModel;
export const BUFFALO_CF_MODEL_NAME = BUFFALO_CF_MODEL_CATALOG[requestedModel].displayName;
