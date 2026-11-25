import assert from 'node:assert/strict';
import {test} from 'node:test';
import {documentProjectModel} from './document-project-model.mjs';
import {digest} from './provider-wire.mjs';

const source = {
  specs: {dt: 1}, variables: [{name: 'Demand', equation: '5', units: 'items/day'}, {name: 'Inflow', equation: 'Demand'}],
  relationships: [{from: 'Demand', to: 'Inflow', polarity: '+'}]
};
const options = {revision: 3, prompt: 'Document the model.', documentConnectors: true};

async function fixture({model = source, change, hash, saveStatus = 204} = {}) {
  const body = JSON.stringify(model);
  const headers = {etag: '"3"', 'x-buffalo-model-sha256': hash ?? await digest(body)};
  const calls = [];
  const request = async (path, init = {}) => {
    calls.push(init.method ?? 'GET');
    if (!init.method) return new Response(body, {headers});
    if (init.method === 'POST') {
      assert.equal(path, '/api/v1/engines/generate-documentation/generate');
      const output = JSON.parse(init.body).currentModel;
      for (const v of output.variables) v.documentation = 'Describes ' + v.name;
      output.relationships[0].reasoning = 'Demand sets Inflow.';
      change?.(output);
      return Response.json({success: true, model: output});
    }
    assert.equal(path, '/project/model');
    assert.equal(init.headers['if-match'], '"3"');
    return new Response(null, {status: saveStatus, headers: {etag: '"4"', 'x-buffalo-model-sha256': await digest(init.body)}});
  };
  return {request, calls};
}

test('refuses incomplete annotations or structural changes before saving', async () => {
  for (const change of [
    m => { m.variables.pop(); }, m => { m.variables[0].documentation = ' '; },
    m => { delete m.relationships[0].reasoning; }, m => { m.variables[0].equation = '6'; },
    m => { m.variables[0].units = 'kg'; }, m => { m.relationships[0].to = 'Demand'; },
    m => { m.relationships[0].polarity = '-'; }, m => { m.specs.dt = 2; }
  ]) {
    const f = await fixture({change});
    await assert.rejects(documentProjectModel(f.request, 'key', options), /MISSING_|CHANGED_MODEL_STRUCTURE/);
    assert.deepEqual(f.calls, ['GET', 'POST']);
  }
});

test('rejects stale, damaged or ambiguous inputs before generation', async () => {
  for (const [input, revision, error] of [
    [{}, 2, /REVISION_CHANGED/], [{hash: 'incorrect'}, 3, /SOURCE_DIGEST/],
    [{model: {...source, variables: [...source.variables, source.variables[0]]}}, 3, /AMBIGUOUS_DOCUMENTATION_VARIABLES/],
    [{model: {...source, relationships: [...source.relationships, ...source.relationships]}}, 3, /AMBIGUOUS_DOCUMENTATION_CONNECTORS/]
  ]) {
    const f = await fixture(input);
    await assert.rejects(documentProjectModel(f.request, 'key', {...options, revision}), error);
    assert.deepEqual(f.calls, ['GET']);
  }
});

test('concurrent edit rejects the save after one generation', async () => {
  const f = await fixture({saveStatus: 412});
  await assert.rejects(documentProjectModel(f.request, 'key', options), /REVISION_CHANGED/);
  assert.deepEqual(f.calls, ['GET', 'POST', 'PUT']);
});
