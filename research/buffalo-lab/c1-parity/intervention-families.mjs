// Fixed candidate interventions. A failed hypothesis is not a failed pipeline.
// No automatic substitution, retries or post-observation selection.
export const PLAN_VERSION='BUFFALO_INTERVENTION_FAMILIES_V1';
export const PLAN=Object.freeze([
 {id:'A',family:'translation',fixture:'inventoryWorkforce',method:'RK4',saveStep:.0625,variable:'Desired Inventory',from:'100',to:'110',seriesNames:['inventory','workers','expected_demand'],hypothesis:'Inventory translates by +10; other selected trajectories and comparable relative scores/dominance are unchanged.'},
 {id:'B',family:'amplitude_scaling',fixture:'armsRace',method:'Euler',saveStep:.125,variable:'Our Weapons',from:'10',to:'20',seriesNames:['our_weapons','their_weapons'],hypothesis:'Both selected stock trajectories scale by 2; relative scores/dominance remain unchanged within numerical tolerance.'},
 {id:'C',family:'adjustment_time',fixture:'inventoryWorkforce',method:'RK4',saveStep:.0625,variable:'time to hire or fire',from:'6',to:'3',seriesNames:['inventory','workers','expected_demand'],hypothesis:'Inventory and Workers trajectories change; directed cycle inventory remains unchanged. No claim of a specific oscillation period.'},
 {id:'D',family:'dominance_timing',fixture:'bassDiffusion',method:'Euler',saveStep:.0625,variable:'contact rate',from:'100',to:'50',seriesNames:['adopters','potential_adopters'],hypothesis:'At least one saved sample has a different dominant coalition in an exactly matched group; cycle inventory remains unchanged.'},
 {id:'E',family:'activation',fixture:'maibab',method:'RK4',saveStep:.125,stopTime:1812,variable:'Normal Food Per Deer',from:'1',to:'100',seriesNames:['food_availability','deer_population','predator_population'],hypothesis:'At least one structurally matched cycle has zero active samples in baseline and positive activity in comparison; inventory of cycles unchanged.'},
 {id:'F',family:'structure',fixture:'inventoryWorkforce',method:'RK4',saveStep:.0625,variable:'desired change in inventory',from:'inventory_gap/inventory_adjustment_time',to:'0',seriesNames:['inventory','workers','expected_demand'],hypothesis:'At least one directed native cycle disappears, without a new cycle; groups with changed denominators are excluded from relative-score comparison.'}
].map(x=>Object.freeze({...x,seriesNames:Object.freeze(x.seriesNames)})));
export const NUMERIC_TOLERANCE=1e-10;
const near=(a,b)=>Math.abs(a-b)<=NUMERIC_TOLERANCE*Math.max(1,Math.abs(a),Math.abs(b));
const all=(a,b,f)=>a.length===b.length&&a.every((x,i)=>f(x,b[i]));
export function evaluateHypothesis(spec,reference,originals){
 const [a,b]=originals.map(x=>JSON.parse(x.runBody).series);
 const shared=reference.structural_cycles,unchanged=shared.added.length===0&&shared.removed.length===0;
 const groups=reference.comparableGroups,allComparable=groups.length>0&&reference.unmatchedGroups.length===0;
 const sameScores=allComparable&&groups.every(g=>g.loopScores.every(l=>l.max_abs_signed_relative_delta<=NUMERIC_TOLERANCE));
 const sameDominance=allComparable&&groups.every(g=>g.dominance_changed_samples===0);
 const observed=Object.fromEntries(reference.trajectories.map(t=>[t.variable,t.delta.max_abs]));
 const reactivated=reference.activity.filter(l=>l.baseline.active_samples===0&&l.comparison.active_samples>0).map(l=>l.cycle);
 let checks;
 switch(spec.id){
 case 'A':checks={offset:all(a.inventory,b.inventory,(x,y)=>near(y-x,10)),workers:all(a.workers,b.workers,near),demand:all(a.expected_demand,b.expected_demand,near),unchanged,sameScores,sameDominance};break;
 case 'B':checks={scaled:spec.seriesNames.every(n=>all(a[n],b[n],(x,y)=>near(2*x,y))),unchanged,sameScores,sameDominance};break;
 case 'C':checks={inventory_changed:observed.inventory>NUMERIC_TOLERANCE,workers_changed:observed.workers>NUMERIC_TOLERANCE,unchanged};break;
 case 'D':checks={unchanged,allComparable,dominance_changed:groups.some(g=>g.dominance_changed_samples>0)};break;
 case 'E':checks={unchanged,reactivated:reactivated.length>0};break;
 case 'F':checks={removed:shared.removed.length>0,no_added:shared.added.length===0};break;
 default:throw Error('UNKNOWN_INTERVENTION_CASE');
 }
 return {status:Object.values(checks).every(Boolean)?'confirmed':'not_confirmed',checks,reactivated,observed};
}
// Versioned rubric is frozen before runs; free prose must be atomized by
// reviewers, not treated as verified merely because a model selects a fact.
export const RUBRIC=Object.freeze({
 version:'BUFFALO_COMPARATIVE_ANNOTATION_V1',
 unit:'one independently checkable factual assertion; split conjunctions and preserve exact quoted span',
 labels:{
  supported:'matches explicit reference facts at stated precision and scope',
  contradicted:'reference supplies incompatible fact at stated precision and scope',
  unverified:'reference cannot decide, including causal magnitude, off-grid events, or unmatched denominator comparisons',
  not_evaluable:'nonfactual recommendation, question, or statement without an identifiable proposition'
 },
 rules:[
  'Identify ordered run pair and variable/cycle/group before checking; local IDs alone cannot establish correspondence.',
  'Use full saved-grid facts, not interpolation. Numerical claim must specify units, sign/direction and precision; compare to rounding interval when precision is explicit.',
  'Do not compare relative scores across unmatched member groups or equate relative scores to absolute causal effects.',
  'Separate structure, activity, relative scores, dominant coalition, trajectory amplitude and timing. A missing mechanism is not a zero score.',
  'A controlled equation contrast identifies a difference inside these models only; no independent real-world causal inference.',
  'Record omissions separately against the fixed question targets; do not inflate supported rate with repeated or nonfactual text.',
  'Two independent annotators should record quote, normalized proposition, label, reason and exact reference path; disagreements retained and adjudicated without editing original outputs.'
 ],
 question:'Compare baseline and intervention on the selected saved grid. What changed in the trajectories, structural cycles, activity, relative scores and dominant coalitions? State what cannot be inferred, especially across different normalization groups.'
});
