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
  let previousEnd = -Infinity;
  for (const p of content.dominantLoopsByPeriod) {
    if (!grid.has(p?.startTime) || !grid.has(p.endTime) || p.endTime < p.startTime || p.startTime < previousEnd ||
        !Array.isArray(p.dominantLoops) || !p.dominantLoops.length ||
        new Set(p.dominantLoops).size !== p.dominantLoops.length || !p.dominantLoops.every(id => ids.has(id))) return false;
    previousEnd = p.endTime;
  }
  return true;
}

// Checks output shape and loop identifiers only. Arbitrary text may contradict the evidence.
export function validNarrative(result, feedback) {
  const loops = result?.feedbackLoops;
  if (!text(result?.output?.textContent) || !Array.isArray(loops)) return false;
  const expected = new Set(feedback.feedbackLoops.map(loop => loop.identifier));
  return loops.length === expected.size && loops.every(loop =>
    text(loop?.name) && text(loop.description) && expected.delete(loop.identifier));
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
  const assessment = narrativeAssessment(feedback.content, run.series.time);
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
  if (generated.success !== true || !validNarrative(generated, feedback.content)) throw Error('LTM_NARRATIVE_INVALID_RESULT');
  return {run_id: runId, run_sha256: runHash, feedback_sha256: provenance.feedback_sha256, prompt,
    output: generated.output, feedbackLoops: generated.feedbackLoops, assessment};
}

export function narrativeAssessment(content, time) {
  return {dominance: assessDominance(content, time), prose: 'not_semantically_verified'};
}
