import {readProjectBody} from './project.mjs';
import {RUN_ID, storedRun} from './project-runs.mjs';
import {digest} from './provider-wire.mjs';
import {narrativeAssessment, validFeedback, validFeedbackSource, validNarrative} from './run-narrative.mjs';

const empty = status => new Response(null, {status});

// Compare JSON objects by field and arrays in order. The expected shape is server-generated.
function matchesAssessment(actual, expected) {
  if (actual === expected) return true;
  if (!actual || !expected || typeof actual !== 'object' || typeof expected !== 'object' ||
      Array.isArray(actual) !== Array.isArray(expected)) return false;
  const keys = Object.keys(expected);
  return keys.length === Object.keys(actual).length &&
    keys.every(k => Object.hasOwn(actual, k) && matchesAssessment(actual[k], expected[k]));
}

export async function projectRunArtifact(request, storage, runId, narrativeId) {
  if (!RUN_ID.test(runId) || (narrativeId !== undefined && !RUN_ID.test(narrativeId))) return empty(404);
  if (!['GET', 'PUT'].includes(request.method)) return empty(405);
  const sql = storage.sql;
  const run = storedRun(sql, runId);
  if (!run) return empty(404);
  sql.exec('CREATE TABLE IF NOT EXISTS run_artifacts (run_id TEXT NOT NULL, artifact_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(run_id,artifact_id))');
  const lookup = id => sql.exec('SELECT body FROM run_artifacts WHERE run_id=? AND artifact_id=?', runId, id).toArray()[0];
  const id = narrativeId ?? 'feedback';
  if (request.method === 'GET') {
    const row = lookup(id);
    return row ? new Response(row.body, {headers: {'content-type': 'application/json', 'cache-control': 'no-store'}}) : empty(404);
  }
  const {value, body, error} = await readProjectBody(request, 512 * 1024);
  if (error) return empty(error);
  // An identical replay of a historical immutable artifact is still an acknowledgement.
  if (lookup(id)?.body === body) return empty(204);
  if (value?.run_id !== runId || value.run_sha256 !== await digest(run.body)) return empty(409);
  if (narrativeId === undefined) {
    if (!validFeedbackSource(value.source) || !validFeedback(value.content, JSON.parse(run.body).series.time)) return empty(422);
  } else {
    const feedback = lookup('feedback');
    if (!feedback) return empty(404);
    if (value.feedback_sha256 !== await digest(feedback.body)) return empty(409);
    const {content} = JSON.parse(feedback.body);
    if (typeof value.prompt !== 'string' || !value.prompt.trim() || !validNarrative(value, content)) return empty(422);
    // New records must carry the exact server-derived assessment. Only the
    // byte-identical historical acknowledgement above can bypass this check.
    const assessment = narrativeAssessment(content, JSON.parse(run.body).series.time);
    if (assessment.dominance.status === 'contradicted' ||
        !Object.hasOwn(value, 'assessment') || !matchesAssessment(value.assessment, assessment)) return empty(422);
  }
  // Both parent records are immutable. Only the same-ID insert needs serialization.
  return storage.transactionSync(() => {
    const existing = lookup(id);
    if (existing) return empty(existing.body === body ? 204 : 409);
    sql.exec('INSERT INTO run_artifacts(run_id,artifact_id,body) VALUES (?,?,?)', runId, id, body);
    return empty(201);
  });
}
