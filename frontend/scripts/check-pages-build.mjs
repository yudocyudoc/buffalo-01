import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {pagesBase} from './pages-base.mjs';

const base=pagesBase();
const dist=resolve('dist');
const html=readFileSync(resolve(dist,'index.html'),'utf8');
const refs=[...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"[^>]*>/g)].map(m=>m[1]);
assert(refs.some(r=>r.endsWith('.js')),'Missing entry script');
assert(refs.some(r=>r.endsWith('.css')),'Missing stylesheet');
assert(refs.some(r=>r.endsWith('/vite.svg')),'Missing site icon');
for(const url of refs){
  assert(url.startsWith(base),'Resource outside expected Pages base: '+url);
  const relative=url.slice(base.length);
  assert(relative&&!relative.split('/').some(x=>x==='..'||x==='.'||!x),'Invalid resource path');
  assert(statSync(resolve(dist,relative)).isFile(),'Missing generated resource: '+url);
}
console.log('PAGES_BUILD_BASE_VERIFIED '+JSON.stringify({base,resources:refs}));
