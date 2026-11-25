// Original WebSocket protocol shared by the offline and remote integration clients.
const check=(ok,reason)=>{if(!ok)throw Error(reason)};
export function assertDemand(model,equation){
 const values=model?.variables?.filter(v=>v.name==='Demand').map(v=>v.equation);
 check(Array.isArray(values)&&values.length===1&&values[0]===equation,'UNEXPECTED_DEMAND');
}
export function readSession(ws,{mode,key,model,agent,edit=false,save,tools=[],deadline=Date.now()+45000}){
 if(edit)assertDemand(model,'3');
 return new Promise((resolve,reject)=>{
  let id,stage='created',queue=Promise.resolve(),done=false,updated=0,output=null;
  const finish=error=>{
   if(done)return;done=true;clearTimeout(timer);
   for(const [type,listener] of [['message',message],['error',fail],['close',closed]])ws.removeEventListener(type,listener);
   if(error){try{ws.close(1008,'SESSION_FAILED')}catch{}reject(error)}
   else resolve({session_id:id,updated,output,tools});
  };
  const send=(type,body={})=>ws.send(JSON.stringify({type,sessionId:id,...body}));
  const dispatch=async event=>{
   check(!done&&Date.now()<deadline&&typeof event.data==='string'&&event.data.length<=262144,'INVALID_WS_FRAME');
   const m=JSON.parse(event.data);
   if(id)check(m.sessionId===id,'SESSION_MISMATCH');
   switch(m.type){
    case 'session_created':
     check(stage==='created'&&/^sess_[a-f0-9]{32}$/.test(m.sessionId),'EXPECTED_SESSION');
     id=m.sessionId;stage='initializing';
     send('initialize_session',{authenticationKey:key,clientProduct:'SD-AI integration',clientVersion:'1.0',clientId:'full-runtime-test',mode,model,tools:[]});break;
    case 'session_ready':{
     check(stage==='initializing','EXPECTED_READY');
     const expected=mode==='sfd'?['athena_SFD','merlin','socrates','themis']:['athena_CLD','merlin','socrates'];
     check(JSON.stringify(m.availableAgents.filter(a=>a.supportedModes.includes(mode)).map(a=>a.id).sort())===JSON.stringify(expected),'AGENT_CATALOG');
     const selected=m.availableAgents.find(a=>a.id===agent);check(selected,'AGENT_MISSING');
     stage='selecting';send('select_agent',{agentId:agent,provider:edit?'cloudflare':selected.supportedProviders[0].id});break;
    }
    case 'agent_selected':
     check(stage==='selecting'&&m.agentId===agent,'AGENT_SELECTION');
     if(edit){stage='chat';send('chat',{message:'Change the equation for Demand from 3 to 5.'})}
     else{stage='disconnect';send('disconnect')}break;
    case 'get_current_model':
     check(stage==='chat','UNEXPECTED_MODEL_REQUEST');
     send('tool_call_response',{callId:m.requestId,result:model,isError:false});break;
    case 'update_model':
     check(stage==='chat'&&typeof save==='function','UNEXPECTED_UPDATE');
     await save(m.modelData);model=m.modelData;updated++;
     send('tool_call_response',{callId:m.requestId,result:model,isError:false});break;
    case 'tool_call_notification':
    case 'tool_call_completed':
     check(tools.length<256,'TOOL_TRACE_LIMIT');
     tools.push({event:m.type,callId:m.callId,name:m.toolName,isError:m.isError});break;
    case 'agent_text':
     if(stage==='chat'&&!m.isThinking&&typeof m.content==='string')output=m.content.slice(0,24000);
     break;
    case 'agent_complete':
     check(stage==='chat'&&m.status==='success','AGENT_NOT_SUCCESS');
     assertDemand(model,'5');check(updated>0,'MODEL_NOT_UPDATED');
     stage='disconnect';send('disconnect');break;
    case 'error':throw Error('ORIGINAL_AGENT_ERROR');
   }
  };
  const message=event=>{queue=queue.then(()=>dispatch(event)).catch(finish)};
  const fail=()=>finish(Error('WS_ERROR'));
  const closed=event=>{queue.then(()=>finish(event.code===1000&&stage==='disconnect'?null:Error('WS_INCOMPLETE')),finish)};
  const timer=setTimeout(()=>finish(Error('WS_TIMEOUT')),Math.max(0,deadline-Date.now()));
  ws.addEventListener('message',message);ws.addEventListener('error',fail);ws.addEventListener('close',closed);ws.accept?.();
 });
}
