import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LLMWrapper} from '../../utilities/LLMWrapper.js';
import {GEMMA} from '../private-merlin/gemma-response.mjs';
import {documentProjectModel} from './document-project-model.mjs';
import {digest} from './provider-wire.mjs';

const path = '/project/model';
const prompt = 'Explain the equations and units used by the inventory model.';
const archive = new URL('./evidence/quantitative-45551954016/remote-receipt.json', import.meta.url);
const descriptions = {
  Inventory: 'Inventory starts with 10 units and accumulates Inflow.',
  Inflow: 'Inflow adds the units requested by Demand each day.',
  Demand: 'Demand uses the daily rate defined by DailyDemandRate.',
  DailyDemandRate: 'DailyDemandRate fixes demand at 5 units per day.'
};
const connectionText = edge => edge.from + ' increases ' + edge.to + '.';

export async function exerciseDocumentation(request, key, setProvider) {
  let model = JSON.parse(readFileSync(archive, 'utf8')).model;
  const original = JSON.stringify(model);
  assert.equal((await request(path, {method: 'PUT', headers: {'if-none-match': '*'}, body: original})).status, 201);
  let revision = 1;
  let calls = 0;
  for (const [documentConnectors, generatePolarity] of [[false, false], [true, false], [true, true]]) {
    const schema = LLMWrapper.prototype.generateDocumentationResponseSchema(documentConnectors, generatePolarity).toJSONSchema();
    let requestHash;
    setProvider(async (providerModel, wire) => {
      calls++;
      assert.equal(providerModel, GEMMA);
      assert.deepEqual(wire.response_format, {type: 'json_schema', json_schema: schema});
      const userText = wire.messages.filter(m => m.role === 'user').map(m => m.content).join('\n');
      assert(userText.includes(JSON.stringify(model, null, 2)));
      assert(userText.includes(prompt));
      requestHash = await digest(JSON.stringify(wire));
      const output = {summary: 'Inventory accumulates the daily inflow.',
        variables: model.variables.map(v => ({name: v.name, documentation: descriptions[v.name]})).reverse()};
      if (documentConnectors) output.relationships = model.relationships.map(edge => ({
        from: edge.from, to: edge.to, reasoning: connectionText(edge),
        ...(generatePolarity ? {polarity: '+', polarityReasoning: connectionText(edge)} : {})
      })).reverse();
      return {model: providerModel, usage: {prompt_tokens: 500, completion_tokens: 100},
        choices: [{index: 0, finish_reason: 'stop', message: {role: 'assistant', content: JSON.stringify(output)}}]};
    });
    const saved = await documentProjectModel(request, key, {revision, prompt, documentConnectors, generatePolarity});
    assert.equal(saved.sourceHash, await digest(JSON.stringify(model)));
    assert.equal(saved.revision, revision + 1);
    assert.equal(saved.supportingInfo.title, 'Documentation Summary');
    revision = saved.revision;
    model = await (await request(path)).json();
    assert.equal(await digest(JSON.stringify(model)), saved.hash);
    for (const variable of model.variables) assert.equal(variable.documentation, descriptions[variable.name]);
    if (documentConnectors) for (const edge of model.relationships) {
      assert.equal(edge.reasoning, connectionText(edge));
      if (generatePolarity) assert.equal(edge.polarityReasoning, connectionText(edge));
    }
    const receipt = await (await request('/project/inference/' + (revision - 1))).json();
    assert.equal(receipt.status, 'OK');
    assert.equal(receipt.channel, 'original-engine');
    assert.equal(receipt.request_sha256, requestHash);
    assert.equal(receipt.schema_sha256, await digest(JSON.stringify(schema)));
    assert.equal(receipt.predicates.schema_valid, true);
  }
  assert.equal(calls, 3);
  assert.equal((await request('/project/inference/4')).status, 404);
  assert.equal(await (await request(path + '/revisions/1')).text(), original);
  return {revision, model};
}
