/** GitHub Actions offline smoke: no network, LLM, PySD, or access to secrets. */
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { assertTaskId, OFFLINE_KIND } from './contract.mjs';

const taskId = assertTaskId(process.env.BUFFALO_TASK_ID);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const result = {
  schema: 'BUFFALO_OFFLINE_RESULT_V1',
  task_id: taskId,
  kind: OFFLINE_KIND,
  outcome: 'SUCCEEDED',
  commit: process.env.GITHUB_SHA ?? 'local-unverified',
  workflow: 'buffalo-control-plane-offline.yml',
  // A fixed simulation-free result, deliberately not a claim of Merlin success.
  evidence: { kind: 'NO_PROVIDER_NO_SIMULATION', payload_sha256: sha256('buffalo-offline-echo-v1') }
};
const destination = process.env.BUFFALO_RESULT_PATH;
if (!destination) throw new Error('CONTROL_PLANE_RESULT_PATH_REQUIRED');
await writeFile(destination, JSON.stringify(result, null, 2) + '\n', {flag:'wx'});
console.log(JSON.stringify({task_id: taskId, outcome: result.outcome, result_sha256: sha256(JSON.stringify(result))}));
