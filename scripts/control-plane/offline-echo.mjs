/** GitHub Actions offline echo; no LLM, simulation or external network. */
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {assertTaskId,assertSha256,OFFLINE_KIND,OFFLINE_WORKFLOW} from './contract.mjs';
const taskId=assertTaskId(process.env.BUFFALO_TASK_ID);
const inputSha256=assertSha256(process.env.BUFFALO_INPUT_SHA256);
const sha256=x=>createHash('sha256').update(x).digest('hex');
const result={schema:'BUFFALO_OFFLINE_RESULT_V1',task_id:taskId,input_sha256:inputSha256,
 kind:OFFLINE_KIND,outcome:'SUCCEEDED',commit:process.env.GITHUB_SHA??'local-unverified',
 workflow:OFFLINE_WORKFLOW,evidence:{kind:'NO_PROVIDER_NO_SIMULATION',payload_sha256:sha256('buffalo-offline-echo-v1')}};
const destination=process.env.BUFFALO_RESULT_PATH;
if(!destination)throw Error('CONTROL_PLANE_RESULT_PATH_REQUIRED');
await writeFile(destination,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({task_id:taskId,outcome:result.outcome,result_sha256:sha256(JSON.stringify(result))}));
