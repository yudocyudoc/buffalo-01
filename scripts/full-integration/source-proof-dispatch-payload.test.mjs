import test from 'node:test';
import assert from 'node:assert/strict';
import {makeSourceProofDispatch} from './source-proof-dispatch-payload.mjs';

const id='cffb07d9-78b5-464f-8194-3f6ffd144b90';
const digest='f'.repeat(64);
test('GitHub workflow_dispatch payload uses a literal string case_index',()=>{
  const x=makeSourceProofDispatch({handoffId:id,manifestSha:digest});
  assert.deepEqual(x,{ref:'main',inputs:{
    handoff_id:id,agent:'merlin',case_index:'0',manifest_sha256:digest
  }});
  assert.equal(typeof JSON.parse(JSON.stringify(x)).inputs.case_index,'string');
});
test('invalid handoff or digest blocks payload creation',()=>{
  for(const [handoffId,manifestSha] of [
    ['bad',digest],[id,'bad'],[id,'A'.repeat(64)],
    ['00000000-0000-0000-0000-000000000000',digest]
  ])assert.throws(()=>makeSourceProofDispatch({handoffId,manifestSha}));
});
