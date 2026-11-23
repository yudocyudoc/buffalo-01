/**
 * Extract the exact FIRST Merlin development-case initial model, never run a
 * simulation, evaluation or agent. This file generates ONLY ephemeral CI
 * build input for the private one-shot probe.
 */
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {inspectOriginalSources} from '../../scripts/full-integration/original-gate.mjs';
const PINNED_MODEL='57fed6310be45c10c263aecb796eeb72f993b318c5bc770013ff35e014cb4f39';
const OUT='infra/buffalo-origin/probe-initial-model.json';
const source=inspectOriginalSources();
if(source.status!=='PASS'||source.mode!=='SOURCE_READ_ONLY')throw Error('PROBE_SOURCE_GATE_FAILED');
const {groups}=await import('../../evals/categories/policyImplementation.js');
const items=groups.policyImplementation;
const ids=[...new Set(items.map(x=>x.expectations?.scenario))];
if(ids.length===0||typeof ids[0]!=='string')throw Error('PROBE_SCENARIO_MISSING');
const siblings=items.filter(x=>x.expectations?.scenario===ids[0]);
if(siblings.length!==3||siblings.some(x=>x.heldOut!==false)||
 siblings.map(x=>x.expectations.criterion).sort().join(',')!=='intact,meetsGoal,sensible')
 throw Error('PROBE_DEV_CASE_DRIFT');
const model=siblings[0].currentModel;
if(!model||!Array.isArray(model.variables)||!Array.isArray(model.relationships)||
 siblings.some(x=>JSON.stringify(x.currentModel)!==JSON.stringify(model)))
 throw Error('PROBE_MODEL_DRIFT');
const serialized=JSON.stringify(model);
const digest=createHash('sha256').update(serialized).digest('hex');
if(digest!==PINNED_MODEL)throw Error('PROBE_PINNED_MODEL_SHA_MISMATCH');
writeFileSync(OUT,serialized+'\n',{flag:'wx',mode:0o600});
console.log('PROBE_MODEL_SOURCE_METADATA_ONLY_'+digest);
