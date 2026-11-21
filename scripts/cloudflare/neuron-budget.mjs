/**
 * Local, PER-EXECUTION Workers AI neuron accounting and pre-request admission.
 *
 * This is NOT a hard Cloudflare billing cap. The true model tokenizer, hidden
 * reasoning, cached usage, other applications, failed network calls, and the
 * response's final billed neurons can differ from the estimate. Always retain
 * the independent hard POST count and manual paid opt-in.
 *
 * Used for BOTH the original OpenAI-compatible agent loop and engine SDK lane.
 */
import { encode } from 'gpt-tokenizer';
import { BUFFALO_CF_MODEL_CATALOG } from './active-model.mjs';

// Cloudflare Workers AI: $0.011 / 1,000 neurons.
export const NEURONS_PER_USD = 1000 / 0.011;
export const AGENT_MAX_COMPLETION_TOKENS = 4096;
export const DEFAULT_MAX_NEURONS = 4000;

function finiteNonnegative(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}
function nonnegativeNumber(n) {
  const val = Number(n);
  return Number.isFinite(val) && val >= 0 ? val : null;
}
export function neuronPriceForUsage(modelId, promptTokens, completionTokens, cachedTokens = 0) {
  const price = BUFFALO_CF_MODEL_CATALOG[modelId];
  if (!price) throw Error('BUFFALO_CF_NEURON_PRICE_UNKNOWN_MODEL');
  for (const [name, n] of Object.entries({ promptTokens, completionTokens, cachedTokens })) {
    if (!finiteNonnegative(n)) throw Error('BUFFALO_CF_BAD_TOKEN_COUNT_' + name);
  }
  if (cachedTokens > promptTokens) throw Error('BUFFALO_CF_CACHED_EXCEEDS_PROMPT');
  const effectiveCachedPrice = price.cachedInputUsdPerMillion ?? price.inputUsdPerMillion;
  const usd = ((promptTokens - cachedTokens) * price.inputUsdPerMillion
    + cachedTokens * effectiveCachedPrice
    + completionTokens * price.outputUsdPerMillion) / 1_000_000;
  return usd * NEURONS_PER_USD;
}

export function meteredNeurons(modelId, usage) {
  const reported = nonnegativeNumber(usage?.neurons);
  if (reported !== null) return { neurons: reported, basis: 'provider-reported-neurons' };

  const prompt = nonnegativeNumber(usage?.prompt_tokens ?? usage?.input_tokens);
  const completion = nonnegativeNumber(usage?.completion_tokens ?? usage?.output_tokens);
  if (prompt === null || completion === null) return null;

  const cached = Math.min(prompt, nonnegativeNumber(
    usage?.prompt_tokens_details?.cached_tokens ?? usage?.cached_tokens
  ) ?? 0);
  return {
    neurons: neuronPriceForUsage(modelId, prompt, completion, cached),
    basis: 'estimated-from-provider-tokens-and-published-model-prices'
  };
}

/**
 * gpt-tokenizer approximates the provider tokenizer; a 1.4 multiplier and 512
 * overhead tokens are conservative engineering margins, NOT a proof of an
 * upper bound. Include serialized function schemas, not only chat messages.
 * max_completion_tokens is enforced by bootstrap in both request lanes.
 */
export function quoteNeurons(modelId, wireRequest) {
  if (!wireRequest || typeof wireRequest !== 'object') throw Error('BUFFALO_CF_INVALID_WIRE');
  const outputCap = wireRequest.max_completion_tokens;
  if (!Number.isInteger(outputCap) || outputCap < 1 || outputCap > 16000)
    throw Error('BUFFALO_CF_OUTPUT_CAP_MISSING');
  const serialized = JSON.stringify(wireRequest);
  const approximate = encode(serialized).length;
  const reservedPromptTokens = Math.ceil(approximate * 1.4) + 512;
  const estimatedNeurons = neuronPriceForUsage(modelId, reservedPromptTokens, outputCap);
  // Further round up 10% to reduce, not eliminate, underestimate risk.
  const reservedNeurons = Math.ceil(estimatedNeurons * 1.1);
  return {
    reservedNeurons,
    promptTokenProxy: approximate,
    paddedPromptTokens: reservedPromptTokens,
    maxOutputTokens: outputCap,
    method: 'gpt-tokenizer-1.4x-plus-512;1.1x-reserve;no-cache-assumed'
  };
}

/**
 * A single process-local budget for all POSTs (agent and engine). Reservation
 * is synchronous so parallel engine tool calls cannot overbook the same quota.
 * Unknown network outcomes consume the reservation and STOP further calls.
 */
export function createNeuronBudget(modelId, maxNeurons = DEFAULT_MAX_NEURONS) {
  if (!Number.isInteger(maxNeurons) || maxNeurons < 200 || maxNeurons > 10000)
    throw Error('BUFFALO_CF_INVALID_MAX_NEURONS: choose integer between 200 and 10000');
  if (!BUFFALO_CF_MODEL_CATALOG[modelId]) throw Error('BUFFALO_CF_UNKNOWN_NEURON_MODEL');

  let usedNeurons = 0;
  let pendingNeurons = 0;
  let unmetered = false;
  let blockedPreflight = 0;
  let unknownMeteringEvents = 0;
  const reservations = new Map();
  let nextReservation = 1;

  function reserve(wireRequest) {
    if (unmetered) throw Error('BUFFALO_CF_NEURON_METERING_UNKNOWN_STOP');
    const quote = quoteNeurons(modelId, wireRequest);
    if (usedNeurons + pendingNeurons + quote.reservedNeurons > maxNeurons) {
      blockedPreflight++;
      throw Error('BUFFALO_CF_NEURON_PREFLIGHT_BUDGET_BLOCKED');
    }
    const id = nextReservation++;
    reservations.set(id, quote.reservedNeurons);
    pendingNeurons += quote.reservedNeurons;
    return { id, ...quote };
  }
  function finish(reservation, usage) {
    const hold = reservations.get(reservation?.id);
    if (hold === undefined) throw Error('BUFFALO_CF_NEURON_RESERVATION_UNKNOWN');
    reservations.delete(reservation.id);
    pendingNeurons -= hold;
    const measured = meteredNeurons(modelId, usage);
    if (measured) {
      usedNeurons += measured.neurons;
      return { ...measured, reservedNeurons: hold };
    }
    // Network failures may still be billed; retain conservative reservation
    // and fail closed instead of silently treating them as zero consumption.
    usedNeurons += hold;
    unmetered = true;
    unknownMeteringEvents++;
    return {
      neurons: hold, basis: 'unknown-charged-reservation-held-fail-closed',
      reservedNeurons: hold
    };
  }
  function diagnostics() {
    return {
      model: modelId, maxNeurons,
      usedOrHeldNeurons: usedNeurons,
      pendingReservedNeurons: pendingNeurons,
      remainingUnreservedNeurons: Math.max(0, maxNeurons - usedNeurons - pendingNeurons),
      blockedPreflight, unknownMeteringEvents, unmetered,
      note: 'Local per-run estimated admission, not a guaranteed or account-wide Cloudflare billing cap'
    };
  }
  return { reserve, finish, diagnostics };
}
