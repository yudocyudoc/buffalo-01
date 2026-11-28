import test from 'node:test';
import assert from 'node:assert/strict';
import {PLAN,PLAN_VERSION,RUBRIC,evaluateHypothesis} from './intervention-families.mjs';
test('predeclared six unique interventions and fixed rubric distinguish unverified from contradiction',()=>{
 assert.equal(PLAN_VERSION,'BUFFALO_INTERVENTION_FAMILIES_V1');assert.deepEqual(PLAN.map(x=>x.id),['A','B','C','D','E','F']);
 assert.equal(new Set(PLAN.map(x=>x.family)).size,6);assert(PLAN.every(x=>x.from!==x.to&&x.seriesNames.length));
 assert.deepEqual(Object.keys(RUBRIC.labels),['supported','contradicted','unverified','not_evaluable']);
 assert(Object.isFrozen(PLAN)&&PLAN.every(Object.isFrozen));
});
function fixture(){
 const a={inventory:[1,2],workers:[3,4],expected_demand:[2,2],our_weapons:[1,2],their_weapons:[0,1]};
 const b={inventory:[11,12],workers:[3,4],expected_demand:[2,2],our_weapons:[2,4],their_weapons:[0,2]};
 const ref={structural_cycles:{shared:[['x']],added:[],removed:[]},comparableGroups:[{dominance_changed_samples:0,loopScores:[{max_abs_signed_relative_delta:0}]}],unmatchedGroups:[],activity:[{cycle:['x'],baseline:{active_samples:0},comparison:{active_samples:2}}],trajectories:[{variable:'inventory',delta:{max_abs:10}},{variable:'workers',delta:{max_abs:0}}]};
 return {ref,originals:[a,b].map(series=>({runBody:JSON.stringify({series})}))};
}
test('offset and scaling confirmed independently of unchanged scores; failed hypotheses retained',()=>{
 const {ref,originals}=fixture();
 for(const id of ['A','B','E'])assert.equal(evaluateHypothesis(PLAN.find(x=>x.id===id),ref,originals).status,'confirmed');
 for(const id of ['C','D','F'])assert.equal(evaluateHypothesis(PLAN.find(x=>x.id===id),ref,originals).status,'not_confirmed');
 ref.comparableGroups[0].dominance_changed_samples=1;
 assert.equal(evaluateHypothesis(PLAN[3],ref,originals).status,'confirmed');
 assert.equal(evaluateHypothesis(PLAN[0],ref,originals).status,'not_confirmed');
});
test('unmatched denominators cannot establish unchanged relative scores or confirmed dominance shift',()=>{
 const {ref,originals}=fixture();ref.unmatchedGroups=[{side:'baseline',cycles:[['y']]}];ref.comparableGroups[0].dominance_changed_samples=1;
 assert.equal(evaluateHypothesis(PLAN[3],ref,originals).status,'not_confirmed');
 assert.equal(evaluateHypothesis(PLAN[0],ref,originals).checks.sameScores,false);
 ref.structural_cycles.removed=[['y']];assert.equal(evaluateHypothesis(PLAN[5],ref,originals).status,'confirmed');
 ref.structural_cycles.added=[['z']];assert.equal(evaluateHypothesis(PLAN[5],ref,originals).status,'not_confirmed');
});
