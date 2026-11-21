import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,rmSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectOriginalSources,ORIGINAL_FILES,ORIGINAL_AGENTS} from './original-gate.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
function fixture(fn){
 const folder=mkdtempSync(join(tmpdir(),'buffalo-original-gate-'));
 try{
  for(const path of ORIGINAL_FILES){
   const dest=join(folder,path);
   mkdirSync(dirname(dest),{recursive:true});
   copyFileSync(join(root,path),dest);
  }
  return fn(folder);
 }finally{rmSync(folder,{recursive:true,force:true})}
}
function mutate(folder,path,replace){
 const file=join(folder,path),s=readFileSync(file,'utf8');
 const next=replace(s);
 assert.notEqual(next,s,'fixture mutation must actually alter source');
 writeFileSync(file,next);
}
test('gate inspects original components without importing or invoking providers',()=>{
 const result=inspectOriginalSources(root);
 assert.equal(result.status,'PASS');
 assert.equal(result.mode,'SOURCE_READ_ONLY');
 assert.equal(result.agents.length,4);
 assert.deepEqual(result.agents.map(a=>a.id),['merlin','socrates','themis','athena_SFD']);
 assert.deepEqual(result.components.map(x=>x.path),[...ORIGINAL_FILES]);
 assert.match(result.source_sha256,/^[a-f0-9]{64}$/);
 assert.equal(result.components.every(x=>/^[a-f0-9]{64}$/.test(x.sha256)),true);
 assert.equal(ORIGINAL_AGENTS.length,4);
 assert.equal(inspectOriginalSources(root).source_sha256,result.source_sha256);
});
test('missing original agent fails closed, not a permissive skip',()=>fixture(folder=>{
 unlinkSync(join(folder,'agent/config/themis.md'));
 assert.throws(()=>inspectOriginalSources(folder));
}));
test('runner agent allowlist drift is rejected before any tool starts',()=>fixture(folder=>{
 mutate(folder,'scripts/run-one-native-agent-case.mjs',s=>s.replace("'athena_SFD'","'unknown_paid_agent'"));
 assert.throws(()=>inspectOriginalSources(folder),/RUNNER_AGENT_ALLOWLIST_DRIFT/);
}));
test('paid-run consent gate removal is rejected',()=>fixture(folder=>{
 mutate(folder,'scripts/run-one-native-agent-case.mjs',
  s=>s.replace("BUFFALO_PAID_RUN === 'I_ACCEPT_CLOUDFLARE_AI_COSTS'","true"));
 assert.throws(()=>inspectOriginalSources(folder),/RUNNER_PAID_GATE/);
}));
test('grader export removal blocks success and never scores invented results',()=>fixture(folder=>{
 mutate(folder,'evals/categories/policyImplementation.js',
  s=>s.replace('export const evaluate = async function(','const evaluate = async function('));
 assert.throws(()=>inspectOriginalSources(folder),/BENCHMARK_EVALUATE/);
}));
test('benign source edit changes fingerprint without pretending to run benchmark',()=>fixture(folder=>{
 const a=inspectOriginalSources(folder);
 mutate(folder,'agent/config/merlin.md',s=>s+'\n<!-- local fixture note -->\n');
 const b=inspectOriginalSources(folder);
 assert.notEqual(b.source_sha256,a.source_sha256);
 assert.equal(b.mode,'SOURCE_READ_ONLY');
}));
