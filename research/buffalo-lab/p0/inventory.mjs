import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {fidelityBaseline} from '../../../infra/full-runtime/ltm-fidelity-baseline.mjs';
export const protocol=JSON.parse(readFileSync(new URL('./protocol.json',import.meta.url)));
const sha=x=>createHash('sha256').update(x).digest('hex');
const read=p=>readFileSync(new URL(p,import.meta.url));
const require=(x,m)=>{if(!x)throw Error(m)};
const scoreKey='Percent of this Feedback Loop Set Behavior Explained by Loop';
const tol=protocol.tolerance;
export function evidence(){
 const wire=JSON.parse(read('../c4/matrix-wires/inventoryWorkforce-deepseek-low.json'));
 const digest=sha(JSON.stringify(wire.wire));
 require(digest===protocol.source.wire_sha256&&digest===wire.wire_sha256,'wire drift');
 const model=JSON.parse(wire.wire.messages[1].content),msg=wire.wire.messages[3].content;
 const f=JSON.parse(msg.slice(msg.indexOf('{')));
 const vars=Object.fromEntries(model.variables.map(x=>[x.name,x]));
 const eq=Object.fromEntries(model.variables.map(x=>[x.name,x.equation.replace(/\s/g,'')]));
 const expected={'Inventory':'Desired_Inventory','Workers':'desired_workers','Expected Demand':'demand','producing':'Workers*productivity_per_worker','shipping':'demand','hiring or firing':'workers_gap/time_to_hire_or_fire','changing expected':'(demand-Expected_Demand)/time_to_adjust_expectations','inventory gap':'Desired_Inventory-Inventory','desired workers':'desired_production/productivity_per_worker','desired change in inventory':'inventory_gap/inventory_adjustment_time','desired production':'Expected_Demand+desired_change_in_inventory','workers gap':'desired_workers-Workers','productivity per worker':'2','Desired Inventory':'100','time to hire or fire':'6','inventory adjustment time':'1','time to adjust expectations':'6','demand':'TIME'};
 for(const [k,v] of Object.entries(expected))require(eq[k]===v,'equation drift: '+k);
 for(const [k,i,o] of [['Inventory',['producing'],['shipping']],['Workers',['hiring or firing'],[]],['Expected Demand',['changing expected'],[]]])require(JSON.stringify(vars[k].inflows)===JSON.stringify(i)&&JSON.stringify(vars[k].outflows)===JSON.stringify(o),'stock flow drift');
 const points=vars.demand.graphicalFunction.points;
 require(JSON.stringify(points)===JSON.stringify([{x:0,y:20},{x:1,y:20},{x:2,y:25},{x:3,y:25}]),'demand drift');
 const {dt,startTime,stopTime,timeUnits}=model.specs;
 require(dt===1/16&&startTime===0&&stopTime===60&&timeUnits==='Months','clock drift');
 const loops=new Map();
 for(const l of f.feedbackLoops){
  const group=Number(l.loopset.match(/^Feedback Loop Set (\d+)$/)?.[1]);
  const key=group+'/'+l.identifier,s=l[scoreKey];
  require(!loops.has(key)&&s.length===961&&s.every((r,i)=>r.time===i*dt&&Number.isFinite(r.value)&&r.value>=0&&r.value<=100),'invalid scores');
  loops.set(key,{group,loop:l.identifier,links:l.links,series:s});
 }
 require(loops.size===3&&['1/B1','1/B2','2/B1'].every(k=>loops.has(k)),'loop identities drift');
 const omega=Math.sqrt(23)/12,period=2*Math.PI/omega,ratio=Math.exp(-period/12);
 const modal={realParts:[-1/6,-1/12,-1/12],period,ratio,eulerPeriod:2*Math.PI*dt/Math.atan2(dt*omega,1-dt/12)};
 let I=100,W=10,E=20;const rows=[];
 for(let k=0;k<=960;k++){const t=k*dt,D=t<=1?20:t<2?20+5*(t-1):25;rows.push({t,I,W,E,D});[I,W,E]=[I+dt*(2*W-D),W+dt*((E+100-I)/2-W)/6,E+dt*(D-E)/6]}
 const extrema=rows.filter((r,i)=>i>0&&i<rows.length-1&&r.t>2&&((r.I<rows[i-1].I&&r.I<rows[i+1].I)||(r.I>rows[i-1].I&&r.I>rows[i+1].I)));
 return {digest,loops,modal,rows,extrema,calendar:f.dominantLoopsByPeriod,modelHash:sha(JSON.stringify(model)),feedbackHash:sha(JSON.stringify(f))};
}
const unverified=(reason,witness)=>({status:'unverified',reason,witness});
const verdict=(ok,witness)=>({status:ok?'supported':'contradicted',witness});
function peaks(l,after){return l.series.filter((r,i,s)=>r.time>after&&i>0&&i<s.length-1&&r.value>s[i-1].value&&r.value>s[i+1].value)}
export function check(e,c){
 const hist={run:protocol.source.historical_run,sha256:e.feedbackHash,unit:'percentage points'};
 const ana={run:protocol.source.analytic_run,sha256:e.modelHash,condition:'constant_demand',observable:'continuous eigenmode'};
 const eu={run:protocol.source.euler_run,sha256:e.modelHash,condition:'linear ramp, held final demand; forward Euler dt=1/16'};
 if(c.kind==='historical_stock_period')return unverified(c.evidence_run&&c.evidence_run!==hist.run?'cross_run_evidence':'historical_stock_series_absent',{...hist,observable:'Inventory stock period'});
 if(['share','peak_spacing','peak_values'].includes(c.kind)){
  const l=e.loops.get(c.group+'/'+c.loop);
  if(!l)return unverified('group_and_loop_required',{...hist,group:c.group??null,loop:c.loop});
  const w={...hist,group:l.group,loop:l.loop,links:l.links};
  if(c.kind==='share'){const r=l.series.find(r=>r.time===c.time);if(!r)return unverified('sample_missing',w);return verdict(Math.abs(r.value-c.value)<=tol.share_pp,{...w,observable:'relative_loop_share',rule:'exact saved sample',...r})}
  const p=peaks(l,c.after);
  if(c.kind==='peak_values'){return verdict(p.length===c.values.length&&p.every((r,i)=>Math.abs(r.value-c.values[i])<=tol.share_pp),{...w,observable:'strict local share maxima',rule:'interior strict maxima after cutoff',after:c.after,peaks:p})}
  const intervals=p.slice(1).map((r,i)=>r.time-p[i].time);
  if(!intervals.length)return unverified('insufficient_maxima',w);
  return verdict(intervals.every(x=>x>=c.lo&&x<=c.hi),{...w,unit:'months',observable:'strict local share maxima recurrence',rule:'differences of successive interior strict maxima after cutoff',after:c.after,peaks:p,intervals});
 }
 if(c.kind==='onset_spacing'){
  if(c.group!==1)return unverified('flat_calendar_group_not_verified',hist);
  const starts=e.calendar.filter(x=>x.startTime>=c.after&&x.dominantLoops.length===1&&x.dominantLoops[0]===c.loop).map(x=>x.startTime);
  const intervals=starts.slice(1).map((t,i)=>t-starts[i]);
  // The historical calendar has no group field. Even a matching recurrence is conditional.
  if(!intervals.length)return unverified('insufficient_onsets',hist);
  return verdict(intervals.every(x=>x>=c.lo&&x<=c.hi),{...hist,unit:'months',group:1,condition:'flat calendar interpreted as operational group 1; not a stock period',observable:'calendar onset spacing',rule:'successive starts after cutoff',starts,intervals});
 }
 if(c.kind==='independent_denominators')return verdict(e.loops.get('1/B1').group!==e.loops.get('2/B1').group,{...hist,observable:'normalization groups',groups:[1,2],field:scoreKey});
 if(['modal_period','stable','limit_cycle'].includes(c.kind)){
  if(c.condition!=='constant_demand')return unverified('condition_not_established',ana);
  const stable=e.modal.realParts.every(x=>x<0);
  const ok=c.kind==='modal_period'?Math.abs(e.modal.period-c.value)<=tol.period_months:c.kind==='stable'?stable===c.value:(!stable===c.value);
  return verdict(ok,{...ana,...e.modal,unit:c.kind==='modal_period'?'months':null,rule:'exact eigenvalues of fixed affine system; no nonzero autonomous periodic orbit when Hurwitz'});
 }
 if(c.kind==='possible_overcorrection')return c.condition==='euler_ramp'?verdict(e.extrema.some(x=>x.I<100)&&e.extrema.some(x=>x.I>100),{...eu,observable:'inventory extrema around target',unit:'widgets',extrema:e.extrema.slice(0,4),rule:'constructive example, not isolated causal intervention'}):unverified('condition_not_established',eu);
 if(c.kind==='feedback_structure')return verdict(e.loops.get('1/B1').links.some(l=>l.from==='desired workers'&&l.to==='workers gap')&&e.loops.get('1/B2').links.some(l=>l.from==='Workers'&&l.to==='workers gap'),{...ana,observable:'operational loop edges',rule:'frozen directed links',group:1,links:[e.loops.get('1/B1').links,e.loops.get('1/B2').links]});
 return unverified('outside_typed_contract',{kind:c.kind});
}
function annotate(e,text,annotations,surface,source){
 const rows=annotations.map(a=>{const anchor=a.anchor??a.text;const start=text.indexOf(anchor);require(start>=0&&text.lastIndexOf(anchor)===start,'anchor missing or ambiguous '+a.id);return {id:a.id??anchor,anchor,start,end:start+anchor.length,expected:a.expected,claim:a.claim,...check(e,a.claim)}});
 const covered=rows.map(r=>[r.start,r.end]).sort((a,b)=>a[0]-b[0]);const gaps=[];let cursor=0;for(const [start,end] of covered){if(start>cursor&&text.slice(cursor,start).trim())gaps.push({start:cursor,end:start,text:text.slice(cursor,start)});cursor=Math.max(cursor,end)}if(cursor<text.length&&text.slice(cursor).trim())gaps.push({start:cursor,end:text.length,text:text.slice(cursor)});
 return {source,surface,text_sha256:sha(text),rows,unannotated_spans:gaps,text_preserved:text};
}
export function run(){
 const e=evidence();
 const text=protocol.controls.map(x=>x.text).join('\n')+'\n'+protocol.mixed.text;
 const annotations=[...protocol.controls,...protocol.mixed.claims];
 const synthetic=['narrative','final'].map(surface=>annotate(e,text,annotations,surface,'synthetic paired transport controls; not actual Merlin execution'));
 const receipt=JSON.parse(read('../c4/extension-receipts/C4-inventoryWorkforce-deepseek-low-r1.json'));
 require(receipt.wire_sha256===e.digest,'receipt wire mismatch');
 const actual=JSON.parse(receipt.result.choices[0].message.content).response;
 const real=annotate(e,actual,protocol.real,'seldon','archived C4 LOW; manually selected not blind');
 const native=fidelityBaseline().filter(r=>r.name==='inventoryWorkforce');
 return {scope:protocol.scope,wire_sha256:e.digest,modal:e.modal,extrema:e.extrema.slice(0,4),synthetic,real,native_f1_f3:native,limitations:['No automatic extraction; unannotated spans are not evaluated.','Synthetic paired surfaces test same checker, not actual Merlin transfer. Native F1-F3 paired rows retain their own run.','No new inference, no historical Stella stock series, no discrete LTM derivation, no repair.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(run(),null,2));
