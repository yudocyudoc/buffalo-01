// Sample-wise check for a single whole-model denominator. Loop signs are supplied
// by the analysis producer. This function does not interpret generated prose.
const wholeModel = 'Percent of Model Behavior Explained by Loop';
const withinSet = 'Percent of this Feedback Loop Set Behavior Explained by Loop';
const tolerance = 1e-8; // percentage points; exact half is ambiguous in the original prompt
const unverified = reason => ({status: 'unverified', reason});

// Caller has already checked identifiers, period ordering, score ranges and alignment.
export function assessDominance(content, time) {
  const loops = content.feedbackLoops;
  if (loops.some(loop => Object.hasOwn(loop, withinSet) || Object.hasOwn(loop,'partition'))) return unverified('loop_set_denominator');
  if (loops.some(loop => !Object.hasOwn(loop, wholeModel))) return unverified('missing_whole_model_scores');
  if (loops.some(loop => !['+', '-'].includes(loop.polarity))) return unverified('unknown_loop_polarity');
  const periods = content.dominantLoopsByPeriod;
  const indices = new Map(loops.map((loop, i) => [loop.identifier, i]));
  const facts = periods.map(p => ({firstSample: null, lastSample: null,
    loops: p.dominantLoops.map(id => ({identifier: id, polarity: loops[indices.get(id)].polarity}))}));
  let period = 0, unresolved, checkedSamples = 0;
  for (const [i, t] of time.entries()) {
    const weights = loops.map(loop => loop[wholeModel][i].value);
    const total = weights.reduce((sum, value) => sum + value, 0);
    if (i === 0 && total === 0) continue; // LTM initialization has no measured dominance.
    if (Math.abs(total - 100) > tolerance) {
      unresolved ??= 'scores_not_normalized';
      continue;
    }
    // Internal shared boundaries belong to the period starting there.
    while (period + 1 < periods.length && periods[period + 1].startTime <= t) period++;
    const p = periods[period];
    if (t < p.startTime || t > p.endTime) {
      unresolved ??= 'uncovered_sample';
      continue;
    }
    const selected = p.dominantLoops.map(id => indices.get(id));
    const sign = loops[selected[0]].polarity;
    const share = selected.reduce((sum, index) => sum + weights[index], 0);
    const failed = reason => ({status: 'contradicted', reason, time: t, reportedLoops: p.dominantLoops, share});
    if (selected.some(index => loops[index].polarity !== sign)) return failed('mixed_polarities');
    if (share < 50 - tolerance) return failed('below_majority');
    // A smaller group of the same sign must not already have a majority.
    const smaller = selected.length === 1 ? 0 : weights.filter((_, index) => loops[index].polarity === sign)
      .sort((a, b) => b - a).slice(0, selected.length - 1).reduce((sum, value) => sum + value, 0);
    if (smaller > 50 + tolerance) return failed('smaller_majority');
    if (share <= 50 + tolerance || smaller >= 50 - tolerance) {
      unresolved ??= 'half_threshold';
      continue;
    }
    facts[period].firstSample ??= t;
    facts[period].lastSample = t;
    checkedSamples++;
  }
  if (unresolved) return unverified(unresolved);
  if (facts.some(fact => fact.firstSample === null)) return unverified('period_without_active_samples');
  return {status: 'supported_by_whole_model_scores', checkedSamples, periods: facts};
}
