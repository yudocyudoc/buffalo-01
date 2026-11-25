// Immutable completed client simulations. The store authenticates revision
// identity, not the scientific truth of client-reported results.
import {modelRevision,readProjectBody} from './project.mjs';
import {digest} from './provider-wire.mjs';

export const RUN_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{64}$/;
const MAX_BODY=512*1024,PAGE=50;
const finite=Number.isFinite;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const str=x=>typeof x==='string'&&x.trim().length>0&&x.length<=256;
const revision=x=>Number.isSafeInteger(x)&&x>0;
const exactKeys=(x,required,optional=[])=>object(x)&&required.every(k=>Object.hasOwn(x,k))&&Object.keys(x).every(k=>required.includes(k)||optional.includes(k));
const response=(status)=>new Response(null,{status});
const json=x=>Response.json(x,{headers:{'cache-control':'no-store'}});
const specKeys=['startTime','stopTime','dt','timeUnits','integrationMethod'];

// First contract: completed scalar finite trajectories, no runtime parameter
// overrides. An intervention is represented by its own stored model revision.
export function validRun(value){
 if(!exactKeys(value,['revision','model_sha256','simulator','settings','execution','series'],['unitWarnings','errors']))return false;
 const {simulator,settings,execution,series}=value;
 if(!revision(value.revision)||typeof value.model_sha256!=='string'||!SHA.test(value.model_sha256))return false;
 if(!exactKeys(simulator,['name','version','source','implementation_sha256'])||
  !str(simulator.name)||!str(simulator.version)||simulator.source!=='client'||
  typeof simulator.implementation_sha256!=='string'||!SHA.test(simulator.implementation_sha256))return false;
 if(!exactKeys(settings,specKeys)||![settings.startTime,settings.stopTime,settings.dt].every(finite)||
  settings.stopTime<settings.startTime||settings.dt<=0||!str(settings.timeUnits)||!str(settings.integrationMethod))return false;
 // Record the effective integrator/step separately from the model request
 // (upstream PySD may refine Euler for a requested RK method).
 if(!exactKeys(execution,['integrationMethod','dt'])||!str(execution.integrationMethod)||!finite(execution.dt)||execution.dt<=0)return false;
 if(!object(series)||!Object.hasOwn(series,'time')||Object.keys(series).length<2)return false;
 const time=series.time;
 if(!Array.isArray(time)||time.length===0||!time.every((t,i)=>finite(t)&&(i===0||t>time[i-1])))return false;
 const near=(a,b)=>Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(a),Math.abs(b));
 if(!near(time[0],settings.startTime)||!near(time[time.length-1],settings.stopTime))return false;
 if(!Object.entries(series).every(([name,values])=>str(name)&&Array.isArray(values)&&values.length===time.length&&values.every(finite)))return false;
 for(const key of ['unitWarnings','errors'])if(Object.hasOwn(value,key)&&!Array.isArray(value[key]))return false;
 return true;
}
function init(sql){
 sql.exec('CREATE TABLE IF NOT EXISTS simulation_runs (seq INTEGER PRIMARY KEY, run_id TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL, model_sha256 TEXT NOT NULL, body TEXT NOT NULL)');
}
export function storedRun(sql,id){
 init(sql);
 return sql.exec('SELECT body FROM simulation_runs WHERE run_id=?',id).toArray()[0];
}
export async function projectRuns(request,storage,runId=null){
 const sql=storage.sql;
 const find=()=>storedRun(sql,runId);
 if(runId===null){
  if(request.method!=='GET')return response(405);
  init(sql);
  const params=new URL(request.url).searchParams;
  const after=params.get('after')??'0';
  if(!/^\d{1,16}$/.test(after)||!Number.isSafeInteger(Number(after)))return response(400);
  const rows=sql.exec('SELECT seq,run_id,revision,model_sha256 FROM simulation_runs WHERE seq>? ORDER BY seq LIMIT ?',Number(after),PAGE+1).toArray();
  const page=rows.slice(0,PAGE);
  return json({runs:page,next_after:rows.length>PAGE?page[page.length-1].seq:null});
 }
 if(!RUN_ID.test(runId))return response(404);
 if(request.method==='GET'){
  const row=find();
  return row?new Response(row.body,{headers:{'content-type':'application/json','cache-control':'no-store'}}):response(404);
 }
 if(request.method!=='PUT')return response(405);
 const parsed=await readProjectBody(request,MAX_BODY);
 if(parsed.error)return response(parsed.error);
 const {body,value}=parsed;
 if(!validRun(value))return response(422);
 // Every historical model row is immutable; hashing outside the synchronous
 // transaction cannot race with a later latest-model update.
 const model=modelRevision(sql,value.revision);
 if(!model)return response(404);
 if(await digest(model.body)!==value.model_sha256)return response(409);
 const specs=JSON.parse(model.body).specs;
 if(!object(specs)||!specKeys.every(k=>specs[k]===value.settings[k]))return response(422);
 return storage.transactionSync(()=>{
  const existing=find();
  if(existing)return response(existing.body===body?204:409);
  sql.exec('INSERT INTO simulation_runs(run_id,revision,model_sha256,body) VALUES (?,?,?,?)',runId,value.revision,value.model_sha256,body);
  return response(201);
 });
}
