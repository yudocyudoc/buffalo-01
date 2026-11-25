import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {generateRunNarrative, validFeedback, validNarrative} from './run-narrative.mjs';
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
