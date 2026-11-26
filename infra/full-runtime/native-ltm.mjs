import {digest, boundedJSON} from './provider-wire.mjs';
import {modelRevision, readProjectBody} from './project.mjs';
import {RUN_ID, storedRun, validRun} from './project-runs.mjs';
import {initRunArtifacts} from './project-run-artifacts.mjs';
import {validFeedback} from './run-narrative.mjs';
import {writeNativeText, readNativeText} from './native-ltm-storage.mjs';

const empty = status => new Response(null, {status});
const SHA = /^[a-f0-9]{64}$/;
const numeric = Number.isFinite;
const method = name => ({euler:'Euler', rk4:'RK4', rk2:'RK2'})[String(name).toLowerCase()];
const samePartition = (id, partition) => JSON.stringify([partition, id]);

function nativeFeedback(data) {
  const {series:{time}, loops, periods, links} = data;
  const aligned = scores => Array.isArray(scores) && scores.length === time.length && scores.every(numeric);
  const edgeKey = (from, to) => JSON.stringify([from,to]);
  const edges = new Map(links.map(e => [edgeKey(e.from,e.to), e]));
  if (links.some(e => e.raw !== null && !aligned(e.raw))) throw Error('INVALID_LINK_SERIES');
  // A single shared sample grid keeps the original tool payload bounded.
  // Exact scores at every saved time remain available in the immutable /ltm record.
  const count = Math.min(time.length,100);
  const indices = Array.from({length:count},(_,i)=>count===1?0:Math.round(i*(time.length-1)/(count-1)));
  const identifiers = new Map();
  const unique = new Set();
  const feedbackLoops = loops.map(loop => {
    const {cycle, partition, signed} = loop;
    if (!cycle.length || (signed !== null && (!aligned(signed) || signed.some(x => Math.abs(x)>1+1e-12))))
      throw Error('INVALID_LOOP_SERIES');
    const identifier = 'P' + partition + '/' + loop.id.toUpperCase();
    if (unique.has(identifier)) throw Error('DUPLICATE_LOOP');
    unique.add(identifier);
    identifiers.set(samePartition(loop.id, partition), identifier);
    const path = cycle.map((from,i) => {
      const to = cycle[(i+1)%cycle.length];
      const edge = edges.get(edgeKey(from,to));
      return {from, to, polarity: edge?.polarity ?? '?',
        activity: edge?.raw == null ? 'unavailable' : edge.raw.some(x=>x!==0) ? 'observed' : 'zero_on_saved_grid'};
    });
    return {identifier, links:path, polarity: ({R:'+',B:'-'})[loop.polarity] ?? '',
      nativePolarity:loop.polarity, partition, signedRelativeScores:signed && indices.map(i=>signed[i]),
      activity:signed === null ? 'unavailable' : signed.some(x=>x!==0) ? 'observed' : 'zero_on_saved_grid'};
  });
  const dominantLoopsByPeriod = periods.map(p => ({...p,
    dominantLoops:p.dominantLoops.map(id=>identifiers.get(samePartition(id,p.partition)))}));
  return {valid:loops.length>0 && periods.length>0, feedbackLoops, dominantLoopsByPeriod,
    scoreTimes:indices.map(i=>time[i]),
    normalization:'sum of absolute native loop scores within each Simlin partition at the same time',
    dominanceRule:'pysimlin 0.8.5 Run.dominant_periods', activitySamples:time.length};
}

