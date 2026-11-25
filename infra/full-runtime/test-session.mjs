import {WebSocket} from 'ws';
import {readSession,assertDemand} from './session-client.mjs';
export {assertDemand};
export async function session(options){
 const ws=new WebSocket('ws://127.0.0.1:8793/api/v1'),tools=[];
 try{return await readSession(ws,{...options,tools})}finally{
  if(options.edit)console.log(JSON.stringify({event:'FULL_EDIT_TOOLS',tools}));ws.terminate();
 }
}
