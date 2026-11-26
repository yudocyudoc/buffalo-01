import {digest} from './provider-wire.mjs';
import {RUN_ID} from './project-runs.mjs';
import {assessDominance} from './dominance-evidence.mjs';

const text = value => typeof value === 'string' && value.trim().length > 0;
const scoreKeys = ['Percent of Model Behavior Explained by Loop', 'Percent of this Feedback Loop Set Behavior Explained by Loop'];

export function validFeedback(content, time) {
  if (content?.valid !== true || !Array.isArray(content.feedbackLoops) || !content.feedbackLoops.length ||
      !Array.isArray(content.dominantLoopsByPeriod) || !content.dominantLoopsByPeriod.length) return false;
  const ids = new Set();
  for (const loop of content.feedbackLoops) {
    if (!text(loop?.identifier) || ids.has(loop.identifier) || !['+', '-', ''].includes(loop.polarity)) return false;
    ids.add(loop.identifier);
    for (const scoreKey of scoreKeys) {
      if (!Object.hasOwn(loop, scoreKey)) continue;
      const scores = loop[scoreKey];
      if (!Array.isArray(scores) || scores.length !== time.length || !scores.every((p, i) =>
        p?.time === time[i] && Number.isFinite(p.value) && p.value >= 0 && p.value <= 100)) return false;
    }
  }
  const grid = new Set(time);
  const ends = new Map();
  for (const p of content.dominantLoopsByPeriod) {
    const group = p?.partition === null ? p.dominantLoops?.[0] : p?.partition;
    if (!grid.has(p?.startTime) || !grid.has(p.endTime) || p.endTime < p.startTime || p.startTime < (ends.get(group) ?? -Infinity) ||
        !Array.isArray(p.dominantLoops) || !p.dominantLoops.length ||
        new Set(p.dominantLoops).size !== p.dominantLoops.length || !p.dominantLoops.every(id => ids.has(id))) return false;
    if (p.partition !== undefined && !p.dominantLoops.every(id => content.feedbackLoops.find(l=>l.identifier===id)?.partition === p.partition)) return false;
    ends.set(group,p.endTime);
  }
  return true;
}

// Checks output shape and loop identifiers only. Arbitrary text may contradict the evidence.
// Keep the boolean gate and its explanation on one code path. Bound diagnostic
// amplification independently of the exact rejected tool-result evidence.
export function diagnoseNarrative(result, feedback) {
  const expected = new Set(feedback.feedbackLoops.map(loop => loop.identifier));
  const loops = result?.feedbackLoops;
  const issues = [];
  let issueCount = 0;
  const add = (code, path, identifier) => {
    issueCount++;
    if (issues.length >= 128) return;
    const issue = {code, path};
    if (typeof identifier === 'string') {
      issue.identifier = identifier.slice(0, 256);
      if (identifier.length > 256) issue.identifier_truncated = true;
    }
    issues.push(issue);
  };
  if (!text(result?.output?.textContent)) add('MISSING_OR_EMPTY_TEXT', 'output.textContent');
  const seen = new Set();
  if (!Array.isArray(loops)) add('EXPECTED_LOOP_ARRAY', 'feedbackLoops');
  else {
    if (loops.length !== expected.size) add('LOOP_COUNT_MISMATCH', 'feedbackLoops.length');
    for (let i = 0; i < loops.length; i++) {
      const loop = loops[i], path = 'feedbackLoops[' + i + ']';
      const id = loop?.identifier;
      if (typeof id !== 'string') add('INVALID_IDENTIFIER_TYPE', path + '.identifier');
      else {
        if (!expected.has(id)) add('UNEXPECTED_IDENTIFIER', path + '.identifier', id);
        if (seen.has(id)) add('DUPLICATE_IDENTIFIER', path + '.identifier', id);
        seen.add(id);
      }
      if (!text(loop?.name)) add('MISSING_OR_EMPTY_NAME', path + '.name', id);
      if (!text(loop?.description)) add('MISSING_OR_EMPTY_DESCRIPTION', path + '.description', id);
    }
  }
  for (const id of expected) if (!seen.has(id)) add('MISSING_IDENTIFIER', 'feedbackLoops', id);
  return {valid: issueCount === 0, expectedCount: expected.size,
    receivedCount: Array.isArray(loops) ? loops.length : null,
    issueCount, issues, omittedIssueCount: issueCount - issues.length};
}

