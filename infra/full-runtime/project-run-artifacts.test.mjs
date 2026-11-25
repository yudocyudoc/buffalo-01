import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {projectModel} from './project.mjs';
import {projectRuns} from './project-runs.mjs';
import {projectRunArtifact} from './project-run-artifacts.mjs';
import {narrativeAssessment} from './run-narrative.mjs';
import {digest} from './provider-wire.mjs';

// Real SQLite, same statements and synchronous transaction boundary as the DO.
// Only the historical fixture bypasses the HTTP write contract.
function openStorage(path) {
  const db = new DatabaseSync(path);
  return {db, sql: {exec(query, ...bindings) {
    const statement = db.prepare(query);
    if (/^SELECT\b/i.test(query)) {
      const rows = statement.all(...bindings);
      return {toArray: () => rows};
    }
    statement.run(...bindings);
    return {toArray: () => []};
  }}, transactionSync(fn) {
    db.exec('BEGIN');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }};
}

function request(method, body, headers = {}) {
  return new Request('https://fixture.invalid/project', {method, headers, ...(body === undefined ? {} : {body})});
}

async function fixture(t, {unverified = false} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'buffalo-narrative-assessment-'));
  const path = join(dir, 'project.sqlite');
  let storage = openStorage(path);
  t.after(() => { storage.db.close(); rmSync(dir, {recursive: true, force: true}); });
  const settings = {startTime: 0, stopTime: 2, dt: 1, timeUnits: 'Day', integrationMethod: 'Euler'};
  const model = JSON.stringify({specs: settings, variables: [{name: 'Level', type: 'stock', equation: '1'}], relationships: []});
  const created = await projectModel(request('PUT', model, {'if-none-match': '*'}), storage);
  assert.equal(created.status, 201);
  const backend = {name: 'fixture', version: '1', implementation_sha256: 'a'.repeat(64)};
  const time = [0, 1, 2], runId = randomUUID();
  const run = JSON.stringify({revision: 1, model_sha256: await digest(model),
    simulator: {...backend, source: 'client'}, settings, execution: {integrationMethod: 'Euler', dt: 1},
    series: {time, Level: [1, 2, 4]}});
  assert.equal((await projectRuns(request('PUT', run), storage, runId)).status, 201);
  const scoreKey = 'Percent of Model Behavior Explained by Loop';
  const content = {valid: true, feedbackLoops: [{identifier: 'R1', polarity: '+',
    ...(unverified ? {} : {[scoreKey]: time.map(t => ({time: t, value: t === 0 ? 0 : 100}))})}],
    dominantLoopsByPeriod: [{startTime: 1, endTime: 2, dominantLoops: ['R1']}]};
  const feedback = JSON.stringify({run_id: runId, run_sha256: await digest(run), source: backend, content});
  assert.equal((await projectRunArtifact(request('PUT', feedback), storage, runId)).status, 201);
  const historical = {run_id: runId, run_sha256: await digest(run), feedback_sha256: await digest(feedback),
    prompt: 'Explain.', output: {textContent: '<p>Growth.</p>'},
    feedbackLoops: [{identifier: 'R1', name: 'Growth', description: 'Fixture.'}]};
  const narrative = {...historical, assessment: narrativeAssessment(content, time)};
  return {historical, narrative,
    put: (id, value) => projectRunArtifact(request('PUT', typeof value === 'string' ? value : JSON.stringify(value)), storage, runId, id),
    get: id => projectRunArtifact(request('GET'), storage, runId, id),
    seedLegacy(id, body) {
      storage.sql.exec('INSERT INTO run_artifacts(run_id,artifact_id,body) VALUES (?,?,?)', runId, id, body);
    },
    restart() { storage.db.close(); storage = openStorage(path); }
  };
}

test('new narratives require the exact server-derived assessment, even if unverified', async t => {
  for (const unverified of [false, true]) {
    const f = await fixture(t, {unverified});
    const id = randomUUID(), {assessment} = f.narrative;
    assert.equal(assessment.dominance.status, unverified ? 'unverified' : 'supported_by_whole_model_scores');
    for (const invalid of [f.historical, {...f.narrative, assessment: null},
      {...f.narrative, assessment: {}}, {...f.narrative, assessment: {dominance: assessment.dominance}},
      {...f.narrative, assessment: {...assessment, prose: 'verified'}},
      {...f.narrative, assessment: {...assessment, extra: true}},
      {...f.narrative, assessment: {...assessment, dominance: {status: 'contradicted'}}}]) {
      assert.equal((await f.put(id, invalid)).status, 422);
      assert.equal((await f.get(id)).status, 404);
    }
    // Object key order is immaterial, but assessment content must match exactly.
    const reordered = {...f.narrative, assessment: {prose: assessment.prose, dominance: assessment.dominance}};
    assert.equal((await f.put(id, reordered)).status, 201);
    assert.equal((await f.put(id, reordered)).status, 204);
    assert.equal((await f.put(id, f.historical)).status, 422);
    f.restart();
    assert.equal(await (await f.get(id)).text(), JSON.stringify(reordered));
  }
});

test('legacy records remain byte-identical across restart; only exact same-ID replay is acknowledged', async t => {
  const f = await fixture(t);
  const old = randomUUID(), fresh = randomUUID();
  const legacyBytes = JSON.stringify(f.historical, null, 2);
  f.seedLegacy(old, legacyBytes);
  f.restart();
  const read = await f.get(old);
  assert.equal(read.status, 200);
  assert.equal(await read.text(), legacyBytes);
  assert.equal((await f.put(old, legacyBytes)).status, 204);
  assert.equal((await f.put(old, f.historical)).status, 422); // same content but different bytes
  assert.equal((await f.put(old, {...f.historical, prompt: 'Changed.'})).status, 422);
  assert.equal((await f.put(old, f.narrative)).status, 409); // no backfill or mutation
  assert.equal((await f.put(fresh, legacyBytes)).status, 422);
  assert.equal((await f.get(fresh)).status, 404);
  assert.equal(await (await f.get(old)).text(), legacyBytes);
  assert.equal((await f.put(fresh, f.narrative)).status, 201);
  f.restart();
  assert.equal(await (await f.get(old)).text(), legacyBytes);
  assert.equal(await (await f.get(fresh)).text(), JSON.stringify(f.narrative));
});
