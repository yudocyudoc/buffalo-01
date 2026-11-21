/**
 * Compare TWO original Buffalo policyImplementation run artifacts.
 * No LLM, no inference, no mutation. Same scenario, agent and original graders.
 * Usage = Cloudflare response fields; no OpenAI-fallback cost assumptions.
 *
 * Usage:
 * node scripts/compare-cloudflare-runs.mjs <inkling-run.json> <gemma-run.json>
 */
import {readFile} from 'node:fs/promises';

const paths=process.argv.slice(2);
if(paths.length!==2){
  console.error('Usage: node scripts/compare-cloudflare-runs.mjs <run-a.json> <run-b.json>');
  process.exit(2);
}

const loaded=await Promise.all(paths.map(async path=>({
  path,record:JSON.parse(await readFile(path,'utf8'))
})));
for(const {record,path} of loaded){
  if(record.benchmarkGroup!=='policyImplementation'||!record.scenarioId||!record.agentName)
    throw Error('Not a Buffalo native policy evidence file: '+path);
}
const [a,b]=loaded.map(x=>x.record);
if(a.scenarioId!==b.scenarioId||a.agentName!==b.agentName)
  throw Error('Comparison requires same original scenario and agent, got '+a.scenarioId+'/'+a.agentName+' vs '+b.scenarioId+'/'+b.agentName);
if(a.actualProviderModel===b.actualProviderModel)
  console.warn('WARNING: both artifacts use the same model; not a cross-model comparison.');
const extract=record=>{
  const receipts=record.providerReceipts||[];
  const responders=receipts.filter(r=>r.http_status===200);
  let neurons=0,hasMeasured=true;
  for(const r of responders){
    const n=r.usage?.neurons ?? r.neuronMetering?.neurons;
    if(typeof n!=='number'||!Number.isFinite(n)){hasMeasured=false;break;}
    neurons+=n;
  }
  const input=responders.reduce((s,r)=>s+(r.usage?.prompt_tokens||r.usage?.input_tokens||0),0);
  const output=responders.reduce((s,r)=>s+(r.usage?.completion_tokens||r.usage?.output_tokens||0),0);
  const grade=Object.fromEntries((record.grades||[]).map(g=>[g.criterion,
    g.gradingError?'grading error':g.passed?'passed':'failed']));
  const complete=record.gradingStatus==='executed'&&['meetsGoal','intact','sensible']
    .every(k=>Object.hasOwn(grade,k));
  return {
    model:record.actualProviderModel||'unknown',
    status:record.status||'unclassified',
    stop:record.stopReason||'unknown',
    posts:receipts.length,ok:responders.length,
    neurons:hasMeasured?neurons:null,
    input,output,
    toolCalls:record.evidence?.toolCalls??record.evidence?.observedToolCompletions??0,
    runModelCalls:record.evidence?.runModelCalls??null,
    grades:grade,complete,
    maxPosts:record.experimentParameters?.maxPosts??null,
    maxNeurons:record.experimentParameters?.maxNeurons??null,
    commit:record.commit??'unknown'
  };
};
const records=loaded.map(x=>extract(x.record));
const fmt=x=>x===null||x===undefined?'not available':Number.isFinite(x)?x.toLocaleString('en-US',{maximumFractionDigits:2}):String(x);
const fields=[
  ['Model',x=>x.model],['State',x=>x.status],['Stop reason',x=>x.stop],
  ['HTTP 200 / POSTs',x=>x.ok+' / '+x.posts],
  ['Cloudflare neurons',x=>fmt(x.neurons)],['Input tokens',x=>fmt(x.input)],
  ['Output tokens',x=>fmt(x.output)],['Observed tool completions',x=>fmt(x.toolCalls)],
  ['Run-model tool calls',x=>fmt(x.runModelCalls)],
  ['Goal',x=>x.grades.meetsGoal||'not evaluated'],
  ['Protected constraints',x=>x.grades.intact||'not evaluated'],
  ['Sensible behavior',x=>x.grades.sensible||'not evaluated'],
  ['Max POSTS',x=>fmt(x.maxPosts)],['Local neuron cap',x=>fmt(x.maxNeurons)],
];
const safe=s=>String(s).replaceAll('|','\\|').replaceAll('\n',' ');
console.log('# Buffalo Cloudflare original policy comparison');
console.log('Scenario: '+a.scenarioId+' — Agent: '+a.agentName+'\n');
console.log('| Metric | Run A | Run B |');
console.log('|---|---|---|');
for(const [name,get] of fields)console.log('| '+name+' | '+safe(get(records[0]))+' | '+safe(get(records[1]))+' |');
console.log('\nSource artifacts: '+paths.join(', '));
console.log('Results are comparable as exploratory runs, not statistically controlled trials.');
if(records.some(x=>!x.complete))
  console.log('**INCOMPLETE**: at least one run did not finish all original graders. Do not rank policy success.');
else
  console.log('Both executions reached the original three graders; inspect exact failures before claiming success.');
console.log('Neuron values are per-run Cloudflare response receipts, not account-wide daily usage. Output and reasoning behavior may differ by model.');
