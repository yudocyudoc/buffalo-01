/**
 * PRE-FLIGHT, no LLM or paid API. Uses ONE existing Buffalo development
 * policy scenario and its unmodified native PySD grader.
 *
 * This checks benchmark wiring. It does not show that an agent solves the case.
 */
import assert from 'node:assert/strict';
import { groups, goalOn, evaluate } from '../evals/categories/policyImplementation.js';
import { scenarios } from '../evals/utilities/scenarios/library.js';

const tests = groups.policyImplementation || [];
const ids = [...new Set(tests.map(t => t.expectations.scenario))];
assert.ok(ids.length > 0, 'No original development policy cases available');

const i = Number(process.env.BUFFALO_CASE_INDEX ?? '0');
assert.ok(Number.isInteger(i) && i >= 0 && i < ids.length, 'Invalid development case index');
const id = ids[i];
const siblings = tests.filter(t => t.expectations.scenario === id);
assert.deepEqual(
  new Set(siblings.map(t => t.expectations.criterion)),
  new Set(['meetsGoal', 'intact', 'sensible']),
  'Original case must present exactly the three benchmark criteria'
);

const first = siblings[0];
assert.ok(first.currentModel && first.prompt, 'Original case must supply model and prompt');
const scenario = scenarios[id];
assert.ok(scenario?.goal && scenario?.protected, 'Original scenario lacks goal/protected');
const initial = structuredClone(first.currentModel);

console.log('Buffalo original policy case:', id);
console.log('Agent would be asked:', first.prompt);
console.log('Protected quantities:', scenario.protected.label);
console.log('Original benchmark criteria:', siblings.map(t => t.expectations.criterion).join(', '));

const baseline = await goalOn(initial, scenario);
assert.ok(baseline.ok, 'Baseline failed to simulate: ' + baseline.error);
assert.equal(baseline.meets, false, 'Benchmark baseline already meets the policy goal');
assert.ok(Number.isFinite(baseline.value), 'Baseline goal value is not finite');
console.log('PASS: original development scenario simulates (goal measure=' + baseline.value + ')');
console.log('PASS: baseline misses original policy goal, as benchmark specifies');

const originalGrading = await evaluate({ model: initial }, { scenario: id, criterion: 'meetsGoal' });
assert.ok(Array.isArray(originalGrading) && originalGrading.length > 0,
  'Unchanged baseline unexpectedly passed policy achievement');
assert.ok(originalGrading.some(f => f.type === 'Goal not met'),
  'Unexpected original grader failure: ' + JSON.stringify(originalGrading));
console.log('PASS: native grader rejects unchanged baseline for goal not met');
console.log('PASS: benchmark preflight complete. NO agent, NO paid API.');