export function validNarrative(result, feedback) {
  return diagnoseNarrative(result, feedback).valid;
}

export function validFeedbackSource(source) {
  return text(source?.name) && text(source.version) && typeof source.implementation_sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(source.implementation_sha256);
}

// Keep generation separate from saving. Retrying a save uses the same bytes and UUID.
export async function generateRunNarrative(request, key, runId, prompt) {
  if (!RUN_ID.test(runId) || !text(prompt)) throw Error('INVALID_NARRATIVE_REQUEST');
  const path = '/project/runs/' + runId;
  const runResponse = await request(path);
  if (!runResponse.ok) throw Error('NARRATIVE_RUN_UNAVAILABLE');
  const runBody = await runResponse.text();
  const run = JSON.parse(runBody);
  const response = await request(path + '/feedback');
  if (!response.ok) throw Error('NARRATIVE_FEEDBACK_UNAVAILABLE');
  const feedbackBody = await response.text();
  const feedback = JSON.parse(feedbackBody);
  const runHash = await digest(runBody);
  if (feedback.run_id !== runId || feedback.run_sha256 !== runHash ||
      !validFeedbackSource(feedback.source) || !validFeedback(feedback.content, run.series.time))
    throw Error('NARRATIVE_FEEDBACK_MISMATCH');
  const assessment = await assessRunFeedback(run, feedback, async () => {
    const res = await request(path+'/ltm');
    if (!res.ok) throw Error('NARRATIVE_NATIVE_EVIDENCE_UNAVAILABLE');
    return res.text();
  });
  if (assessment.dominance.status === 'contradicted')
    throw Error('NARRATIVE_DOMINANCE_CONTRADICTED', {cause: assessment.dominance});
  const provenance = {run_id: runId, run_sha256: runHash, revision: run.revision,
    model_sha256: run.model_sha256, simulator: run.simulator, settings: run.settings,
    execution: run.execution, feedback_source: feedback.source, feedback_sha256: await digest(feedbackBody)};
  const result = await request('/api/v1/engines/ltm-narrative/generate', {
    method: 'POST', headers: {Authentication: key, 'content-type': 'application/json'},
    body: JSON.stringify({prompt, feedbackContent: feedback.content, behaviorContent: JSON.stringify(run.series),
      backgroundKnowledge: 'Source of the supplied behavior and feedback: ' + JSON.stringify(provenance)})
  });
  if (!result.ok) throw Error('LTM_NARRATIVE_HTTP_FAILURE');
  const generated = await result.json();
  const diagnostic = diagnoseNarrative(generated, feedback.content);
  if (generated?.success !== true || !diagnostic.valid)
    throw Error('LTM_NARRATIVE_INVALID_RESULT', {cause: {...diagnostic, engineSuccess: generated?.success === true}});
  return {run_id: runId, run_sha256: runHash, feedback_sha256: provenance.feedback_sha256, prompt,
    output: generated.output, feedbackLoops: generated.feedbackLoops, assessment};
}

export function narrativeAssessment(content,time,evidence) {
  return {dominance:assessDominance(content,time,evidence),prose:'not_semantically_verified'};
}

export async function assessRunFeedback(run, feedback, readEvidence) {
  if (run.simulator?.source!=='server') return narrativeAssessment(feedback.content,run.series.time);
  const body=await readEvidence();
  if (!body || await digest(body)!==feedback.source.evidence_sha256) throw Error('NATIVE_EVIDENCE_HASH_MISMATCH');
  const evidence=JSON.parse(body);
  if (evidence.run_id!==feedback.run_id || evidence.run_sha256!==feedback.run_sha256 ||
      evidence.model_sha256!==run.model_sha256 || evidence.revision!==run.revision ||
      evidence.source.name!=='pysimlin' || evidence.source.version!=='0.8.5') throw Error('NATIVE_EVIDENCE_IDENTITY_MISMATCH');
  return narrativeAssessment(feedback.content,run.series.time,evidence);
}
