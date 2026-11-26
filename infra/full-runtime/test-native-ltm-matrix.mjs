// Complete LTM acceptance matrix, independent of the earlier two-case regression.
// Controlled mode exercises the original tool protocol, not LLM competence.
// Live mode forwards the exact gateway wire to a separately authorized host broker.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {digest} from './provider-wire.mjs';
import {captureNarrativeAttempt} from './narrative-attempt.mjs';
import {openNativeLtmRun} from './native-ltm-client.mjs';
import {session} from './test-session.mjs';
import {GEMMA} from '../private-merlin/gemma-response.mjs';

const specs=[
  ['armsRace','Euler',.125,3],['bassDiffusion','Euler',.0625,2],
  ['inventoryWorkforce','RK4',.0625,3],['predatorPrey','RK4',1,5],
  ['marketGrowth','Euler',5,20],['maibab','RK4',1,10],
  ['maibab-control','RK4',.125,10],['maibab-perturbed','RK4',.125,10]
];
export const MATRIX_CASES=specs.map(s=>s[0]);
const success=(tools,name)=>tools.some(t=>t.event==='tool_call_completed'&&t.name===name&&!t.isError);
const err=e=>({name:e?.name??'Error',message:String(e?.message??e)});
const cycleKey=l=>{const a=l.cycle;return a.map((_,i)=>a.slice(i).concat(a.slice(0,i)).join('\u0000')).sort()[0];};

export async function seedLtmMatrix(request,other,report,save){
  let etag;
  for(const [name,method,saveStep,expectedCycles] of specs){
    const c={name,status:'PENDING',expectedCycles};report.cases.push(c);
    try{
      const source=name.startsWith('maibab-')?'maibab':name;
      const fixture=JSON.parse(readFileSync(new URL('../../evals/categories/feedbackExplanationData/'+source+'.json',import.meta.url)));
      const model=structuredClone(fixture.model);
      model.specs.integrationMethod=method;model.specs.saveStep=saveStep;
      if(name.startsWith('maibab-')){
        model.specs.stopTime=1812;
        const normal=model.variables.filter(v=>v.name==='Normal Food Per Deer');
        assert.equal(normal.length,1);assert.equal(normal[0].equation,'1');
        if(name==='maibab-perturbed')normal[0].equation='100';
      }
      c.input={source,model,sourceSettings:{method,saveStep}};
      const response=await request('/project/model',{method:'PUT',headers:etag?{'if-match':etag}:{'if-none-match':'*'},body:JSON.stringify(model)});
      assert.equal(response.status,etag?204:201,'persist model '+name);
      etag=response.headers.get('etag');
      c.identity={revision:Number(JSON.parse(etag)),model_sha256:response.headers.get('x-buffalo-model-sha256')};
      c.runId=randomUUID();const path='/project/runs/'+c.runId+'/ltm';
      const init={method:'PUT',body:JSON.stringify(c.identity)};
      assert.equal((await other(path,init)).status,404);
      const calc=await request(path,init);
      c.computeStatus=calc.status;
      assert.equal(calc.status,201,'native calculation '+name);
      assert.equal((await request(path,init)).status,204,'idempotence '+name);
      const body=await (await request(path)).text();
      c.evidenceHash=await digest(body);c.evidence=JSON.parse(body);
      c.status='COMPUTED';
      c.cycleCount=c.evidence.loops.length;
      c.cycleCountMatches=c.cycleCount===expectedCycles;
      c.samples=c.evidence.time.length;
      const want=Math.round((model.specs.stopTime-model.specs.startTime)/saveStep)+1;
      assert.equal(c.samples,want,'saved grid count');
      assert.equal(c.evidence.time[0],model.specs.startTime);
      assert.equal(c.evidence.time.at(-1),model.specs.stopTime);
      assert.equal((await other(path)).status,404);
      c.zeroCycles=c.evidence.loops.filter(l=>Array.isArray(l.signed)&&l.signed.length===c.samples&&l.signed.every(x=>x===0)).map(cycleKey);
    }catch(e){c.status='COMPUTE_FAILED';c.error=err(e);}
    save();
  }
}

