/**
 * Diagnostic only. One GitHub GET from a dedicated Cloudflare Worker.
 * No GitHub token, no verification dispatch, no source attestation.
 * Records one bounded outcome in the existing isolated lab receipt table.
 */
export const DIAGNOSTIC_ID='buffalo-source-workflow-first-get-diagnostic-v1';
export const WORKFLOW_URL='https://api.github.com/repos/yudocyudoc/buffalo-01/actions/workflows/buffalo-full-source-proof.yml';
const EXPECTED_ID=426442743;
const EXPECTED_PATH='.github/workflows/buffalo-full-source-proof.yml';
const outcomeCode=error=>{
 const message=String(error?.message??'');
 if(error instanceof TypeError)return 'NETWORK_TYPE_ERROR';
 if(error?.name==='AbortError')return 'FETCH_ABORT';
 return /^DIAGNOSTIC_[A-Z0-9_]{1,60}$/.test(message)?message:'UNKNOWN_ERROR';
};
export async function probeWorkflow(db,requestFn=(url,opts)=>fetch(url,opts)){
 if(!db?.prepare)throw Error('D1_BINDING_REQUIRED');
 const claimed=await db.prepare(
  "INSERT INTO buffalo_full_source_lab_receipts(test_id,status) VALUES(?,'RUNNING') ON CONFLICT(test_id) DO NOTHING"
 ).bind(DIAGNOSTIC_ID).run();
 if(claimed.meta?.changes!==1)return {status:'ALREADY_STARTED',run_again:false};
 let result={status:'FAIL',code:'NOT_STARTED',http_status:null,workflow_identity:false,
  request_count:0,transport:'PUBLIC_GITHUB_GET_WITHOUT_AUTH'};
 try{
  result.request_count=1;
  const response=await requestFn(WORKFLOW_URL,{method:'GET',headers:{
    accept:'application/vnd.github+json',
    'x-github-api-version':'2022-11-28',
    'user-agent':'buffalo-source-diagnostic'
   },redirect:'manual'});
  if(!response||!Number.isInteger(response.status))
   throw Error('DIAGNOSTIC_MISSING_RESPONSE');
  result.http_status=response.status;
  result.code='HTTP_'+String(response.status);
  if(response.status===200){
   const data=await response.json();
   result.workflow_identity=data?.id===EXPECTED_ID&&data?.path===EXPECTED_PATH;
   result.code=result.workflow_identity?'GITHUB_WORKFLOW_OK':'GITHUB_WORKFLOW_IDENTITY_MISMATCH';
   result.status=result.workflow_identity?'PASS':'FAIL';
  }
 }catch(error){
  result.code=outcomeCode(error);
 }
 const updated=await db.prepare(
  "UPDATE buffalo_full_source_lab_receipts SET status=?,failure_stage=?,failure_code=?,detail_json=?,finished_at=CURRENT_TIMESTAMP WHERE test_id=? AND status='RUNNING'"
 ).bind(result.status,result.status==='PASS'?null:'FIRST_GITHUB_WORKFLOW_GET',
  result.status==='PASS'?null:result.code,JSON.stringify(result),DIAGNOSTIC_ID).run();
 if(updated.meta?.changes!==1)throw Error('DIAGNOSTIC_RECEIPT_WRITE_FAILED');
 return {...result,run_again:false};
}
export default {
 async fetch(request,env){
  if(request.method!=='POST'||new URL(request.url).pathname!=='/v1/lab/github-first-get')
   return new Response('Not Found',{status:404});
  if(!request.headers.get('Cf-Access-Jwt-Assertion'))
   return Response.json({error:'ACCESS_REQUIRED'},{status:403});
  if(request.headers.get('content-type')?.split(';')[0]?.trim()!=='application/json')
   return Response.json({error:'CONTENT_TYPE_DENIED'},{status:415});
  if(Number(request.headers.get('content-length')??0)>96)
   return Response.json({error:'BODY_TOO_LARGE'},{status:413});
  let body;try{body=await request.text()}catch{return Response.json({error:'INVALID_BODY'},{status:400})}
  if(body!=='{"action":"DIAGNOSE_GITHUB_WORKFLOW_GET_V1"}')
   return Response.json({error:'INVALID_INPUT'},{status:400});
  try{
   const result=await probeWorkflow(env.DB);
   return Response.json(result,{status:result.status==='ALREADY_STARTED'?409:200,
    headers:{'cache-control':'no-store'}});
  }catch{
   return Response.json({error:'DIAGNOSTIC_UNAVAILABLE'},{status:500});
  }
 },
 async scheduled(){}
};
