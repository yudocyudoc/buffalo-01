/**
 * GitHub source-proof lab: least-privilege, read-only transport.
 * Credential comes ONLY from dedicated Worker secret GITHUB_SOURCE_READ_TOKEN.
 * Never use the production GITHUB_FINE_GRAINED_TOKEN, never forward caller auth.
 */
export const SOURCE_READ_SECRET='GITHUB_SOURCE_READ_TOKEN';
const API='https://api.github.com';
const PATH_KIND=new Map([
 ['REPO_WORKFLOW','/repos/yudocyudoc/buffalo-01/actions/workflows/buffalo-full-source-proof.yml'],
 ['REPO_RUN','/repos/yudocyudoc/buffalo-01/actions/runs/44976002057'],
 ['REPO_ARTIFACTS','/repos/yudocyudoc/buffalo-01/actions/runs/44976002057/artifacts?per_page=100'],
 ['REPO_ZIP','/repos/yudocyudoc/buffalo-01/actions/artifacts/14735612574/zip']
]);
const VALID_PATHS=new Map([...PATH_KIND].map(([kind,path])=>[path,kind]));
const REQUEST_HEADERS={
 accept:'application/vnd.github+json',
 'x-github-api-version':'2022-11-28',
 'user-agent':'buffalo-source-proof-auth-lab'
};
const REDIRECT_HOSTS=new Set(['pipelines.actions.githubusercontent.com','objects.githubusercontent.com']);
const validRedirectHost=h=>REDIRECT_HOSTS.has(h)||
 /^[a-z0-9-]+\.actions\.githubusercontent\.com$/.test(h)||
 /^productionresultssa[0-9]+\.blob\.core\.windows\.net$/.test(h);
const fail=code=>{throw Error('SOURCE_AUTH_LAB_'+code)};
function validateUrl(url){
 const parsed=new URL(url);
 if(parsed.origin!==API||parsed.username||parsed.password||parsed.hash||
  !VALID_PATHS.has(parsed.pathname+parsed.search))fail('GITHUB_URL_DENIED');
 return {url:parsed.href,kind:VALID_PATHS.get(parsed.pathname+parsed.search)};
}
const defaultRequest=(url,options)=>fetch(url,options);
const rateNumber=(s,max)=>{
 if(s===null||!/^[0-9]{1,12}$/.test(s))return null;
 const n=Number(s);return Number.isSafeInteger(n)&&n>=0&&n<=max?n:null;
};
const meta=(res,kind)=>({
 stage:kind,
 http_status:Number.isInteger(res?.status)?res.status:null,
 rate_remaining:rateNumber(res?.headers?.get('x-ratelimit-remaining')??null,100000),
 rate_limit:rateNumber(res?.headers?.get('x-ratelimit-limit')??null,100000)
});
/** This transport never accepts caller-supplied URLs beyond exactly four endpoints.
 * The GitHub archive endpoint may return 302 to a short-lived signed download URL:
 * follow it with NO Authorization and no caller-supplied headers. */
export function createSourceReadTransport(token,requestFn=defaultRequest,onObservation=()=>{}){
 if(typeof token!=='string'||token.trim().length<20||token!==token.trim())
  fail('SOURCE_READ_SECRET_MISSING');
 return async (url,init)=>{
  const {url:exact,kind}=validateUrl(url);
  if(init?.method!=='GET'||init?.body!==undefined)fail('GITHUB_METHOD_DENIED');
  const response=await requestFn(exact,{
   method:'GET',redirect:'manual',
   headers:{...REQUEST_HEADERS,authorization:'Bearer '+token}
  });
  onObservation(meta(response,kind));
  if(response?.status===301||response?.status===302||
     response?.status===303||response?.status===307||response?.status===308){
   if(kind!=='REPO_ZIP'||response.status!==302)fail('UNEXPECTED_REDIRECT');
   const location=response.headers?.get('location');
   if(!location)fail('MISSING_ARCHIVE_LOCATION');
   const redirect=new URL(location);
   if(redirect.protocol!=='https:'||redirect.username||redirect.password||
      redirect.port||redirect.hash||!validRedirectHost(redirect.hostname))
    fail('ARCHIVE_REDIRECT_DENIED');
   // Deliberately zero authorization headers: the signed URL itself is temporary.
   const bytes=await requestFn(redirect.href,{
    method:'GET',redirect:'manual',
    headers:{accept:'application/octet-stream'}
   });
   onObservation(meta(bytes,'SIGNED_ZIP_DOWNLOAD'));
   if(bytes?.status>=300&&bytes.status<400)fail('SECOND_REDIRECT_DENIED');
   return bytes;
  }
  return response;
 };
}
export async function workflowReadPreflight(token,requestFn=defaultRequest){
 const audit=[];
 try{
  const transport=createSourceReadTransport(token,requestFn,x=>audit.push(x));
  const url=API+PATH_KIND.get('REPO_WORKFLOW');
  const response=await transport(url,{method:'GET'});
  if(!response?.ok)return{ready:false,status:'HTTP_'+String(response?.status??'UNKNOWN'),
   checks:audit};
  const data=await response.json();
  const ready=data?.id===426442743&&
   data?.path==='.github/workflows/buffalo-full-source-proof.yml';
  return{ready,status:ready?'READY':'WORKFLOW_IDENTITY_MISMATCH',checks:audit};
 }catch(e){
  const message=String(e?.message??'');
  const category=/^SOURCE_AUTH_LAB_[A-Z0-9_]{1,60}$/.test(message)?message:
   e?.name==='AbortError'?'FETCH_ABORT':e instanceof TypeError?'NETWORK_TYPE_ERROR':
   'PREFLIGHT_ERROR';
  return{ready:false,status:category,checks:audit};
 }
}
