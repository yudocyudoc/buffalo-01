import {inflateRawSync} from 'node:zlib';
/** GitHub API: one allowlisted offline workflow; verify run and stored ZIP evidence. */
import {assertSha256,assertTaskId,OFFLINE_KIND,OFFLINE_WORKFLOW} from '../../scripts/control-plane/contract.mjs';
export const REPO='yudocyudoc/buffalo-01';
const PATH='.github/workflows/'+OFFLINE_WORKFLOW;
const API='https://api.github.com/repos/'+REPO,VERSION='2022-11-28';
const SHA=/^[0-9a-f]{40}$/i;
const sha256=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
 .map(x=>x.toString(16).padStart(2,'0')).join('');
const parseJson=async res=>{try{return await res.json()}catch{throw Error('GITHUB_INVALID_JSON')}};
export class GitHubOffline{
 constructor(token,transport=fetch){if(!token||typeof token!=='string')throw Error('GITHUB_TOKEN_NOT_CONFIGURED');this.token=token;this.transport=transport}
 async get(path,options={}){
  if(!path.startsWith('/')||path.includes('..')||path.includes('://'))throw Error('GITHUB_PATH_DENIED');
  const response=await this.transport(API+path,{method:options.method??'GET',
   headers:{authorization:'Bearer '+this.token,accept:'application/vnd.github+json',
    'x-github-api-version':VERSION,'user-agent':'buffalo-control-plane-offline-v1',
    ...(options.body?{'content-type':'application/json'}:{})},
   ...(options.body?{body:JSON.stringify(options.body)}:{}),redirect:'follow'});
  if(options.raw){
   if(!response.ok)throw Error('GITHUB_ARTIFACT_HTTP_'+response.status);
   const length=Number(response.headers.get('content-length')??0);
   if(length>65536)throw Error('GITHUB_ARTIFACT_TOO_LARGE');
   const bytes=await response.arrayBuffer();
   if(bytes.byteLength>65536)throw Error('GITHUB_ARTIFACT_TOO_LARGE');
   return bytes;
  }
  if(options.method==='POST'&&response.status===204)return null;
  if(!response.ok)throw Error('GITHUB_HTTP_'+response.status);
  return parseJson(response);
 }
 async prepare(){
  const [workflow,commit]=await Promise.all([
   this.get('/actions/workflows/'+OFFLINE_WORKFLOW),this.get('/commits/main')]);
  if(workflow.path!==PATH||!Number.isSafeInteger(workflow.id))throw Error('GITHUB_WORKFLOW_NOT_ALLOWLISTED');
  if(typeof commit.sha!=='string'||!SHA.test(commit.sha))throw Error('GITHUB_BAD_MAIN_SHA');
  return {workflow_id:workflow.id,head_sha:commit.sha.toLowerCase()};
 }
 async dispatch(payload){
  if(!payload||payload.ref!=='main'||Object.keys(payload.inputs??{}).sort().join(',')!=='input_sha256,task_id')
   throw Error('GITHUB_DISPATCH_PAYLOAD_DENIED');
  assertTaskId(payload.inputs.task_id);assertSha256(payload.inputs.input_sha256);
  await this.get('/actions/workflows/'+OFFLINE_WORKFLOW+'/dispatches',{method:'POST',body:payload});
 }
 async findRuns(task){
  const results=[];
  for(let page=1;page<=3;page++){
   const created=encodeURIComponent('>='+String(task.dispatch_started_at).slice(0,10));
   const query='?event=workflow_dispatch&branch=main&head_sha='+task.dispatch_head_sha+
    '&created='+created+'&per_page=100&page='+page;
   const found=await this.get('/actions/workflows/'+OFFLINE_WORKFLOW+'/runs'+query);
   if(!Array.isArray(found.workflow_runs))throw Error('GITHUB_RUNS_NOT_ARRAY');
   results.push(...found.workflow_runs.filter(run=>run.display_title==='Buffalo offline echo '+task.task_id));
   if(found.workflow_runs.length<100)break;
   if(page===3)throw Error('GITHUB_RUN_SEARCH_TRUNCATED');
  }
  return results;
 }
 async getRun(id){
  if(!Number.isSafeInteger(id)||id<1)throw Error('GITHUB_BAD_RUN_ID');
  return this.get('/actions/runs/'+id);
 }
 checkRun(task,run){
  if(!run||!Number.isSafeInteger(run.id)||!Number.isSafeInteger(run.workflow_id)||
   run.workflow_id!==task.github_workflow_id||run.event!=='workflow_dispatch'||
   run.head_branch!=='main'||run.head_sha?.toLowerCase()!==task.dispatch_head_sha||
   run.display_title!=='Buffalo offline echo '+task.task_id||
   (run.repository?.full_name&&run.repository.full_name!==REPO)||
   (run.head_repository?.full_name&&run.head_repository.full_name!==REPO)||
   (task.github_run_id!==null&&task.github_run_id!==undefined&&run.id!==task.github_run_id))
   throw Error('GITHUB_RUN_IDENTITY_MISMATCH');
  const recorded=Date.parse(task.dispatch_started_at??''),started=Date.parse(run.created_at??'');
  if(!Number.isFinite(recorded)||!Number.isFinite(started)||started<recorded-30000||run.run_attempt!==1)
   throw Error('GITHUB_RUN_ORIGIN_NOT_PROVEN');
  if(!['queued','in_progress','completed','requested','waiting','pending'].includes(run.status))
   throw Error('GITHUB_BAD_RUN_STATUS');
  return true;
 }
 async getVerifiedResult(task,run){
  const list=await this.get('/actions/runs/'+run.id+'/artifacts?per_page=100');
  if(!Array.isArray(list.artifacts)||list.total_count!==1||list.artifacts.length!==1)
   throw Error('GITHUB_ARTIFACT_COUNT_MISMATCH');
  const a=list.artifacts[0];
  if(a.name!=='buffalo-offline-'+task.task_id||a.expired||!Number.isSafeInteger(a.id)||
   !Number.isSafeInteger(a.size_in_bytes)||a.size_in_bytes>65536)
   throw Error('GITHUB_ARTIFACT_IDENTITY_MISMATCH');
  const bytes=await this.get('/actions/artifacts/'+a.id+'/zip',{raw:true});
  const rawHash=await sha256(bytes);
  if(a.digest!=='sha256:'+rawHash)throw Error('GITHUB_ARTIFACT_DIGEST_MISMATCH');
  const body=extractSingleMemberZip(bytes,'buffalo-offline-result.json');
  const resultSha=await sha256(body);
  const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));
  verifyOfflineResult(task,run,result);
  return {artifact_id:a.id,result_sha256:resultSha};
 }
}
const readName=(b,start,n)=>new TextDecoder('utf-8',{fatal:true}).decode(b.subarray(start,start+n));
function crc32(b){let c=0xffffffff;for(const x of b){c^=x;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}return (c^0xffffffff)>>>0}
/** One ZIP member only; supports GitHub's stored or DEFLATE method. Validate central index and CRC32. */
export function extractSingleMemberZip(buffer,expectedName){
 const b=new Uint8Array(buffer),v=new DataView(buffer);
 if(b.length<98||b.length>65536)throw Error('ZIP_SIZE_INVALID');
 let eocd=-1;
 for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--){
  if(v.getUint32(i,true)===0x06054b50){eocd=i;break}
 }
 if(eocd<0||eocd+22+v.getUint16(eocd+20,true)!==b.length||
  v.getUint16(eocd+8,true)!==1||v.getUint16(eocd+10,true)!==1||
  v.getUint16(eocd+4,true)!==0||v.getUint16(eocd+6,true)!==0)throw Error('ZIP_END_INVALID');
 const size=v.getUint32(eocd+12,true),p=v.getUint32(eocd+16,true);
 if(p+size!==eocd||p+46>b.length||v.getUint32(p,true)!==0x02014b50)throw Error('ZIP_CENTRAL_INVALID');
 const flag=v.getUint16(p+8,true),method=v.getUint16(p+10,true);
 const checksum=v.getUint32(p+16,true),compressed=v.getUint32(p+20,true),uncompressed=v.getUint32(p+24,true);
 const nameLen=v.getUint16(p+28,true),extra=v.getUint16(p+30,true),comment=v.getUint16(p+32,true);
 if(flag&1||![0,8].includes(method)||uncompressed>16384||compressed>65536||
  p+46+nameLen+extra+comment!==eocd||readName(b,p+46,nameLen)!==expectedName)
  throw Error('ZIP_MEMBER_INVALID');
 const local=v.getUint32(p+42,true);
 if(local+30>b.length||v.getUint32(local,true)!==0x04034b50||
  v.getUint16(local+8,true)!==method||(v.getUint16(local+6,true)&1))
  throw Error('ZIP_LOCAL_INVALID');
 const localName=v.getUint16(local+26,true),localExtra=v.getUint16(local+28,true);
 const start=local+30+localName+localExtra;
 if(readName(b,local+30,localName)!==expectedName||start+compressed>p)throw Error('ZIP_LOCAL_MEMBER_INVALID');
 const wire=b.subarray(start,start+compressed);
 const content=method===0?wire:new Uint8Array(inflateRawSync(wire,{maxOutputLength:16384}));
 if(content.length!==uncompressed||crc32(content)!==checksum)throw Error('ZIP_CRC_INVALID');
 return content;
}
export function verifyOfflineResult(task,run,result){
 const must=['schema','task_id','input_sha256','kind','outcome','commit','workflow','evidence'];
 if(!result||typeof result!=='object'||Array.isArray(result)||
  Object.keys(result).sort().join(',')!==must.sort().join(',')||
  result.schema!=='BUFFALO_OFFLINE_RESULT_V1'||result.task_id!==task.task_id||
  result.input_sha256!==task.input_sha256||result.kind!==OFFLINE_KIND||
  result.outcome!=='SUCCEEDED'||result.commit!==run.head_sha||
  result.workflow!==OFFLINE_WORKFLOW||
  Object.keys(result.evidence??{}).sort().join(',')!=='kind,payload_sha256'||
  result.evidence.kind!=='NO_PROVIDER_NO_SIMULATION'||
  result.evidence.payload_sha256!=='f906349fffd099463ac34960772d8cc40a3f6f82c821873da82cadb66f74533e')
  throw Error('GITHUB_RESULT_MISMATCH');
 return result;
}

/** Deprecated test alias, both ZIP storage methods validated. */
export const extractSingleStoredZip=extractSingleMemberZip;
