// C1.2a: fixed historical sample, no judge/provider calls.
// Selection by route and overlapping model family, never by pass/fail.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {groups} from '../../../evals/categories/feedbackExplanation.js';
const root=new URL('../../../',import.meta.url);
const dest=process.argv[2]??'c1-review';
mkdirSync(dest,{recursive:true});
const archive=readFileSync(new URL('evals/results/leaderboard_discussion_full_results.json.gz',root));
const digest=x=>createHash('sha256').update(x).digest('hex');
assert.equal(digest(archive),'700566fb90adf39eeb3a9f7807a19081e94f7711c54d32822892f54be51f83cd');
const rows=JSON.parse(gunzipSync(archive)).results;
const cases=[
 ['bassDiffusion','Bass diffusion dynamics explanation'],
 ['inventoryWorkforce','Inventory workforce dynamics explanation'],
 ['maibab','Maibab predator prey and food dynamics explanation']
];
const configs=['seldon-gemini-3.7-flash','merlin-discuss-gemini-3.7-flash-high','seldon-claude-opus-5','merlin-discuss-opus-5'];
const tests=Object.values(groups).flat();
const pack={protocol:'C1.2a-historical-v1',scope:'Historical final text, original reference feedback only; not native trajectories or provider equivalence.',items:[],references:{}};
const key={protocol:pack.protocol,archive_sha256:digest(archive),items:[]};
for(const [caseId,caseName] of cases){
 const test=tests.find(t=>t.name===caseName);assert(test);
 const fixture=JSON.parse(readFileSync(new URL('evals/categories/feedbackExplanationData/'+caseId+'.json',root)));
 pack.references[caseId]={question:test.prompt,model:fixture.model,feedback:fixture.feedback,expected_facts:test.expectations.map((text,i)=>({id:'E'+(i+1),text}))};
 for(const engineConfigName of configs){
  const matches=rows.filter(r=>r.generation==='v2'&&r.category==='feedbackExplanation'&&r.engineConfigName===engineConfigName&&
    JSON.stringify(r.testParams?.expectations)===JSON.stringify(test.expectations));
  assert.equal(matches.length,1,caseId+' '+engineConfigName);
  const row=matches[0];
  const originalText=row.generatedResponse?.output?.textContent;
  // Empty answers remain in sample. Do not substitute a more attractive row.
  const text=typeof originalText==='string'?originalText:null;
  const id='H-'+digest(Buffer.from('C1.2a|'+caseId+'|'+engineConfigName)).slice(0,12);
  pack.items.push({id,caseId,text});
  key.items.push({id,caseId,engineConfigName,archive_name:row.name,pass:row.pass,failures:row.failures,
   engineConfig:row.engineConfig,cost:row.cost??null,text_sha256:text===null?null:digest(Buffer.from(text)),
   archived_fixture_match:{
    model:row.testParams?.currentModel===undefined?null:JSON.stringify(row.testParams.currentModel)===JSON.stringify(fixture.model),
    feedback:row.testParams?.additionalParameters?.feedbackContent===undefined?null:JSON.stringify(row.testParams.additionalParameters.feedbackContent)===JSON.stringify(fixture.feedback)
   }});
 }
}
assert.equal(pack.items.length,12);
pack.items.sort((a,b)=>a.id.localeCompare(b.id));
key.items.sort((a,b)=>a.id.localeCompare(b.id));
const template={protocol:pack.protocol,reviewer:'',items:pack.items.map(item=>({id:item.id,
 coverage:pack.references[item.caseId].expected_facts.map(f=>({id:f.id,verdict:null,quote:null,reason:null})),
 claims:[],explanation:{mechanism:null,temporal:null,uncertainty:null,reason:null},completed:false}))};
writeFileSync(join(dest,'blind-review.json'),JSON.stringify(pack,null,2)+'\n');
writeFileSync(join(dest,'annotation-template.json'),JSON.stringify(template,null,2)+'\n');
writeFileSync(join(dest,'review-key.json'),JSON.stringify(key,null,2)+'\n');
console.log(JSON.stringify({protocol:pack.protocol,rows:pack.items.length,nonempty:pack.items.filter(x=>x.text?.trim()).length,
 cases:cases.map(x=>x[0]),configurations:configs.length,live_provider_calls:0}));
