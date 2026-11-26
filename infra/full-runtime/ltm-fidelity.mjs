import {nativeSelection} from './dominance-evidence.mjs';

const finite = Number.isFinite;
const sameMembers = (a, b) => a.length === b.length && a.every(id => b.includes(id));
const unknown = reason => ({status:'unverified', reason});
const result = (matches, observed) => ({status:matches ? 'supported' : 'contradicted', observed});

function extrema(values, time, choose) {
  const value = values.reduce(choose === 'min' ? (a,b) => Math.min(a,b) : (a,b) => Math.max(a,b));
  return {value, times:time.filter((_,i) => values[i] === value)};
}

// Both inputs come from the same immutable simulation. All intervals refer to inclusive saved samples.
export function computeLtmFacts(series, evidence) {
  const time = series.time;
  if (!Array.isArray(time) || !time.length || !time.every((t,i) => finite(t) && (!i || time[i-1] < t)) ||
      !Array.isArray(evidence.time) || evidence.time.length !== time.length ||
      time.some((t,i) => t !== evidence.time[i])) throw Error('Incompatible saved time grid');
  const variables = new Map();
  for (const [name, values] of Object.entries(series)) {
    if (name === 'time') continue;
    if (!Array.isArray(values) || values.length !== time.length || !values.every(finite)) throw Error('Invalid series: ' + name);
    variables.set(name, {values, min:extrema(values,time,'min'), max:extrema(values,time,'max')});
  }

  const groups = new Map(), activity = new Map();
  for (const {id, partition, polarity, signed} of evidence.loops) {
    const identifier = 'P' + partition + '/' + id.toUpperCase();
    if (activity.has(identifier) || !['R','B','Rux','Bux','U'].includes(polarity) ||
        (signed != null && (!Array.isArray(signed) || signed.length !== time.length ||
          !signed.every(x => x === null || finite(x))))) throw Error('Invalid loop: ' + identifier);
    const key = partition ?? identifier; // Simlin gives each unpartitioned loop its own group.
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({identifier, polarity, signed});
    const observed = signed?.filter(finite) ?? [];
    activity.set(identifier, {activeSamples:observed.filter(x => x !== 0).length,
      observedSamples:observed.length, totalSamples:time.length});
  }

  const periods = new Map();
  if (evidence.mode === 'exhaustive') {
    for (const [key, loops] of groups) {
      const intervals = [];
      for (const [i,t] of time.entries()) {
        const coalition = nativeSelection(loops,i);
        const previous = intervals.at(-1);
        if (previous && (coalition === null ? previous.loops === null :
            previous.loops !== null && sameMembers(coalition,previous.loops))) previous.end = t;
        else intervals.push({start:t,end:t,loops:coalition});
      }
      periods.set(key, intervals);
    }
  }
  return {time, variables, activity, periods};
}

// Decimal precision is explicit in each annotation. Multiple saved samples in a
// rounding bin are ambiguous. Never interpolate or silently pick the closest one.
function matchesPrecision(actual, claimed, decimals) {
  if (!finite(claimed)) return false;
  if (decimals === undefined) return actual === claimed;
  return Math.abs(actual - claimed) <= 0.5 * 10 ** -decimals;
}

export function checkLtmClaim(facts, claim) {
  const {kind, variable, at, value, decimals, timeDecimals} = claim;
  if ([decimals,timeDecimals].some(n => n !== undefined && (!Number.isInteger(n) || n < 0 || n > 15)))
    return unknown('invalid_precision');
  if (kind === 'dominance') {
    const {partition, loops, start, end} = claim;
    if (!Array.isArray(loops) || !loops.every(x => typeof x === 'string') ||
        new Set(loops).size !== loops.length || start > end || !facts.time.includes(start) ||
        !facts.time.includes(end)) return unknown('invalid_interval_or_coalition');
    const intervals = facts.periods.get(partition);
    if (!intervals) return unknown('unavailable_partition');
    const covered = intervals.filter(p => p.end >= start && p.start <= end);
    const mismatch = covered.find(p => p.loops !== null && !sameMembers(p.loops, loops));
    if (mismatch) return result(false, {time:Math.max(start,mismatch.start), loops:mismatch.loops});
    if (covered.some(p => p.loops === null)) return unknown('incomplete_scores');
    return result(true, {start,end,loops});
  }
  if (kind === 'active') {
    const activity = facts.activity.get(claim.loop);
    if (!activity || typeof value !== 'boolean') return unknown('missing_activity');
    if (!activity.activeSamples && activity.observedSamples !== activity.totalSamples) return unknown('incomplete_scores');
    return result((activity.activeSamples > 0) === value, activity);
  }
  if (!['min','max','value','above'].includes(kind)) return unknown('interpretation_outside_contract');
  const data = facts.variables.get(variable);
  if (!data || !finite(value)) return unknown('missing_variable_or_value');
  if (kind === 'min' || kind === 'max') {
    const observed = data[kind];
    if (at !== undefined && !finite(at)) return unknown('invalid_time');
    return result(matchesPrecision(observed.value,value,decimals) &&
      (at === undefined || observed.times.some(t => matchesPrecision(t,at,timeDecimals))), observed);
  }
  const samples = facts.time.filter(t => matchesPrecision(t,at,timeDecimals));
  if (samples.length !== 1) return unknown(samples.length ? 'ambiguous_time' : 'time_off_grid');
  const t = samples[0], actual = data.values[facts.time.indexOf(t)];
  return result(kind === 'above' ? actual > value : matchesPrecision(actual,value,decimals), {time:t,value:actual});
}
