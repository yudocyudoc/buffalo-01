import {isDeepStrictEqual} from 'node:util';
import {digest} from './provider-wire.mjs';

const modelPath = '/project/model';
const hasText = value => typeof value === 'string' && value.trim().length > 0;

// SD-AI applies annotations by variable name and by the string "from:to".
// Two entities sharing one lookup key cannot be documented independently.
function checkTargets(model, connectors) {
  const names = model.variables.map(v => v.name);
  if (!names.length || !names.every(hasText) || new Set(names).size !== names.length)
    throw Error('AMBIGUOUS_DOCUMENTATION_VARIABLES');
  if (connectors) {
    const keys = model.relationships.map(r => r.from + ':' + r.to);
    if (new Set(keys).size !== keys.length) throw Error('AMBIGUOUS_DOCUMENTATION_CONNECTORS');
  }
}

function checkAnnotations(source, result, connectors, polarity) {
  const expected = structuredClone(source);
  const polarityChanges = [];
  for (const [index, variable] of expected.variables.entries()) {
    const text = result?.variables?.[index]?.documentation;
    if (!hasText(text)) throw Error('MISSING_VARIABLE_DOCUMENTATION');
    variable.documentation = text;
  }
  if (connectors) {
    for (const [index, edge] of expected.relationships.entries()) {
      const annotation = result?.relationships?.[index];
      if (!hasText(annotation?.reasoning)) throw Error('MISSING_CONNECTOR_DOCUMENTATION');
      edge.reasoning = annotation.reasoning;
      if (polarity) {
        if (!['+', '-'].includes(annotation.polarity) || !hasText(annotation.polarityReasoning))
          throw Error('MISSING_CONNECTOR_POLARITY');
        if (edge.polarity !== annotation.polarity) {
          polarityChanges.push({from: edge.from, to: edge.to, before: edge.polarity ?? null, after: annotation.polarity});
        }
        edge.polarity = annotation.polarity;
        edge.polarityReasoning = annotation.polarityReasoning;
      }
    }
  }
  if (!isDeepStrictEqual(expected, result)) throw Error('DOCUMENTATION_CHANGED_MODEL_STRUCTURE');
  return polarityChanges;
}

// request is bound to one authorized project, like the Seldon comparison client.
export async function documentProjectModel(request, key, {
  revision, prompt = '', backgroundKnowledge, problemStatement, documentConnectors = false, generatePolarity = false
}) {
  if (!Number.isSafeInteger(revision) || revision < 1 || typeof prompt !== 'string' ||
      [backgroundKnowledge, problemStatement].some(value => value !== undefined && typeof value !== 'string') ||
      typeof documentConnectors !== 'boolean' || typeof generatePolarity !== 'boolean' ||
      (generatePolarity && !documentConnectors)) throw Error('INVALID_DOCUMENTATION_REQUEST');
  const source = await request(modelPath);
  if (!source.ok) throw Error('DOCUMENTATION_MODEL_UNAVAILABLE');
  const etag = source.headers.get('etag');
  if (etag !== '"' + revision + '"') throw Error('DOCUMENTATION_REVISION_CHANGED');
  const body = await source.text();
  const sourceHash = await digest(body);
  if (sourceHash !== source.headers.get('x-buffalo-model-sha256')) throw Error('DOCUMENTATION_SOURCE_DIGEST');
  const currentModel = JSON.parse(body);
  checkTargets(currentModel, documentConnectors);
  const response = await request('/api/v1/engines/generate-documentation/generate', {
    method: 'POST', headers: {Authentication: key, 'content-type': 'application/json'},
    body: JSON.stringify({prompt, currentModel, backgroundKnowledge, problemStatement, documentConnectors, generatePolarity})
  });
  if (!response.ok) throw Error('DOCUMENTATION_HTTP_FAILURE');
  const result = await response.json();
  if (result.success !== true) throw Error('DOCUMENTATION_ENGINE_FAILURE');
  const polarityChanges = checkAnnotations(currentModel, result.model, documentConnectors, generatePolarity);
  const updated = JSON.stringify(result.model);
  const saved = await request(modelPath, {method: 'PUT', headers: {'if-match': etag}, body: updated});
  if (saved.status === 412) throw Error('DOCUMENTATION_REVISION_CHANGED');
  if (saved.status !== 204) throw Error('DOCUMENTATION_SAVE_FAILURE');
  const hash = await digest(updated);
  if (saved.headers.get('x-buffalo-model-sha256') !== hash || saved.headers.get('etag') !== '"' + (revision + 1) + '"')
    throw Error('DOCUMENTATION_SAVE_UNCONFIRMED');
  return {sourceRevision: revision, sourceHash, revision: revision + 1, hash, supportingInfo: result.supportingInfo, polarityChanges};
}
