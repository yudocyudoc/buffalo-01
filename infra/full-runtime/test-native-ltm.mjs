import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {digest} from './provider-wire.mjs';
import {openNativeLtmRun} from './native-ltm-client.mjs';
import {session} from './test-session.mjs';

export async function seedNativeLtm(request,other) {
  const records=[];
  let etag;
  for (const name of ['armsRace','maibab']) {
    const fixture=JSON.parse(readFileSync(new URL('../../evals/categories/feedbackExplanationData/'+name+'.json',import.meta.url)));
    const model=fixture.model;
    model.specs.integrationMethod=name==='maibab'?'RK4':'Euler';
    if (name==='maibab') model.specs.saveStep=1;
    const saved=await request('/project/model',{method:'PUT',headers:etag?{'if-match':etag}:{'if-none-match':'*'},body:JSON.stringify(model)});
    assert.equal(saved.status,etag?204:201);
    etag=saved.headers.get('etag');
    const identity={revision:JSON.parse(etag),model_sha256:saved.headers.get('x-buffalo-model-sha256')};
    const id=randomUUID(), path='/project/runs/'+id+'/ltm';
    const init={method:'PUT',body:JSON.stringify(identity)};
    assert.equal((await other(path,init)).status,404);
    assert.equal((await request(path,{...init,body:JSON.stringify({...identity,model_sha256:'0'.repeat(64)})})).status,409);
    assert.equal((await request(path,init)).status,201,name+' native simulation');
    assert.equal((await request(path,init)).status,204);
    const original=await (await request(path)).text();
    const data=JSON.parse(original);
    assert.equal(data.time.length,name==='maibab'?491:401);
    assert.equal(data.loops.length,name==='maibab'?10:3);
    assert.equal(new Set(data.loops.map(l=>l.partition)).size,1);
    assert.equal(data.loops.filter(l=>l.signed.every(x=>x===0)).length,name==='maibab'?3:0);
    if (name==='maibab') {
      assert.deepEqual(data.links.filter(e=>e.from==='food_availability' && e.raw?.every(x=>x===0))
        .map(e=>e.to).sort(),['deer_growth_fraction','food_consumption_per_deer']);
    }
    records.push({id,name,hash:await digest(original)});
  }
  return records;
}

export async function reopenNativeLtm(request,other,key,records,useProvider) {
  for (const {id,name,hash} of records) {
    const selected=await openNativeLtmRun(request,id);
    assert.equal(selected.feedback.source.evidence_sha256,hash);
    assert.equal(await digest(await (await request('/project/runs/'+id+'/ltm')).text()),hash);
    assert.equal((await other('/project/runs/'+id+'/ltm')).status,404);
    await assert.rejects(selected.clientRequest({type:'feedback_request',runIds:[randomUUID()]}));
    const {content}=selected.feedback;
    assert.equal(content.feedbackLoops.filter(l=>l.activity==='zero_on_saved_grid').length,name==='maibab'?3:0);
    let turn=0,narrated=0;
    const actions=[['get_feedback_information',{runIds:[id]}],
      ['get_variable_data',{runIds:[id],variableNames:[name==='maibab'?'Deer Population':'Our Weapons'],detailed:false}],
      ['generate_ltm_narrative',{difficulty:'normal',parameters:{runIds:[id],problemStatement:'Explain the saved run.'}}]];
    useProvider((model,wire)=>{
      let message={role:'assistant'};
      if (wire.response_format) {
        const input=JSON.parse(wire.messages.find(m=>m.role==='assistant').content);
        assert.deepEqual(input.feedbackLoops,content.feedbackLoops);
        assert.deepEqual(input.dominantLoopsByPeriod,content.dominantLoopsByPeriod);
        const narrativeMarkdown='Analysis of the saved Simlin run.';
        message.content=JSON.stringify({feedbackLoops:content.feedbackLoops.map(loop=>({
          identifier:loop.identifier,name:'Loop '+loop.identifier,description:loop.activity})),narrativeMarkdown});
        narrated++;
      } else if (turn<actions.length) {
        const [tool,args]=actions[turn++];
        assert(wire.tools.some(t=>t.function.name===tool),tool);
        message.tool_calls=[{type:'function',id:'native-'+turn,function:{name:tool,arguments:JSON.stringify(args)}}];
      } else message.content='Saved analysis recovered.';
      return {model,usage:{prompt_tokens:50,completion_tokens:20},choices:[{index:0,
        finish_reason:message.tool_calls?'tool_calls':'stop',message}]};
    });
    await session({key,mode:'sfd',agent:'merlin',edit:true,model:selected.model,scenario:{
      readOnly:true,message:'Explain the feedback in the saved run '+id,clientRequest:selected.clientRequest,
      verify(model,tools){
        assert.deepEqual(model,selected.model);
        for(const [name] of actions) assert(tools.some(t=>t.event==='tool_call_completed'&&t.name===name&&!t.isError),name);
      }}});
    assert.equal(narrated,1);
  }
  console.log('FULL_NATIVE_SIMLIN_ARMS_RACE_MAIBAB_REOPENED_ORIGINAL_MERLIN_TOOLS');
}