function broker(socket,caseName,model,wire){
  return new Promise((resolve,reject)=>{
    const body=JSON.stringify({caseName,model,wire});
    const req=httpRequest({socketPath:socket,path:'/infer',method:'POST',headers:{'content-type':'application/json','content-length':Buffer.byteLength(body)}},res=>{
      const chunks=[];let n=0;
      res.on('data',x=>{n+=x.length;if(n>2*1024*1024)req.destroy(Error('BROKER_RESPONSE_TOO_LARGE'));else chunks.push(x);});
      res.on('end',()=>{try{const data=JSON.parse(Buffer.concat(chunks).toString());if(res.statusCode!==200)throw Error('BROKER_'+res.statusCode+'_'+(data.error??'FAILED'));resolve(data);}catch(e){reject(e);}});
      res.on('error',reject);
    });
    req.setTimeout(90000,()=>req.destroy(Error('BROKER_TIMEOUT')));
    req.on('error',reject);req.end(body);
  });
}

export async function reopenLtmMatrix(request,other,key,report,save,useProvider,{socket=null}={}){
  for(const c of report.cases){
    if(c.status!=='COMPUTED')continue;
    c.providerCalls=[];c.toolTrace=[];c.narratives=[];c.narrative_attempts=[];
    try{
      const selected=await openNativeLtmRun(request,c.runId);
      assert.equal(await digest(await (await request('/project/runs/'+c.runId+'/ltm')).text()),c.evidenceHash);
      assert.equal(selected.feedback.source.evidence_sha256,c.evidenceHash);
      assert.deepEqual(selected.model,c.input.model);
      assert.equal((await other('/project/runs/'+c.runId+'/ltm')).status,404);
      await assert.rejects(selected.clientRequest({type:'feedback_request',runIds:[randomUUID()]}));
      c.feedback=selected.feedback;c.run=selected.run;c.assessment=selected.assessment;
      assert.equal(selected.assessment.dominance.status,'supported_by_partition_scores','independent numerical dominance');
      const stock=selected.model.variables.find(v=>v.type==='stock').name;
      const actions=[['get_feedback_information',{runIds:[c.runId]}],
        ['get_variable_data',{runIds:[c.runId],variableNames:[stock],detailed:false}],
        ['generate_ltm_narrative',{difficulty:'normal',parameters:{runIds:[c.runId],problemStatement:'Explain the feedback in the saved run.'}}]];
      let turn=0;
      useProvider(async(model,wire)=>{
        assert.equal(model,GEMMA);
        assert(c.providerCalls.length<8,'case inference ceiling');
        const call={wire,model,status:'RESERVED'};c.providerCalls.push(call);save();
        try{
          let response;
          if(socket)response=await broker(socket,c.name,model,wire);
          else{
            const message={role:'assistant'};
            if(wire.response_format){
              const input=JSON.parse(wire.messages.find(m=>m.role==='assistant').content);
              assert.deepEqual(input.feedbackLoops,selected.feedback.content.feedbackLoops);
              assert.deepEqual(input.dominantLoopsByPeriod,selected.feedback.content.dominantLoopsByPeriod);
              message.content=JSON.stringify({feedbackLoops:input.feedbackLoops.map(l=>({identifier:l.identifier,name:l.identifier,description:l.activity})),narrativeMarkdown:'Controlled matrix response, not semantic evidence.'});
            }else if(turn<actions.length){
              const [name,args]=actions[turn++];
              assert(wire.tools.some(t=>t.function.name===name));
              message.tool_calls=[{type:'function',id:'matrix-'+turn,function:{name,arguments:JSON.stringify(args)}}];
            }else message.content='Controlled matrix acknowledgement.';
            response={model,usage:{prompt_tokens:50,completion_tokens:20},choices:[{index:0,finish_reason:message.tool_calls?'tool_calls':'stop',message}]};
          }
          call.status='RETURNED';call.response=response;save();return response;
        }catch(e){call.status='FAILED';call.error=err(e);save();throw e;}
      });
      const prompt='Analyze the immutable saved simulation '+c.runId+
        '. Use get_feedback_information for that run, get_variable_data for '+stock+
        ', and generate_ltm_narrative for that run. Explain structure, activity and dominance separately. Do not edit or rerun the model. Do not invent periods or equate individual maxima with dominance.';
      const result=await session({key,mode:'sfd',agent:'merlin',edit:true,deadline:Date.now()+180000,model:selected.model,scenario:{
        readOnly:true,message:prompt,clientRequest:selected.clientRequest,
        async onToolCompleted(message){
          c.toolTrace.push({name:message.toolName,isError:message.isError});
          if(message.toolName==='generate_ltm_narrative'&&!message.isError){
            const id=randomUUID();
            const saved=await captureNarrativeAttempt({message,selected,narrativeId:id,prompt,
              onCapture(attempt){c.narrative_attempts.push(attempt);save();}});
            const reopened=await (await request('/project/runs/'+c.runId+'/narratives/'+id)).json();
            assert.deepEqual(reopened,saved);
            assert.equal(reopened.assessment.dominance.status,'supported_by_partition_scores');
            assert.equal(reopened.assessment.prose,'not_semantically_verified');
            c.narratives.push({id,record:reopened});
          }save();
        },
        verify(model,tools){
          c.tools=tools;
          assert.deepEqual(model,selected.model);
          for(const [name] of actions)assert(success(tools,name),'missing original tool '+name);
        }
      }});
      c.finalText=result.output;
      assert(c.narratives.length>0,'no saved narrative');
      c.status='PASS';
    }catch(e){c.status='REOPEN_OR_NARRATIVE_FAILED';c.error=err(e);}
    save();
  }
  const a=report.cases.find(c=>c.name==='maibab-control'),b=report.cases.find(c=>c.name==='maibab-perturbed');
  if(a?.evidence&&b?.evidence){
    const by=new Map(b.evidence.loops.map(l=>[cycleKey(l),l]));
    const same=a.evidence.loops.length===by.size&&a.evidence.loops.every(l=>by.has(cycleKey(l)));
    const reactivated=a.evidence.loops.filter(l=>a.zeroCycles.includes(cycleKey(l))&&
      by.get(cycleKey(l))?.signed?.some(x=>Number.isFinite(x)&&x!==0)).map(l=>({cycle:l.cycle,
        controlMax:0,perturbedMax:Math.max(...by.get(cycleKey(l)).signed.filter(Number.isFinite).map(Math.abs))}));
    report.pair={sameStructuralCycles:same,reactivated,
      baselineAvailability:a.run?.series.food_availability,perturbedAvailability:b.run?.series.food_availability};
  }
  // Keep actual numeric/transport failures visible instead of adapting fixtures.
  report.complete=report.cases.every(c=>c.status==='PASS'&&c.cycleCountMatches)&&
    report.pair?.sameStructuralCycles===true&&report.pair.reactivated.length===3;
  save();
  console.log('FULL_LTM_MATRIX '+JSON.stringify({mode:report.mode,complete:report.complete,
    cases:report.cases.map(c=>({name:c.name,status:c.status,cycles:c.cycleCount,samples:c.samples,
      checked:c.assessment?.dominance?.checkedSamples,calls:c.providerCalls?.length,error:c.error})),
    reactivated:report.pair?.reactivated.length}));
  assert.equal(report.complete,true,'LTM matrix has failures; see preserved report');
}

export function matrixReport(path,socket){
  const report={mode:socket?'real_workers_ai_http_via_host_broker':'controlled_provider',
    semantic_verdict:'NOT_EVALUATED',production_deployed:false,cases:[]};
  return {report,save:()=>writeFileSync(path,JSON.stringify(report,null,2))};
}
