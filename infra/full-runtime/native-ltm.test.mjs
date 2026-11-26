import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {projectModel} from './project.mjs';
import {projectRuns} from './project-runs.mjs';
import {projectRunArtifact} from './project-run-artifacts.mjs';
import {projectNativeLtm} from './native-ltm.mjs';
import {openNativeLtmRun} from './native-ltm-client.mjs';

const runId='cbdb5c99-4dd0-42d5-8de3-c2c127f40248';
const time=[0,.5,1];
function sample() {
  return {specs:{startTime:0,endTime:1,dt:'1/2'},version:'0.8.5',mode:'exhaustive',
    implementation_sha256:'a'.repeat(64),xmile_sha256:'b'.repeat(64),
    series:{time,x:[1,2,3]},links:[{from:'x',to:'x',polarity:'+',raw:null}],
    loops:[{id:'b1',polarity:'B',cycle:['x'],partition:0,signed:[0,-1,-1]},
      {id:'b1',polarity:'B',cycle:['y'],partition:1,signed:[0,-1,-1]},
      {id:'u1',polarity:'U',cycle:['z'],partition:0,signed:[0,0,0]},
      {id:'u2',polarity:'U',cycle:['w'],partition:0,signed:[0,null,0]}],
    periods:[0,1].map(partition=>({partition,startTime:.5,endTime:1,dominantLoops:['b1']}))};
}

test('native evidence and client provenance survive reopening, retries and concurrent same-ID writes',async()=>{
  const db=new DatabaseSync(':memory:');
  const storage={sql:{exec(s,...p){const rows=db.prepare(s).all(...p);return {toArray:()=>rows};}},
    transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}};
  const request=(method='GET',value,headers)=>new Request('http://test/',{method,headers,body:value===undefined?undefined:JSON.stringify(value)});
  try {
    const model={variables:[],relationships:[],specs:{dt:.5,startTime:0,stopTime:1,timeUnits:'Year'}};
    const saved=await projectModel(request('PUT',model,{'if-none-match':'*'}),storage);
    const input={revision:1,model_sha256:saved.headers.get('x-buffalo-model-sha256')};
    const compute=(fn)=>projectNativeLtm(request('PUT',input),storage,runId,fn);
    const missing=()=>projectRuns(request(),storage,runId);
    assert.equal((await compute(()=>Response.json({...sample(),specs:{dt:1}}))).status,422);
    assert.equal((await missing()).status,404);
    db.exec("CREATE TRIGGER bad_write BEFORE INSERT ON simulation_runs BEGIN SELECT RAISE(ABORT,'interrupted'); END");
    await assert.rejects(compute(()=>Response.json(sample())),/interrupted/);
    db.exec('DROP TRIGGER bad_write');
    assert.equal((await projectNativeLtm(request(),storage,runId)).status,404);
    const concurrent=await Promise.all([1,2].map(()=>compute(()=>Response.json(sample()))));
    assert.deepEqual(concurrent.map(r=>r.status).sort(),[201,204]);
    assert.equal((await compute(()=>{throw Error('unexpected calculation');})).status,204);
    const get=path=>path.includes('/revisions/')?projectModel(request(),storage,1):
      path.endsWith('/feedback')?projectRunArtifact(request(),storage,runId):missing();
    const selected=await openNativeLtmRun(get,runId);
    assert.deepEqual(selected.model,model);
    const {feedbackContent}=await selected.clientRequest({type:'feedback_request',runIds:[runId]});
    assert.deepEqual(feedbackContent.dominantLoopsByPeriod.map(p=>p.dominantLoops),[['P0/B1'],['P1/B1']]);
    assert.equal(feedbackContent.feedbackLoops[0].links[0].activity,'unavailable');
    assert.equal(feedbackContent.feedbackLoops[2].activity,'zero_on_saved_grid');
    assert.equal(feedbackContent.feedbackLoops[3].activity,'incomplete');
    assert.equal((await projectRuns(request('PUT',selected.run),storage,crypto.randomUUID())).status,422);
  } finally {db.close();}
});
