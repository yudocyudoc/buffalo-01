// Sample-wise checks on the original saved grid. Loop signs are supplied
// by the analysis producer. This function does not interpret generated prose.
const wholeModel = 'Percent of Model Behavior Explained by Loop';
const withinSet = 'Percent of this Feedback Loop Set Behavior Explained by Loop';
const tolerance = 1e-8; // percentage points; exact half is ambiguous in the original prompt
const unverified = reason => ({status: 'unverified', reason});

// pysimlin 0.8.5 Run._dominant_periods_for_group accumulates the largest
// magnitudes in each polarity until 0.5, then compares the two prefix sums.
// A stable sort retains Run.loops order for equal magnitudes.
export function nativeSelection(loops, index) {
  const ranked = loops.map(loop => ({id:loop.identifier, polarity:loop.polarity, score:loop.signed?.[index]}));
  if (ranked.some(l => !Number.isFinite(l.score))) return null;
  ranked.sort((a,b) => Math.abs(b.score)-Math.abs(a.score));
  const mass = ranked.reduce((total,l) => total+Math.abs(l.score),0);
  if (mass === 0) return [];
  if (Math.abs(mass-1) > tolerance/100) return null;
  const positive = {sum:0,ids:[]}, negative = {sum:0,ids:[]};
  for (const {id,polarity,score} of ranked) {
    const reinforcing = polarity==='R' || polarity==='Rux' || (polarity==='U' && score>0);
    if (polarity==='U' && score===0) continue;
    const group = reinforcing ? positive : negative;
    if (group.sum < 0.5) {
      group.sum += Math.abs(score);
      group.ids.push(id);
    }
  }
  return positive.sum >= negative.sum ? positive.ids : negative.ids;
}

function partitionDominance(content,time,evidence) {
  if (evidence.mode!=='exhaustive') return unverified('incomplete_native_loop_inventory');
  if (!Array.isArray(evidence.time) || evidence.time.length!==time.length ||
      !time.every((t,i)=>t===evidence.time[i])) return unverified('native_time_grid_mismatch');
  const groups = new Map(), byId = new Map();
  for (const {id,partition,polarity,signed} of evidence.loops) {
    const identifier = 'P'+partition+'/'+id.toUpperCase();
    // On Run.loops each module-internal loop (partition None) competes alone.
    const key = partition ?? identifier;
    if (byId.has(identifier) || !['R','B','Rux','Bux','U'].includes(polarity) ||
        (signed!=null && signed.length!==time.length)) return unverified('invalid_native_loop_evidence');
    byId.set(identifier,key);
    if (!groups.has(key)) groups.set(key,{partition,loops:[],periods:[]});
    groups.get(key).loops.push({identifier,polarity,signed});
  }
  if (byId.size!==content.feedbackLoops.length || content.feedbackLoops.some(l=>
      !byId.has(l.identifier) || groups.get(byId.get(l.identifier)).partition!==l.partition))
    return unverified('native_loop_inventory_mismatch');
  for (const p of content.dominantLoopsByPeriod) {
    const key = byId.get(p.dominantLoops[0]);
    const group = groups.get(key);
    if (!group || group.partition!==p.partition || p.dominantLoops.some(id=>byId.get(id)!==key))
      return {status:'contradicted', reason:'reported_partition_mismatch', time:p.startTime, partition:p.partition};
    group.periods.push(p);
  }
  let checkedSamples=0, inactiveSamples=0, incompleteSamples=0;
  for (const {partition,loops,periods} of groups.values()) {
    let cursor=0;
    for (const [i,t] of time.entries()) {
      while (cursor<periods.length && periods[cursor].endTime<t) cursor++;
      const current=periods[cursor];
      const covers=current && current.startTime<=t;
      // Native period endpoints are inclusive saved samples, including at gaps.
      if (covers && periods[cursor+1]?.startTime<=t)
        return {status:'contradicted',reason:'overlapping_native_periods',partition,time:t};
      const reported=covers ? current.dominantLoops : [];
      const expected=nativeSelection(loops,i);
      if (!expected) { incompleteSamples++; continue; }
      if (expected.length!==reported.length || expected.some(id=>!reported.includes(id)))
        return {status:'contradicted',reason:'native_dominant_set_mismatch',partition,time:t,
          expectedLoops:expected,reportedLoops:reported};
      if (expected.length) checkedSamples++;
      else inactiveSamples++;
    }
  }
  const counts={partitionCount:groups.size,checkedSamples,inactiveSamples,incompleteSamples};
  return incompleteSamples || !checkedSamples
    ? {...unverified(incompleteSamples?'incomplete_native_scores':'no_active_native_samples'),...counts}
    : {status:'supported_by_partition_scores',...counts};
}

// Caller has already validated the shape and order of reported periods.
export function assessDominance(content, time, nativeEvidence) {
  if (nativeEvidence) return partitionDominance(content,time,nativeEvidence);
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