export async function projectNativeLtm(request, storage, runId, simulate) {
  if (!RUN_ID.test(runId)) return empty(404);
  const {sql} = storage;
  if (request.method === 'GET') {
    const body = readNativeText(sql,runId,'ltm');
    return body === undefined ? empty(404) : new Response(body,{headers:{'content-type':'application/json','cache-control':'no-store'}});
  }
  if (request.method !== 'PUT') return empty(405);
  const input = await readProjectBody(request,1024);
  if (input.error) return empty(input.error);
  const {revision, model_sha256} = input.value ?? {};
  if (!Number.isSafeInteger(revision) || revision<1 || !SHA.test(model_sha256) ||
      Object.keys(input.value).length!==2) return empty(422);
  const model = modelRevision(sql,revision);
  if (!model) return empty(404);
  if (await digest(model.body)!==model_sha256) return empty(409);
  const replay = () => {
    const row = storedRun(sql,runId);
    if (!row) return null;
    const run = JSON.parse(row.body);
    return empty(run.simulator.source==='server' && run.revision===revision && run.model_sha256===model_sha256 ? 204 : 409);
  };
  const previous = replay();
  if (previous) return previous;
  const {specs} = JSON.parse(model.body);
  if (!specs || ![specs.dt,specs.startTime,specs.stopTime].every(numeric) || specs.dt<=0 ||
      specs.stopTime<specs.startTime || (specs.stopTime-specs.startTime)/specs.dt>100000 ||
      !method(specs.integrationMethod ?? 'Euler') ||
      (specs.saveStep !== undefined && (!numeric(specs.saveStep) || specs.saveStep<specs.dt))) return empty(422);
  const settings = {startTime:specs.startTime,stopTime:specs.stopTime,dt:specs.dt,
    timeUnits:specs.timeUnits ?? 'Time',integrationMethod:method(specs.integrationMethod ?? 'Euler')};
  const response = await simulate(model.body);
  if (!response.ok) return empty(response.status);
  let runBody, feedbackBody, evidenceBody;
  try {
    const data = await boundedJSON(response.body,12*1024*1024);
    const actual = data.specs;
    const step = v => typeof v === 'string' && /^1\/[1-9]\d*$/.test(v) ? 1/Number(v.slice(2)) : Number(v);
    const execution = {integrationMethod:method(actual.method ?? 'Euler'),dt:step(actual.dt)};
    if (data.version!=='0.8.5' || !SHA.test(data.implementation_sha256) || !SHA.test(data.xmile_sha256) ||
        execution.integrationMethod!==settings.integrationMethod || execution.dt!==settings.dt ||
        actual.startTime!==settings.startTime || actual.endTime!==settings.stopTime ||
        (specs.saveStep!==undefined && step(actual.saveStep??actual.dt)!==specs.saveStep)) return empty(422);
    const source = {name:'pysimlin',version:data.version,implementation_sha256:data.implementation_sha256};
    const run = {revision,model_sha256,settings,execution,simulator:{...source,source:'server'},series:data.series};
    if (!validRun(run,'server')) return empty(422);
    const content = nativeFeedback(data);
    if (content.valid && !validFeedback(content,run.series.time)) return empty(422);
    runBody = JSON.stringify(run);
    const identity = {run_id:runId,run_sha256:await digest(runBody)};
    evidenceBody = JSON.stringify({...identity, revision, model_sha256, source, xmile_sha256:data.xmile_sha256,
      specs:actual, mode:data.mode, time:data.series.time, links:data.links, loops:data.loops, periods:data.periods});
    content.provenance = {...identity,revision,model_sha256,engine:source.name,version:source.version};
    feedbackBody = JSON.stringify({...identity,source:{...source,evidence_sha256:await digest(evidenceBody)},content});
  } catch { return empty(422); }
  return storage.transactionSync(()=>{
    const concurrent = replay();
    if (concurrent) return concurrent;
    initRunArtifacts(sql);
    writeNativeText(sql,runId,'run',runBody);
    writeNativeText(sql,runId,'ltm',evidenceBody);
    writeNativeText(sql,runId,'feedback',feedbackBody);
    sql.exec('INSERT INTO simulation_runs(run_id,revision,model_sha256,body) VALUES (?,?,?,?)',runId,revision,model_sha256,'');
    sql.exec('INSERT INTO run_artifacts(run_id,artifact_id,body) VALUES (?,?,?)',runId,'feedback','');
    return empty(201);
  });
}
