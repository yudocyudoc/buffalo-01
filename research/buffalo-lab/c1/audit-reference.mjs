import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const root=new URL('../../../',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('./reference-manifest.json',import.meta.url)));
const gitBlob=buf=>createHash('sha1').update('blob '+buf.length+'\0').update(buf).digest('hex');
for(const f of manifest.files){
 const buf=readFileSync(new URL(f.path,root));
 assert.equal(gitBlob(buf),f.runtime,'Reference drift: '+f.path);
}
const archive=readFileSync(new URL('evals/results/leaderboard_discussion_full_results.json.gz',root));
const parsed=JSON.parse(gunzipSync(archive));
assert(Array.isArray(parsed.results),'Unexpected published archive shape');
const rows=parsed.results.filter(r=>r.category==='feedbackExplanation');
assert(rows.length>0,'No feedbackExplanation rows');
const groups=new Map(),provenance=new Set(),rowKeys=new Set();
for(const r of rows){
 for(const k of Object.keys(r))rowKeys.add(k);
 const generation=r.generation??'v1';
 const name=r.engineConfigName;
 assert.equal(typeof name,'string');
 const key=JSON.stringify([generation,name]);
 if(!groups.has(key))groups.set(key,{generation,engineConfigName:name,rows:0,passed:0,failed:0,unscored:0,expectationCounts:[],engineNames:[],requestedModels:[],costModels:[]});
 const g=groups.get(key);g.rows++;
 if(r.pass===true)g.passed++;else if(r.pass===false)g.failed++;else g.unscored++;
 if(Array.isArray(r.testParams?.expectations))g.expectationCounts.push(r.testParams.expectations.length);
 if(typeof r.engine==='string')g.engineNames.push(r.engine);
 for(const candidate of [r.engineConfig?.additionalParameters?.underlyingModel,r.testParams?.additionalParameters?.underlyingModel,r.additionalParameters?.underlyingModel])
  if(typeof candidate==='string')g.requestedModels.push(candidate);
 if(r.cost?.byModel&&typeof r.cost.byModel==='object')g.costModels.push(...Object.keys(r.cost.byModel));
 for(const k of Object.keys(r))if(/model|judge|engine|version|date|time|generation|commit|cost/i.test(k))provenance.add(k);
}
for(const g of groups.values())for(const k of ['engineNames','requestedModels','costModels'])g[k]=[...new Set(g[k])].sort();
const result={source:manifest.upstream,archive_git_blob:gitBlob(archive),archive_sha256:createHash('sha256').update(archive).digest('hex'),
 totalArchiveRows:parsed.results.length,feedbackRows:rows.length,rowKeys:[...rowKeys].sort(),provenanceKeys:[...provenance].sort(),
 groups:[...groups.values()].sort((a,b)=>a.generation.localeCompare(b.generation)||a.engineConfigName.localeCompare(b.engineConfigName)),
 caveat:'Surviving published rows, not all attempts; requested and cost model fields do not establish exact provider versions or judge identities.'};
writeFileSync(process.argv[2]??'c1-leaderboard-inventory.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
