import test from 'node:test';
import assert from 'node:assert/strict';
import lab,{runFullHandoffLab} from './full-handoff-lab.mjs';

const base='https://lab.invalid/v1/lab/full-handoff/run-once';
const body='{"action":"RUN_FULL_HANDOFF_LAB_V1"}';
test('stage2 lab rejects every non-allowlisted route without ever opening D1',async()=>{
 const attempts=[
  new Request(base,{method:'GET',headers:{'Cf-Access-Jwt-Assertion':'example'}}),
  new Request('https://lab.invalid/v1/tasks',{method:'POST',
   headers:{'Cf-Access-Jwt-Assertion':'example','content-type':'application/json'},body}),
  new Request(base,{method:'POST',headers:{'content-type':'application/json'},body}),
  new Request(base,{method:'POST',
   headers:{'Cf-Access-Jwt-Assertion':'example','content-type':'text/plain'},body}),
  new Request(base,{method:'POST',
   headers:{'Cf-Access-Jwt-Assertion':'example','content-type':'application/json'},
   body:'{"action":"INVOKE_PAID_AGENT"}'}),
  new Request(base,{method:'POST',
   headers:{'Cf-Access-Jwt-Assertion':'example','content-type':'application/json'},
   body:JSON.stringify({action:'RUN_FULL_HANDOFF_LAB_V1',command:'bash'})})
 ];
 const expected=[404,404,403,415,400,400];
 for(let i=0;i<attempts.length;i++){
  const res=await lab.fetch(attempts[i],{});
  assert.equal(res.status,expected[i],String(i));
 }
});
test('stage2 lab is one-shot, with no scheduled execution path',async()=>{
 assert.equal(typeof lab.scheduled,'function');
 await lab.scheduled();
 await assert.rejects(()=>runFullHandoffLab(null),/HANDOFF_LAB_ASSERT_DB_REQUIRED/);
});
