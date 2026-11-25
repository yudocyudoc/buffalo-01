import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {loadBassReference} from './bass-feedback-reference.mjs';
import {generateRunNarrative} from './run-narrative.mjs';
import {digest} from './provider-wire.mjs';
import {LLMWrapper} from '../../utilities/LLMWrapper.js';
import {GEMMA} from '../private-merlin/gemma-response.mjs';

const scoreKey = 'Percent of Model Behavior Explained by Loop';
const put = (request, path, value, headers) => request(path, {method: 'PUT', headers, body: JSON.stringify(value)});
const json = async response => { assert.equal(response.status, 200); return response.json(); };

async function bassCase() {
  const body = readFileSync(process.env.FULL_LTM_REPORT, 'utf8');
  const report = JSON.parse(body);
  const bass = report.bass;
  const {model, feedback, provenance} = loadBassReference();
  assert.equal(report.status, 'BASS_PRODUCT_PROFILE_PASS');
  assert.equal(bass.changed_last.passed, true);
  assert.equal(report.reference.stmx_sha256, provenance.stmx_sha256);
  assert.match(process.env.FULL_LTM_IMAGE, /^sha256:[a-f0-9]{64}$/);
  const backend = {name: 'pysimlin', version: report.pysimlin_version,
    implementation_sha256: process.env.FULL_LTM_IMAGE.slice(7)};
  // The original SD-JSON omits the integrator. Record a derived project revision with
  // the Euler setting from the exact XMILE used in this run.
  model.specs.integrationMethod = provenance.xmile_method;
  const [transition] = bass.changed_last.balancing_transitions;
  assert.deepEqual(bass.changed_last.balancing_transitions, [9.625]);
  const feedbackLoops = feedback.feedbackLoops.map(({identifier, links, polarity}) => {
    const measured = bass.loops[identifier];
    assert.equal(measured.polarity, polarity === '+' ? 'R' : 'B');
    return {identifier, links, polarity, [scoreKey]: measured.changed_last_signed_relative_scores.map((v, i) =>
      ({time: bass.time[i], value: 100 * Math.abs(v)}))};
  });
  return {model, backend, series: {time: bass.time, ...bass.trajectory},
    source: {...backend, name: 'pysimlin + Buffalo Bass scalar-product profile', report_sha256: await digest(body),
      source_xmile_sha256: provenance.stmx_sha256},
    content: {valid: true, feedbackLoops, dominantLoopsByPeriod: [
      {startTime: bass.time[0], endTime: transition, dominantLoops: ['R1']},
      {startTime: transition, endTime: bass.time.at(-1), dominantLoops: ['B1']}
    ]},
    narrative: 'From year 0 to 9.625, reinforcing word of mouth drives adoption. From 9.625 to 15, the balancing effect of fewer potential adopters dominates.'};
}

async function jointCase() {
  // Analytic control: three proportional inflows double the stock each Euler step.
  const settings = {startTime: 0, stopTime: 2, dt: 1, timeUnits: 'Day', integrationMethod: 'Euler'};
  const rates = [0.4, 0.35, 0.25], time = [0, 1, 2], stock = [1, 2, 4];
  const flows = rates.map((rate, i) => ({name: 'Growth' + (i + 1), type: 'flow', equation: rate + '*Stock'}));
  const model = {specs: settings, variables: [{name: 'Stock', type: 'stock', equation: '1',
    inflows: flows.map(f => f.name), outflows: []}, ...flows],
    relationships: flows.map(f => ({from: 'Stock', to: f.name, polarity: '+'}))};
  const backend = {name: 'analytic Euler test fixture', version: '1',
    implementation_sha256: await digest(readFileSync(new URL('./test-run-narrative.mjs', import.meta.url), 'utf8'))};
  return {model, backend, source: backend, series: {time, Stock: stock,
    ...Object.fromEntries(flows.map((f, i) => [f.name, stock.map(v => v * rates[i])]))},
    content: {valid: true, feedbackLoops: flows.map((f, i) => ({identifier: 'R' + (i + 1), polarity: '+',
      links: [{from: 'Stock', to: f.name, polarity: '+'}, {from: f.name, to: 'Stock', polarity: '+'}],
      [scoreKey]: time.map(t => ({time: t, value: t === 0 ? 0 : rates[i] * 100}))})),
      dominantLoopsByPeriod: [{startTime: 1, endTime: 2, dominantLoops: ['R1', 'R2']}]},
    narrative: 'From day 1 to 2, two reinforcing growth paths jointly dominate. Their shared mechanism is that a larger stock generates larger inflows.'};
}

