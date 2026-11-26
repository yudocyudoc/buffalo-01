// F4: a deterministic user-facing factual projection for a selected immutable
// native run. The model can prioritize references, never author factual prose.
// This is an opt-in client boundary, not a general free-text verifier.
import {computeLtmFacts,checkLtmClaim} from './ltm-fidelity.mjs';
import {RUN_ID} from './project-runs.mjs';

const CONTRACT='BUFFALO_FACTS_V1';
const MAX_PROMPT_BYTES=24576, MAX_ROWS=512, MAX_SELECTION=24;
const bytes=s=>new TextEncoder().encode(s).length;
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const exact=n=>String(n);
// Keep every tied time in the machine-readable observed record, but do not
// replicate thousands of times for a constant variable in prompt/display text.
const times=a=>a.length<=8?a.map(exact).join(', '):
  a.length+' tied saved samples (first '+exact(a[0])+', last '+exact(a.at(-1))+
  '; all tied times are in the evidence record)';
const groupName=p=>typeof p==='number'?'Partition '+p:'Unpartitioned loop '+p;

function renderClaim(claim,observed){
 switch(claim.kind){
 case 'min':case 'max':
   return claim.variable+' — saved-grid '+(claim.kind==='min'?'minimum':'maximum')+': '+exact(observed.value)+' at '+times(observed.times);
 case 'value':return claim.variable+' at '+exact(observed.time)+': '+exact(observed.value);
 case 'active':return claim.loop+' — '+observed.activeSamples+' nonzero / '+observed.observedSamples+
   ' observed / '+observed.totalSamples+' saved samples';
 case 'dominance':return groupName(claim.partition)+' ['+exact(claim.start)+', '+exact(claim.end)+']: '+
   (observed.loops.length?observed.loops.join(' + '):'no active coalition');
 default:throw Error('UNRENDERABLE_FACT');
 }
}

