import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {configs} from './manual-edit.mjs';
import {PROJECT,LIMIT,validGrant} from './remote-edit.mjs';
test('disabled and armed configs pin the identical registry image and only arm one private project',()=>{
 const load=n=>JSON.parse(readFileSync(new URL(n,import.meta.url)));
 const ref='registry.cloudflare.com/e0cb52526a69c0f48f001901a5b9a640/buffalo-full-private@sha256:'+'a'.repeat(64);
 const {disabled,armed,g}=configs(load('wrangler.template.json'),load('wrangler.edit-operator.template.json'),ref,'b'.repeat(40),'58532b8a-b25e-4b67-a90b-10db57da263b',Date.now()+600000);
 assert(validGrant(g));assert.equal(g.project,PROJECT);assert.equal(g.max_calls,LIMIT);
 assert.equal(disabled.runtime.vars.RUNTIME_ENABLED,'false');assert(!disabled.runtime.ai);assert.deepEqual(disabled.operator.triggers.crons,[]);
 assert.equal(armed.runtime.containers[0].images.base.image,ref);assert.equal(disabled.runtime.containers[0].images.base.image,ref);
 assert.equal(armed.runtime.vars.AI_MAX_CALLS,'6');assert.deepEqual(armed.runtime.ai,{binding:'AI'});assert.deepEqual(armed.operator.triggers.crons,['* * * * *']);
 for(const c of [...Object.values(disabled),...Object.values(armed)]){assert.equal(c.workers_dev,false);assert.equal(c.preview_urls,false);assert(!c.routes)}
 assert(!JSON.stringify({armed,disabled}).includes('APP_AUTH_KEY'));
});