export async function seedNarrativeRuns(request, other) {
  const cases = [await bassCase(), await jointCase()];
  for (const [i, c] of cases.entries()) {
    const model = await put(request, '/project/model', c.model, i ? {'if-match': '"1"'} : {'if-none-match': '*'});
    assert.equal(model.status, i ? 204 : 201);
    c.runId = randomUUID();
    c.path = '/project/runs/' + c.runId;
    const record = {revision: i + 1, model_sha256: model.headers.get('x-buffalo-model-sha256'),
      simulator: {...c.backend, source: 'client'}, settings: c.model.specs,
      execution: {integrationMethod: 'Euler', dt: c.model.specs.dt}, series: c.series};
    assert.equal((await put(request, c.path, record)).status, 201);
    c.feedback = {run_id: c.runId, run_sha256: await digest(JSON.stringify(record)), source: c.source, content: c.content};
  }
  const [bass, joint] = cases;
  await assert.rejects(generateRunNarrative(request, 'unused', bass.runId, 'Explain.'), /FEEDBACK_UNAVAILABLE/);
  assert.equal((await put(request, joint.path + '/feedback', bass.feedback)).status, 409);
  assert.equal((await put(request, joint.path + '/feedback', {...bass.feedback, run_id: joint.runId})).status, 409);
  for (const c of cases) {
    assert.equal((await put(other, c.path + '/feedback', c.feedback)).status, 404);
    const writes = await Promise.all([1, 2].map(() => put(request, c.path + '/feedback', c.feedback)));
    assert.deepEqual(writes.map(r => r.status).sort(), [201, 204]);
    assert.equal((await put(request, c.path + '/feedback', {...c.feedback, source: {...c.source, version: 'changed'}})).status, 409);
  }
  assert.equal((await request('/project/inference/1')).status, 404);
  return cases;
}

export async function exerciseRunNarratives(request, other, key, cases, setProvider) {
  const prompt = 'Explain how feedback dominance changes over the reported periods.';
  const schema = LLMWrapper.prototype.generateLTMNarrativeResponseSchema().toJSONSchema();
  for (const [i, c] of cases.entries()) {
    let calls = 0, requestHash;
    setProvider(async (providerModel, wire) => {
      calls++;
      assert.equal(providerModel, GEMMA);
      assert.deepEqual(wire.response_format, {type: 'json_schema', json_schema: schema});
      assert.deepEqual(JSON.parse(wire.messages.find(m => m.role === 'assistant').content), c.content);
      const user = wire.messages.filter(m => m.role === 'user').map(m => m.content).join('\n');
      for (const expected of [c.runId, c.feedback.run_sha256, JSON.stringify(c.series), prompt]) assert(user.includes(expected));
      requestHash = await digest(JSON.stringify(wire));
      const output = {feedbackLoops: c.content.feedbackLoops.map(loop => ({identifier: loop.identifier,
        name: (loop.polarity === '+' ? 'Reinforcing ' : 'Balancing ') + loop.identifier,
        description: loop.links.map(link => link.from).join(' → ')})), narrativeMarkdown: c.narrative};
      return {model: providerModel, usage: {prompt_tokens: 400, completion_tokens: 90},
        choices: [{index: 0, finish_reason: 'stop', message: {role: 'assistant', content: JSON.stringify(output)}}]};
    });
    const narrative = await generateRunNarrative(request, key, c.runId, prompt);
    assert.equal(calls, 1);
    assert.equal(narrative.output.textContent.trim(), '<p>' + c.narrative + '</p>');
    assert.equal(narrative.assessment.prose, 'not_semantically_verified');
    assert.equal(narrative.assessment.dominance.status, 'supported_by_whole_model_scores');
    assert.equal(narrative.assessment.dominance.checkedSamples, c.series.time.length - 1);
    if (i === 0) {
      const [first, second] = narrative.assessment.dominance.periods;
      assert.deepEqual(first.loops, [{identifier: 'R1', polarity: '+'}]);
      assert.equal(first.lastSample, 9.5625);
      assert.deepEqual(second.loops, [{identifier: 'B1', polarity: '-'}]);
      assert.equal(second.firstSample, 9.625);
    }
    const receipt = await json(await request('/project/inference/' + (i + 1)));
    assert.equal(receipt.status, 'OK');
    assert.equal(receipt.request_sha256, requestHash);
    assert.equal(receipt.schema_sha256, await digest(JSON.stringify(schema)));
    c.narrativePath = c.path + '/narratives/' + randomUUID();
    const {assessment: ignoredAssessment, ...withoutAssessment} = narrative;
    for (const invalid of [withoutAssessment, {...narrative, assessment: null}, {...narrative, assessment: {}}]) {
      assert.equal((await put(request, c.narrativePath, invalid)).status, 422);
      assert.equal((await request(c.narrativePath)).status, 404);
    }
    assert.equal((await put(request, c.narrativePath,
      {...narrative, assessment: {...narrative.assessment, prose: 'verified'}})).status, 422);
    assert.equal((await put(request, c.narrativePath, {...narrative, feedback_sha256: '0'.repeat(64)})).status, 409);
    assert.equal((await put(request, c.narrativePath, narrative)).status, 201);
    assert.equal((await put(request, c.narrativePath, narrative)).status, 204);
    assert.equal((await put(request, c.narrativePath, withoutAssessment)).status, 422);
    assert.deepEqual(await json(await request(c.narrativePath)), narrative);
    assert.equal((await other(c.narrativePath)).status, 404);
    c.saved = narrative;
  }
  assert.equal((await request('/project/inference/3')).status, 404);
}
