/**
 * Live Workers AI model for Buffalo agent turns AND original engine tools.
 *
 * Keep one effective model across both routes. The historical IGC adapter's
 * OR_SLUG ("cloudflare/glm-5.3-flash") is ONLY a virtual local SDK routing
 * alias and MUST NOT be sent to Cloudflare as the effective model.
 *
 * Cloudflare introduced Inkling 2 Small on 2026-11-12.
 * https://developers.cloudflare.com/workers-ai/models/inkling-2-small/
 */
export const BUFFALO_CF_MODEL = '@cf/thinkingmachines/inkling-2-small';
export const BUFFALO_CF_MODEL_NAME = 'Inkling 2 Small';
