import {elapsedLimit,requireThat,Turn} from './protocol.mjs';

export function readTurn(ws,phase,model,deadline) {
  return new Promise((resolve,reject)=>{
    const turn=new Turn(phase,model);
    const finish=error=>{
      clearTimeout(timer);
      ws.removeEventListener('message',message);
      ws.removeEventListener('error',fail);
      ws.removeEventListener('close',closed);
      if(error){try{ws.close(1008,'TURN_FAILED');}catch{} reject(error);}
      else resolve({session_id:turn.session,frames:turn.frames,output:turn.output ?? null});
    };
    const message=event=>{
      try{
        requireThat(Date.now()<deadline && typeof event.data==='string' && event.data.length<=262144,'WS_INVALID');
        const reply=turn.onNative(JSON.parse(event.data));
        if(reply)ws.send(JSON.stringify(reply));
      }catch(e){finish(e);}
    };
    const fail=()=>finish(Error('WS_ERROR'));
    const closed=event=>finish(event.code===1000 && turn.state==='disconnect'?null:Error('WS_INCOMPLETE'));
    const timer=setTimeout(()=>finish(Error('WS_TIMEOUT')),Math.min(elapsedLimit,Math.max(0,deadline-Date.now())));
    ws.addEventListener('message',message);
    ws.addEventListener('error',fail);
    ws.addEventListener('close',closed);
    ws.accept?.();
  });
}
