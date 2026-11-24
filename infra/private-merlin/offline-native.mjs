// One private origin and its genuine Linux worker in a loopback-only CI namespace.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {WebSocket} from 'ws';
import {readTurn} from './socket.mjs';
import {groups} from '../../evals/categories/policyImplementation.js';
import {MODEL,CONFIG_HASH} from './protocol.mjs';
const model=groups.policyImplementation.find(x=>x.expectations.scenario==='dialysisClinic').currentModel;
const key=randomBytes(32).toString('hex');
const source=process.env.GITHUB_SHA,deadline=Date.now()+90000;
const child=spawn('/usr/bin/setpriv',['--inh-caps=-all','--ambient-caps=-all','--no-new-privs','--',
  process.execPath,'infra/private-merlin/origin.mjs'],{stdio:'inherit',env:{
    PATH:process.env.PATH,HOME:process.env.HOME,MERLIN_PHASE:'R',MERLIN_KEY:key,MERLIN_SOURCE:source,
    BUFFALO_IMAGE_SOURCE_SHA:source,MERLIN_EXPIRES:String(deadline),ALLOW_UNSANDBOXED_FALLBACK:'false'}});
const stopped=once(child,'exit');
try{
  let ready=false;
  for(let i=0;i<300 && child.exitCode===null;i++){
    try{if((await fetch('http://127.0.0.1:8080/health')).status===204){ready=true;break;}}catch{}
    await sleep(100);
  }
  assert(ready,'origin failed to start');
  const ws=new WebSocket('ws://127.0.0.1:8080/api/v1',{headers:{'x-merlin-key':key}});
  const t=await readTurn(ws,'R',model,deadline);
  const res=await fetch('http://127.0.0.1:8080/proof',{headers:{'x-merlin-key':key}});
  assert.equal(res.status,200);
  const p=await res.json();
  assert.equal(p.session_id,t.session_id);
  assert.equal(p.source_commit,source);
  assert.equal(p.model_sha256,MODEL);
  assert.equal(p.agent_config_sha256,CONFIG_HASH);
  assert.deepEqual(p.worker_frames,['get_current_model','error','agent_complete']);
  assert.deepEqual(p.exit,{code:0,signal:null});
  assert.equal(t.output,null);
  console.log('OFFLINE_PRIVATE_WS_ORIGINAL_WORKER_DENIED',JSON.stringify(p));
}finally{child.kill();await stopped;}
