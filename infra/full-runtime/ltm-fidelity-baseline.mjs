import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {computeLtmFacts, checkLtmClaim} from './ltm-fidelity.mjs';
import {annotations} from './evidence/ltm-fidelity/annotations.mjs';

export function fidelityBaseline() {
  const body = gunzipSync(readFileSync(new URL('./evidence/ltm-fidelity/corpus.json.gz',import.meta.url)));
  if (createHash('sha256').update(body).digest('hex') !== 'c693f5b74f53394c3c7ac5684d226bfd17c808ea4cff5f4c15271e31b3f57ca6')
    throw Error('Historical baseline changed');
  const rows = [];
  for (const entry of JSON.parse(body)) {
    const facts = computeLtmFacts(entry.series,entry.evidence);
    for (const surface of ['narrative','final']) {
      const text = entry[surface].replace(/<[^>]+>/g,'').replace(/\s+/g,' ');
      for (const [expected,anchor,claim] of annotations[entry.name][surface]) {
        if (!text.includes(anchor)) throw Error('Missing source passage: ' + entry.name + ' / ' + anchor);
        rows.push({name:entry.name, run_id:entry.run_id, surface, anchor, claim, expected, ...checkLtmClaim(facts,claim)});
      }
    }
  }
  return rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(fidelityBaseline(),null,2));
}
