import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {generateRunNarrative, narrativeAssessment, validFeedback, validNarrative} from './run-narrative.mjs';
import {digest} from './provider-wire.mjs';

const time = [0, 1, 2];
const content = {
  valid: true, feedbackLoops: [{identifier: 'R1', polarity: '+'}, {identifier: 'R2', polarity: '+'}],
  dominantLoopsByPeriod: [{startTime: 0, endTime: 2, dominantLoops: ['R1', 'R2']}]
};

test('accepts joint dominance, rejects ambiguous IDs, unknown loops and misaligned evidence', () => {
  assert(validFeedback(content, time));
  for (const change of [
    c => { c.valid = false; }, c => { c.feedbackLoops[0].identifier = 'R2'; },
    c => { c.dominantLoopsByPeriod[0].dominantLoops = ['R3']; },
    c => { c.dominantLoopsByPeriod[0].endTime = 2.5; },
    c => { c.feedbackLoops[0]['Percent of this Feedback Loop Set Behavior Explained by Loop'] = [{time: 0, value: 50}]; }
  ]) {
    const changed = structuredClone(content);
    change(changed);
    assert.equal(validFeedback(changed, time), false);
  }
});

test('narrative loop descriptions cover the supplied identifiers in any order', () => {
  const loop = identifier => ({identifier, name: 'growth', description: 'A growth path'});
  const result = ids => ({output: {textContent: '<p>Two paths jointly dominate.</p>'}, feedbackLoops: ids.map(loop)});
  assert(validNarrative(result(['R2', 'R1']), content));
  for (const ids of [['R2', 'R2'], ['R1'], ['R1', 'B1']]) assert.equal(validNarrative(result(ids), content), false);
});

test('a detached feedback receipt from another run or trajectory cannot trigger inference', async () => {
  const id = randomUUID(), body = JSON.stringify({series: {time, Level: [1, 2, 4]}});
  const evidence = {run_id: id, run_sha256: await digest(body), content,
    source: {name: 'fixture', version: '1', implementation_sha256: 'b'.repeat(64)}};
  for (const overrides of [{run_id: randomUUID()}, {run_sha256: '0'.repeat(64)}]) {
    const request = async (path, init) => {
      assert.equal(init, undefined);
      return path.endsWith('/feedback') ? Response.json({...evidence, ...overrides}) : new Response(body);
    };
    await assert.rejects(generateRunNarrative(request, 'key', id, 'Explain.'), /FEEDBACK_MISMATCH/);
  }
});

const scoreKey = 'Percent of Model Behavior Explained by Loop';
function scoredFeedback(time, rows, periods) {
  return {valid: true, dominantLoopsByPeriod: periods,
    feedbackLoops: rows.map(([identifier, polarity, values]) => ({identifier, polarity,
      [scoreKey]: values.map((value, i) => ({time: time[i], value}))}))};
}

test('a structurally valid essay can reverse Bass dominance; only score-derived facts are supported', async () => {
  const grid = [0, 9.5625, 9.625, 15];
  const f = scoredFeedback(grid, [['R1', '+', [0, 52, 49, 1]], ['B1', '-', [0, 48, 51, 99]]],
    [{startTime: 0, endTime: 9.625, dominantLoops: ['R1']}, {startTime: 9.625, endTime: 15, dominantLoops: ['B1']}]);
  const wrong = {output: {textContent: 'B1 dominates before year 9.625.'},
    feedbackLoops: f.feedbackLoops.map(l => ({identifier: l.identifier, name: l.identifier, description: 'Fixture.'}))};
  assert(validNarrative(wrong, f));
  const a = narrativeAssessment(f, grid);
  assert.equal(a.prose, 'not_semantically_verified');
  assert.equal(a.dominance.checkedSamples, 3);
  assert.deepEqual(a.dominance.periods, [
    {firstSample: 9.5625, lastSample: 9.5625, loops: [{identifier: 'R1', polarity: '+'}]},
    {firstSample: 9.625, lastSample: 15, loops: [{identifier: 'B1', polarity: '-'}]}
  ]);
  f.dominantLoopsByPeriod[0].dominantLoops = ['B1'];
  assert.deepEqual(narrativeAssessment(f, grid).dominance, {status: 'contradicted', reason: 'below_majority',
    time: 9.5625, reportedLoops: ['B1'], share: 48});
  const id = randomUUID(), run = JSON.stringify({series: {time: grid, Level: [1, 2, 3, 4]}});
  const evidence = {run_id: id, run_sha256: await digest(run), content: f,
    source: {name: 'test', version: '1', implementation_sha256: 'a'.repeat(64)}};
  const read = async (path, init) => {
    assert.equal(init, undefined, 'contradicted dominance must stop before the engine POST');
    return path.endsWith('/feedback') ? Response.json(evidence) : new Response(run);
  };
  await assert.rejects(generateRunNarrative(read, 'key', id, 'Explain.'),
    error => error.message === 'NARRATIVE_DOMINANCE_CONTRADICTED' && error.cause.time === 9.5625);
});

test('joint dominance requires a same-sign minimal majority; incomplete, tied and set-relative evidence stays unverified', () => {
  const f = scoredFeedback(time, [['R1', '+', [0, 40, 40]], ['R2', '+', [0, 35, 35]], ['R3', '+', [0, 25, 25]]],
    [{startTime: 1, endTime: 2, dominantLoops: ['R1', 'R2']}]);
  const check = () => narrativeAssessment(f, time).dominance;
  assert.equal(check().status, 'supported_by_whole_model_scores');
  f.dominantLoopsByPeriod[0].dominantLoops.push('R3');
  assert.equal(check().reason, 'smaller_majority');
  f.feedbackLoops[0].polarity = '-';
  assert.equal(check().reason, 'mixed_polarities');
  delete f.feedbackLoops[0][scoreKey];
  assert.equal(check().reason, 'missing_whole_model_scores');
  f.feedbackLoops[0]['Percent of this Feedback Loop Set Behavior Explained by Loop'] = [];
  assert.equal(check().reason, 'loop_set_denominator');
  const half = scoredFeedback(time, [['R1', '+', [0, 50, 50]], ['B1', '-', [0, 50, 50]]],
    [{startTime: 0, endTime: 2, dominantLoops: ['R1']}]);
  assert.equal(narrativeAssessment(half, time).dominance.reason, 'half_threshold');
});
