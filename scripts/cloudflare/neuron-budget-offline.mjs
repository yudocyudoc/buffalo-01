/**
 * Pure zero-network tests for two-model neuron admission and accounting.
 * Does not use credentials, launch an agent or call Workers AI.
 */
import assert from 'node:assert/strict';
import { BUFFALO_CF_MODEL, BUFFALO_CF_MODEL_CATALOG } from './active-model.mjs';
import {
  NEURONS_PER_USD, neuronPriceForUsage, meteredNeurons, quoteNeurons,
  createNeuronBudget
} from './neuron-budget.mjs';

const inkling = '@cf/thinkingmachines/inkling-2-small';
const gemma = '@cf/google/gemma-4-26b-a4b-it';
assert.deepEqual(Object.keys(BUFFALO_CF_MODEL_CATALOG), [inkling, gemma]);
assert.ok([inkling, gemma].includes(BUFFALO_CF_MODEL));

const normalized = 1_000_000;
assert.ok(Math.abs(neuronPriceForUsage(gemma, normalized, 0) - 0.10 * NEURONS_PER_USD) < 1e-8);
assert.ok(Math.abs(neuronPriceForUsage(gemma, 0, normalized) - 0.30 * NEURONS_PER_USD) < 1e-8);
assert.ok(Math.abs(neuronPriceForUsage(inkling, normalized, 0) - 0.30 * NEURONS_PER_USD) < 1e-8);
assert.ok(Math.abs(neuronPriceForUsage(inkling, normalized, 0, normalized) - 0.10 * NEURONS_PER_USD) < 1e-8);
assert.ok(neuronPriceForUsage(gemma, 209302, 1692) < neuronPriceForUsage(inkling, 209302, 1692, 125696));
assert.equal(meteredNeurons(gemma, {neurons: 77, prompt_tokens: 100, completion_tokens: 20}).neurons,77);
assert.equal(
  meteredNeurons(gemma, {prompt_tokens: 1000, completion_tokens: 200}).basis,
  'estimated-from-provider-tokens-and-published-model-prices'
);
assert.equal(meteredNeurons(gemma, {}) , null);
console.log('PASS: Cloudflare per-model pricing, cached Inkling inputs and direct neuron usage');

for (const model of [inkling, gemma]) {
  const budget = createNeuronBudget(model, 200);
  const small = {model, messages:[{role:'user',content:'Check one model section'}],
    max_completion_tokens:128};
  const quote = quoteNeurons(model, small);
  assert.ok(quote.reservedNeurons > 0 && quote.reservedNeurons < 200);
  const held = budget.reserve(small);
  assert.equal(held.reservedNeurons, quote.reservedNeurons);
  const meter = budget.finish(held, {neurons:35, prompt_tokens:600, completion_tokens:25});
  assert.equal(meter.neurons, 35);
  assert.equal(budget.diagnostics().usedOrHeldNeurons,35);
  assert.equal(budget.diagnostics().pendingReservedNeurons,0);
  // 16K output upper cap is too expensive to admit inside this small budget
  const huge = {...small, max_completion_tokens:16000};
  assert.throws(() => budget.reserve(huge), /BUFFALO_CF_NEURON_PREFLIGHT_BUDGET_BLOCKED/);
  assert.equal(budget.diagnostics().blockedPreflight,1);
  assert.equal(budget.diagnostics().remainingUnreservedNeurons,165);

  const failClosed = createNeuronBudget(model, 200);
  const pending = failClosed.reserve(small);
  const unknown = failClosed.finish(pending, null);
  assert.equal(unknown.basis, 'unknown-charged-reservation-held-fail-closed');
  assert.equal(failClosed.diagnostics().unmetered,true);
  assert.throws(() => failClosed.reserve(small),
    /BUFFALO_CF_NEURON_METERING_UNKNOWN_STOP/);
  console.log('PASS: preflight quota, accounting and fail-closed on missing usage for '+model);
}

assert.throws(() => createNeuronBudget(gemma,0),/BUFFALO_CF_INVALID_MAX_NEURONS/);
assert.throws(() => createNeuronBudget(gemma,10001),/BUFFALO_CF_INVALID_MAX_NEURONS/);
console.log('PASS: local neuron budget checks complete; NO API calls or billable tokens');