// Every factual row is derived from full saved evidence and checked through F3.
// Unknown intervals remain explicit and cannot be selected as verified facts.
export function prepareFidelityPresentation({runId,run,evidence,feedback,stockNames=[],prompt}){
 if(!RUN_ID.test(runId)||typeof prompt!=='string')throw Error('INVALID_FIDELITY_REQUEST');
 const facts=computeLtmFacts(run.series,evidence);
 const rows=[], mandatory=[], defaults=[];
 const add=(claim,{required=false,preferred=false}={})=>{
  const checked=checkLtmClaim(facts,claim);
  if(checked.status!=='supported')throw Error('GENERATED_FACT_NOT_SUPPORTED');
  const row={id:'F'+(rows.length+1),claim,observed:checked.observed,text:renderClaim(claim,checked.observed)};
  rows.push(row);if(required)mandatory.push(row.id);if(preferred)defaults.push(row.id);
  if(rows.length>MAX_ROWS)throw Error('FIDELITY_CATALOG_TOO_LARGE');
  return row.id;
 };
 const normalize=s=>s.toLowerCase().replace(/\s+/g,'_');
 const stocks=new Set(stockNames.map(normalize));
 for(const [variable,v] of facts.variables){
  const preferred=stocks.has(normalize(variable));
  const start=facts.time[0],end=facts.time.at(-1);
  add({kind:'value',variable,at:start,value:v.values[0]},{preferred});
  if(end!==start)add({kind:'value',variable,at:end,value:v.values.at(-1)},{preferred});
  for(const kind of ['min','max'])add({kind,variable,value:v[kind].value},{preferred});
 }
 const unknown=[];
 for(const [partition,periods] of facts.periods){
  for(const p of periods){
   if(p.loops===null)unknown.push({partition,start:p.start,end:p.end,reason:'incomplete_scores'});
   else add({kind:'dominance',partition,start:p.start,end:p.end,loops:p.loops},{required:true});
  }
 }
 for(const [loop,a] of facts.activity){
  if(a.activeSamples>0||a.observedSamples===a.totalSamples)
   add({kind:'active',loop,value:a.activeSamples>0},{required:true});
  else unknown.push({loop,...a,reason:'incomplete_scores'});
 }
 if(!facts.periods.size)unknown.push({reason:'dominance_unavailable'});
 const identity={run_id:runId,revision:run.revision,run_sha256:feedback.run_sha256,
   evidence_sha256:feedback.source.evidence_sha256};
 const catalog={contract:CONTRACT,identity,samples:facts.time.length,
   time_units:run.settings.timeUnits,
   // Compact tuple schemas avoid repeating prose and key names in the prompt.
   // For tied extrema only count and outer times are transmitted; no assertion
   // is made that every sample in between is tied.
   rows:rows.map(({id,claim:c,observed:o})=>{
     if(c.kind==='min'||c.kind==='max')return [id,c.kind,c.variable,o.value,o.times[0],o.times.at(-1),o.times.length];
     if(c.kind==='value')return [id,c.kind,c.variable,o.value,o.time];
     if(c.kind==='dominance')return [id,c.kind,c.partition,c.start,c.end,o.loops];
     return [id,c.kind,c.loop,o.activeSamples,o.observedSamples,o.totalSamples];
   }),unknown};
 const instruction='\n\nFor the final reply ONLY, select references from the following computed facts. '+
   'Do not rewrite values or periods. Continue using the required original tools. '+
   'Return a single line exactly in this format: '+CONTRACT+' '+runId+' F1 F2 (choose one to '+MAX_SELECTION+' valid IDs). '+
   'No Markdown fences, explanations, extra text or new facts. Buffalo will render the factual answer. '+
   'Partition timelines and activity will be rendered in full regardless of your selection. '+
   'The original narrative is retained separately as unverified interpretation. '+
   'Catalog tuples: [ID,min|max,variable,value,firstTiedTime,lastTiedTime,tieCount]; '+
   '[ID,value,variable,value,time]; [ID,dominance,partition,start,end,exactCoalition]; '+
   '[ID,active,loop,nonzeroSamples,observedSamples,totalSavedSamples]. Ties need not be contiguous.\n'+JSON.stringify(catalog);
 if(bytes(instruction)>MAX_PROMPT_BYTES||unknown.length>MAX_ROWS)throw Error('FIDELITY_CATALOG_TOO_LARGE');
 const byId=new Map(rows.map(r=>[r.id,r]));
 const requiredSet=new Set(mandatory);
 const fallback=defaults.length?defaults:rows.filter(r=>!requiredSet.has(r.id)).slice(0,4).map(r=>r.id);

 function finalize(raw){
  // Original agent_text uses HTML; accept exactly a bare line or one paragraph
  // containing it. No regex extraction from mixed prose, no HTML from the model.
  const received=typeof raw==='string'?raw.trim():'';
  const plain=received.startsWith('<p>')&&received.endsWith('</p>')?received.slice(3,-4).trim():received;
  const parts=plain.split(/ +/);
  const proposed=parts.slice(2);
  let reason=null;
  if(parts[0]!==CONTRACT||parts[1]!==runId)reason='invalid_envelope_or_run';
  else if(!proposed.length||proposed.length>MAX_SELECTION||
    proposed.some(id=>!/^F[1-9]\d*$/.test(id)||!byId.has(id))||new Set(proposed).size!==proposed.length)
    reason='invalid_fact_selection';
  const chosen=reason?fallback:proposed;
  // Full timeline/activity always present; a model cannot erase a transition
  // by selecting only the first or last period. Stock summary is the fallback.
  // Selection order is a preference only for numerical facts. The complete
  // timeline is always emitted in native partition and chronological order.
  const ids=[...chosen.filter(id=>!requiredSet.has(id)),...mandatory];
  const selected=ids.map(id=>byId.get(id));
  const preferred=selected.filter(r=>!requiredSet.has(r.id));
  const periods=selected.filter(r=>r.claim.kind==='dominance');
  const activity=selected.filter(r=>r.claim.kind==='active');
  const list=rs=>'<ul>'+rs.map(r=>'<li>'+escape(r.text)+'</li>').join('')+'</ul>';
  const sections=[
   '<p>Computed facts for saved simulation '+escape(runId)+'. Time units: '+escape(run.settings.timeUnits)+
   '. All times are saved samples; intervals are inclusive within their own partition.</p>',
   reason?'<p>Model selection unavailable; showing deterministic evidence instead.</p>':'',
   '<h3>Selected numerical facts</h3>',preferred.length?list(preferred):'<p>No numerical facts selected.</p>',
   '<h3>Dominance by partition</h3>',periods.length?list(periods):'<p>No verified dominance intervals available.</p>',
   '<h3>Loop activity</h3>',activity.length?list(activity):'<p>No verified activity available.</p>',
   unknown.length?'<h3>Unverified evidence</h3><ul>'+unknown.map(u=>'<li>'+escape(JSON.stringify(u))+'</li>').join('')+'</ul>':'',
   '<p>These are computed model facts, not verified causal explanations of the real world. The original interpretive prose has not been semantically verified.</p>'
  ];
  return {contract:CONTRACT,identity,status:reason?'deterministic_fallback':'model_selection_accepted',
   reason,selected_ids:ids,claims:selected.map(({id,claim,observed})=>({id,claim,observed})),
   unknown,output:sections.join('\n'),prose:'not_semantically_verified'};
 }
 return {message:prompt+instruction,catalog,finalize};
}
