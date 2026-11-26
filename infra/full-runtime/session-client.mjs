// Original WebSocket protocol shared by the offline and remote integration clients.
const check=(ok,reason)=>{if(!ok)throw Error(reason)};
export function assertDemand(model,equation){
 const values=model?.variables?.filter(v=>v.name==='Demand').map(v=>v.equation);
 check(Array.isArray(values)&&values.length===1&&values[0]===equation,'UNEXPECTED_DEMAND');
}
export function readSession(ws,{mode,key,model,agent,edit=false,save,tools=[],scenario=null,journal=null,historicalMessages=null,deadline=Date.now()+45000}){
 if(edit&&!scenario)assertDemand(model,'3');
 if(scenario)check(edit&&typeof scenario.message==='string'&&typeof scenario.verify==='function','INVALID_SCENARIO');
 return new Promise((resolve,reject)=>{
  let id,stage='created',queue=Promise.resolve(),done=false,updated=0,output=null,rawOutput=null,fidelity=null;
  const finish=error=>{
   if(done)return;done=true;clearTimeout(timer);
   for(const [type,listener] of [['message',message],['error',fail],['close',closed]])ws.removeEventListener(type,listener);
   if(error){try{ws.close(1008,'SESSION_FAILED')}catch{}reject(error)}
   else resolve({session_id:id,updated,output,tools,...(scenario?.finalizeOutput?{rawOutput,fidelity}:{})});
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
     send('initialize_session',{authenticationKey:key,clientProduct:'SD-AI integration',clientVersion:'1.0',clientId:'full-runtime-test',mode,model,tools:[],...(scenario?.capabilities??{}),...(historicalMessages?{historicalMessages}:{})});break;
    case 'session_ready':{
     check(stage==='initializing','EXPECTED_READY');
     const expected=mode==='sfd'?['athena_SFD','merlin','socrates','themis']:['athena_CLD','merlin','socrates'];
     check(JSON.stringify(m.availableAgents.filter(a=>a.supportedModes.includes(mode)).map(a=>a.id).sort())===JSON.stringify(expected),'AGENT_CATALOG');
     const selected=m.availableAgents.find(a=>a.id===agent);check(selected,'AGENT_MISSING');
     stage='selecting';send('select_agent',{agentId:agent,provider:edit?'cloudflare':selected.supportedProviders[0].id});break;
    }
    case 'agent_selected':
     check(stage==='selecting'&&m.agentId===agent,'AGENT_SELECTION');
     if(edit){
      stage='chat';const message=scenario?.message??'Change the equation for Demand from 3 to 5.';
      if(journal)await journal.begin(id,message);
      send('chat',{message});
     }
     else{stage='disconnect';send('disconnect')}break;
    case 'get_current_model':
     check(stage==='chat','UNEXPECTED_MODEL_REQUEST');
     send('tool_call_response',{callId:m.requestId,result:model,isError:false});break;
    case 'update_model':
     check(stage==='chat'&&!scenario?.readOnly&&typeof save==='function','UNEXPECTED_UPDATE');
     const saved=await save(m.modelData);
     if(journal)await journal.modelAccepted(m.requestId,saved);
     model=m.modelData;updated++;
     send('tool_call_response',{callId:m.requestId,result:model,isError:false});break;
    case 'feedback_request':
    case 'run_model':
    case 'get_run_info':
    case 'get_variable_data':{
     check(stage==='chat'&&typeof scenario?.clientRequest==='function','UNSUPPORTED_CLIENT_REQUEST');
     const result=await scenario.clientRequest(m,structuredClone(model));
     send('tool_call_response',{callId:m.requestId,result,isError:false});break;
    }
    case 'tool_call_notification':
    case 'tool_call_completed':
     check(tools.length<256,'TOOL_TRACE_LIMIT');
     tools.push({event:m.type,callId:m.callId,name:m.toolName,isError:m.isError});
     if (m.type==='tool_call_completed' && scenario?.onToolCompleted) await scenario.onToolCompleted(m);
     if(journal)await journal.event(m.type==='tool_call_notification'?
       {type:'tool_started',call_id:m.callId,tool_name:m.toolName,...(m.arguments===undefined?{}:{arguments:m.arguments})}:
       {type:'tool_completed',call_id:m.callId,tool_name:m.toolName,is_error:m.isError,...(m.result===undefined?{}:{result:m.result})});
     break;
    case 'agent_text':
     if(stage==='chat'&&!m.isThinking&&typeof m.content==='string'){
      if(scenario?.finalizeOutput){
       // The factual client does not stream or journal unvalidated model text.
       // Only the final non-progress frame is eligible for reference selection.
       if(!m.isProgress)rawOutput=m.content.length<=24000?m.content:null;
      }else{
       output=m.content.slice(0,24000);
       if(journal&&!m.isProgress&&m.content.length)await journal.event({type:'assistant_text',content:m.content});
      }
     }
     break;
    case 'agent_complete':
     check(stage==='chat'&&m.status==='success','AGENT_NOT_SUCCESS');
     if(scenario)await scenario.verify(model,tools);else assertDemand(model,'5');
     if (!scenario?.readOnly) check(updated>0,'MODEL_NOT_UPDATED');
     if(scenario?.finalizeOutput){
      fidelity=await scenario.finalizeOutput(rawOutput);
      check(typeof fidelity?.output==='string'&&fidelity.output.length>0,'INVALID_FINALIZED_OUTPUT');
      output=fidelity.output;
      if(journal)await journal.event({type:'assistant_text',content:output});
     }
     if(journal)await journal.complete();
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
