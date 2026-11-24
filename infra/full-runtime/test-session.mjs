import assert from 'node:assert/strict';
import {on,once} from 'node:events';
import {WebSocket} from 'ws';

export async function session({mode,key,model,agent,edit=false,save}){
  const ws=new WebSocket('ws://127.0.0.1:8080/api/v1');
  const frames=on(ws,'message',{signal:AbortSignal.timeout(45000),close:['close']});
  let id,updated=false,confirmed=false;
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
          assert.equal(m.modelData.variables.find(v=>v.name==='Demand').equation,'5');
          model=m.modelData;
          await save(model);
          updated=true;
          send('tool_call_response',{callId:m.requestId,result:model,isError:false});break;
        case 'tool_call_completed':
          assert.equal(m.toolName,'edit_variables');assert.equal(m.isError,false);confirmed=true;break;
        case 'agent_complete':{
          assert.equal(m.status,'success');assert(updated && confirmed);
          const closed=once(ws,'close');send('disconnect');assert.equal((await closed)[0],1000);return;
        }
        case 'error':throw Error(m.error);
      }
    }
    throw Error('early WebSocket close');
  }finally{await frames.return();ws.terminate();}
}
