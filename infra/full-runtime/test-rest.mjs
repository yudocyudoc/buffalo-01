import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';

export async function rest(base,key){
  let healthy=false;
  for(let i=0;i<100;i++){
    try{const r=await fetch(base+'/status',{signal:AbortSignal.timeout(1000)});if(r.ok){healthy=true;break;}}catch{}
    await sleep(250);
  }
  assert(healthy,'original /status did not become ready');
  const response=await fetch(base+'/api/v1/engines');
  assert.equal(response.status,200);
  const catalog=await response.json();
  assert.equal(catalog.success,true);
  const names=catalog.engines.map(e=>e.name);
  assert(names.includes('predprey'));
  const absent=readdirSync('engines',{withFileTypes:true}).filter(d=>d.isDirectory()&&!names.includes(d.name)).map(d=>d.name);
  console.log(JSON.stringify({engines:names,unavailable:absent.filter(n=>!n.startsWith('test-')),
    test_engines_hidden:absent.filter(n=>n.startsWith('test-'))}));
  assert.equal((await fetch(base+'/api/v1/engines/predprey/parameters')).status,200);
  const url=base+'/api/v1/engines/predprey/generate';
  assert.equal((await fetch(url,{method:'POST'})).status,403);
  const r=await fetch(url,{method:'POST',headers:{Authentication:key,'content-type':'application/json'},body:JSON.stringify({prompt:'Predator and prey'})});
  const generated=await r.json();
  assert.equal(generated.success,true);
  assert.deepEqual(generated.model.variables.map(v=>v.name),['predator','prey']);
  assert.deepEqual(generated.model.relationships.map(r=>[r.from,r.to,r.polarity]),[['predator','prey','-'],['prey','predator','+']]);
  return names;
}
if(import.meta.url===pathToFileURL(process.argv[1]).href){
  const names=await rest('http://127.0.0.1:8080',process.env.AUTHENTICATION_KEY);
  assert(names.includes('causal-chains'),'compiled Go engine missing from image catalog');
}
