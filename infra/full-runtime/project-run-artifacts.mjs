import {readProjectBody} from './project.mjs';
import {RUN_ID, storedRun} from './project-runs.mjs';
import {digest} from './provider-wire.mjs';
import {validFeedback, validFeedbackSource, validNarrative} from './run-narrative.mjs';

const empty = status => new Response(null, {status});

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
  if (value?.run_id !== runId || value.run_sha256 !== await digest(run.body)) return empty(409);
  if (narrativeId === undefined) {
    if (!validFeedbackSource(value.source) || !validFeedback(value.content, JSON.parse(run.body).series.time)) return empty(422);
  } else {
    const feedback = lookup('feedback');
    if (!feedback) return empty(404);
    if (value.feedback_sha256 !== await digest(feedback.body)) return empty(409);
    if (typeof value.prompt !== 'string' || !value.prompt.trim() ||
        !validNarrative(value, JSON.parse(feedback.body).content)) return empty(422);
  }
  // Both parent records are immutable. Only the same-ID insert needs serialization.
  return storage.transactionSync(() => {
    const existing = lookup(id);
    if (existing) return empty(existing.body === body ? 204 : 409);
    sql.exec('INSERT INTO run_artifacts(run_id,artifact_id,body) VALUES (?,?,?)', runId, id, body);
    return empty(201);
  });
}
