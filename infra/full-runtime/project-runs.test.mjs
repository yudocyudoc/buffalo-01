import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validRun,RUN_ID} from './project-runs.mjs';

const run=()=>({
 revision:2,model_sha256:'a'.repeat(64),
 simulator:{name:'PySD',version:'3.14.0',source:'client',implementation_sha256:'b'.repeat(64)},
 settings:{startTime:0,stopTime:4,dt:1,timeUnits:'Day',integrationMethod:'Euler'},
 execution:{integrationMethod:'Euler',dt:1},
 series:{time:[0,1,2,3,4],Inventory:[10,16,22,28,34]}
});
test('completed scalar run accepts absent or explicitly empty diagnostics',()=>{
 const x=run();assert(validRun(x));assert(validRun({...x,unitWarnings:[],errors:[]}));
 assert(!Object.hasOwn(x,'unitWarnings'));assert(!validRun({...x,errors:null}));
});
test('revision and simulator provenance are mandatory and bounded',()=>{
 for(const revision of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1,'2'])assert(!validRun({...run(),revision}));
 assert(!validRun({...run(),model_sha256:'wrong'}));
 for(const simulator of [{...run().simulator,source:'server'},{...run().simulator,implementation_sha256:''},{...run().simulator,version:''}])assert(!validRun({...run(),simulator}));
 assert(!validRun({...run(),scenario:{Demand:6}}));
});
test('reported effective method remains distinct from requested method',()=>{
 const x=run();x.settings.integrationMethod='RK4';x.execution.dt=.01;
 assert(validRun(x));assert(!validRun({...x,execution:{integrationMethod:'Euler',dt:0}}));
 assert(!validRun({...x,settings:{...x.settings,dt:Infinity}}));
});
test('reject truncated, misaligned, nonfinite and non-scalar series',()=>{
 for(const series of [
  {time:[0,1,2],Inventory:[10,16,22]},
  {time:[0,1,1,3,4],Inventory:[10,16,22,28,34]},
  {time:[0,1,2,3,4],Inventory:[10,16,22,28]},
  {time:[0,1,2,3,4],Inventory:[10,16,22,28,NaN]},
  {time:[0,1,2,3,4],Inventory:[10,16,22,28,null]},
  {time:[0,1,2,3,4],Inventory:[[10],[16],[22],[28],[34]]},
  {time:[0,1,2,3,4]}
 ])assert(!validRun({...run(),series}));
});
test('run IDs use canonical UUID v4, not arbitrary paths',()=>{
 assert(RUN_ID.test('60efb506-f649-4b4a-955b-f1c210664bc1'));
 for(const x of ['../model','run-1','60efb506-f649-3b4a-955b-f1c210664bc1','60EFb506-f649-4b4a-955b-f1c210664bc1'])assert(!RUN_ID.test(x));
});
