/**
 * 3B-6 guarded private bridge predeployment inspection.
 * Read-only against Cloudflare. Does not log or materialize secret VALUES.
 * A passing check is configuration evidence, not an end-to-end handshake.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const ORIGIN='buffalo-private-origin-router-lab';
export const BRIDGE='buffalo-original-ws-bridge-lab';
export const HANDOFF='f9c4db4e-aa31-4b2a-921e-201a5a79fd37';
export const SOURCE='a8b1ad0c02d5c3367bd24962e8fd36d277a8135d';
export const MODEL='57fed6310be45c10c263aecb796eeb72f993b318c5bc770013ff35e014cb4f39';
export const IMAGE='sha256:9db33d0be768d4f70e3dfed21b87b0d048f9a5a63739b8301b324deab020ec1d';
export const DB='d1e23807-b076-4c36-8785-7b423fc41614';
const sorted=a=>[...a].sort();
const exact=(a,b)=>JSON.stringify(sorted(a??[]))===JSON.stringify(sorted(b));
const names=items=>(items??[]).map(x=>x?.name);
const expectedOrigin=['BUFFALO_ORIGIN_AUTH_KEY','BUFFALO_ORIGIN_UPGRADE_TOKEN'];
const expectedBridge=[...expectedOrigin,'BUFFALO_WS_LAB_BEARER'];
function fail(code){throw Error('STAGE3B6_PREBRIDGE_DENIED_'+code)}
export function assertSafePreBridge(x,account){
 if(!/^[a-f0-9]{32}$/.test(account??''))fail('ACCOUNT');
 if(x.apps?.length!==1||x.apps[0].name!=='buffalo-private-origin-lab'||
   x.apps[0].scheduling_policy!=='durable_object'||
   x.apps[0].health?.instances?.active!==0||
   x.apps[0].health?.instances?.starting!==0||x.usage?.instances!==0)fail('CONTAINER_STATE');
 if(x.originSub?.enabled!==false||x.originSub?.previews_enabled!==false||
    x.bridgeSub?.enabled!==false||x.bridgeSub?.previews_enabled!==false)fail('PUBLIC_INGRESS');
 if(!exact(names(x.originSecrets),expectedOrigin)||
    !exact(names(x.bridgeSecrets),expectedBridge))fail('SECRET_NAMES');
 const originBindings=x.originVersion?.bindings??[];
 if(!exact(originBindings.filter(b=>b.type==='secret_text').map(b=>b.name),expectedOrigin))
   fail('ORIGIN_SECRETS_NOT_ACTIVE');
 if(x.originVersion?.containers?.length!==1||
   x.originVersion.containers[0]?.images?.base!==
   'registry.cloudflare.com/'+account+'/buffalo-private-origin@'+IMAGE||
   x.originVersion.containers[0]?.class_name!=='BuffaloHandshakeContainer')fail('IMAGE_MAP');
 if(!originBindings.some(b=>b.name==='BUFFALO_ORIGIN_MODE'&&b.text==='HANDSHAKE_ONLY_NO_AGENT_PROCESS')||
    !originBindings.some(b=>b.name==='BUFFALO_ORIGIN_COMMIT_SHA'&&b.text===SOURCE)||
    !originBindings.some(b=>b.name==='BUFFALO_ORIGIN_MODEL_SHA256'&&b.text===MODEL))
   fail('ORIGIN_IDENTITY');
 const bridgeBindings=x.bridgeSettings?.bindings??[];
 if(!exact(names(bridgeBindings),['DB',...expectedBridge])||
    bridgeBindings.find(b=>b.name==='DB')?.database_id!==DB||
    !exact(bridgeBindings.filter(b=>b.type==='secret_text').map(b=>b.name),expectedBridge)||
    bridgeBindings.some(b=>b.type==='service'))fail('BRIDGE_BASELINE');
 if(x.proof?.length!==1||x.proof[0].proof_status!=='SOURCE_ATTESTED'||
    x.proof[0].commit_sha!==SOURCE||
    Number(x.proof[0].execution_allowed)!==0||
    x.handoff?.length!==1||x.handoff[0].handoff_id!==HANDOFF||
    x.handoff[0].commit_sha!==SOURCE||
    x.handoff[0].manifest_sha256!=='4d80f1f4ee8a75ba610943826ab3858c2019a79414e5aad249f3f3342f29aa0e'||
    Number(x.handoff[0].execution_allowed)!==0||
    Number(x.grants?.[0]?.n)!==0)fail('D1_PROVENANCE');
 return 'STAGE3B6_PRIVATE_BRIDGE_GATE_PASS_NO_CONTAINER_STARTED';
}
async function api(path,{method='GET',body}={}){
 const response=await fetch('https://api.cloudflare.com/client/v4'+path,{
  method,
  headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN,
   ...(body?{'Content-Type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{})
 });
 if(!response.ok)fail('CLOUDFLARE_HTTP_'+response.status);
 const data=await response.json();
 if(data.success!==true)fail('CLOUDFLARE_RESPONSE');
 return data.result;
}
async function activeVersion(base,worker){
 const r=await api(base+'/workers/scripts/'+worker+'/deployments');
 const dep=r.deployments?.[0];
 if(dep?.versions?.length!==1||dep.versions[0].percentage!==100)fail('ACTIVE_VERSION');
 return api(base+'/workers/workers/'+worker+'/versions/'+dep.versions[0].version_id);
}
export async function inspectPrivateBridge(){
 const account=process.env.CLOUDFLARE_ACCOUNT_ID;
 if(!process.env.CLOUDFLARE_API_TOKEN)fail('DEPLOY_TOKEN_MISSING');
 const base='/accounts/'+account;
 const [apps,usage,originSub,bridgeSub,originSecrets,bridgeSecrets,
  originVersion,bridgeSettings,d1]=await Promise.all([
   api(base+'/containers/applications'),api(base+'/containers/usage'),
   api(base+'/workers/scripts/'+ORIGIN+'/subdomain'),
   api(base+'/workers/scripts/'+BRIDGE+'/subdomain'),
   api(base+'/workers/scripts/'+ORIGIN+'/secrets'),
   api(base+'/workers/scripts/'+BRIDGE+'/secrets'),
   activeVersion(base,ORIGIN),
   api(base+'/workers/scripts/'+BRIDGE+'/settings'),
   api(base+'/d1/database/'+DB+'/query',{method:'POST',body:{batch:[
    {sql:'SELECT handoff_id,commit_sha,manifest_sha256,execution_allowed FROM buffalo_full_handoffs WHERE handoff_id=?',params:[HANDOFF]},
    {sql:'SELECT proof_status,commit_sha,execution_allowed FROM buffalo_full_source_attestations WHERE handoff_id=?',params:[HANDOFF]},
    {sql:'SELECT COUNT(*) AS n FROM buffalo_full_live_grants'}
   ]}})
  ]);
 const readback={apps,usage:usage.usage,originSub,bridgeSub,originSecrets,
  bridgeSecrets,originVersion,bridgeSettings,handoff:d1[0]?.results,
  proof:d1[1]?.results,grants:d1[2]?.results};
 return assertSafePreBridge(readback,account);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const cfg=JSON.parse(readFileSync('infra/buffalo-origin/wrangler.private-bridge.jsonc','utf8'));
  assert.equal(cfg.name,BRIDGE);
  assert.equal(cfg.vars.BUFFALO_LAB_HANDOFF_ID,HANDOFF);
  assert.equal(cfg.vars.BUFFALO_RUNTIME_COMMIT_SHA,SOURCE);
  assert.equal(cfg.workers_dev,false);
  assert.equal(cfg.preview_urls,false);
  assert.equal('routes' in cfg,false);
  assert.deepEqual(cfg.services,[{binding:'BUFFALO_ORIGIN',service:ORIGIN}]);
  console.log(await inspectPrivateBridge());
 }catch(e){
  console.error(String(e.message).replace(/[a-f0-9]{64}/g,'[digest]'));
  process.exitCode=1;
 }
}
