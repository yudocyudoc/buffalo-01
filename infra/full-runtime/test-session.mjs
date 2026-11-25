import assert from 'node:assert/strict';
import {on,once} from 'node:events';
import {WebSocket} from 'ws';

export function assertDemand(model,equation){
  assert.deepEqual(model.variables.filter(v=>v.name==='Demand').map(v=>v.equation),[equation]);
}

export async function session({mode,key,model,agent,edit=false,save}){
  if(edit)assertDemand(model,'3');
  const ws=new WebSocket('ws://127.0.0.1:8793/api/v1');
  const frames=on(ws,'message',{signal:AbortSignal.timeout(45000),close:['close']});
  let id;
  const tools=[];
  const send=(type,body={})=>ws.send(JSON.stringify({type,sessionId:id,...body}));
  try{
    for await(const [bytes] of frames){
      const m=JSON.parse(bytes);
      if(id)assert.equal(m.sessionId,id);
      switch(m.type){
        case 'session_created':
          id=m.sessionId;
          send('initialize_session',{authenticationKey:key,clientProduct:'SD-AI integration',clientVersion:'1.0',
            clientId:'full-runtime-test',mode,model,tools:[]});break;
        case 'session_ready':{
          const expected=mode==='sfd'?['athena_SFD','merlin','socrates','themis']:['athena_CLD','merlin','socrates'];
          assert.deepEqual(m.availableAgents.filter(a=>a.supportedModes.includes(mode)).map(a=>a.id).sort(),expected);
          const selected=m.availableAgents.find(a=>a.id===agent);
          send('select_agent',{agentId:agent,provider:edit?'cloudflare':selected.supportedProviders[0].id});break;
        }
        case 'agent_selected':
          assert.equal(m.agentId,agent);
          if(edit){send('chat',{message:'Change the equation for Demand from 3 to 5.'});break;}
          {const closed=once(ws,'close');send('disconnect');assert.equal((await closed)[0],1000);return;}
        case 'get_current_model':
          send('tool_call_response',{callId:m.requestId,result:model,isError:false});break;
        case 'update_model':
          await save(m.modelData);
          model=m.modelData;
          send('tool_call_response',{callId:m.requestId,result:model,isError:false});break;
        case 'tool_call_notification':
        case 'tool_call_completed':
          tools.push({event:m.type,callId:m.callId,name:m.toolName,isError:m.isError});break;
        case 'agent_complete':{
          assert.equal(m.status,'success');
          if(edit)assertDemand(model,'5');
          const closed=once(ws,'close');send('disconnect');assert.equal((await closed)[0],1000);return;
        }
        case 'error':throw Error(m.error);
      }
    }
    throw Error('early WebSocket close');
  }finally{
    if(edit)console.log(JSON.stringify({event:'FULL_EDIT_TOOLS',tools}));
    await frames.return();ws.terminate();
  }
}
