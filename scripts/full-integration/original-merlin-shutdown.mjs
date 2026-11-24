// Positive evidence is exclusively an IPC shutdown followed by normal exit.
// A forced stop belongs to failure cleanup and cannot return a positive receipt.
export function shutdownOriginalWorker(worker,timeout=5000){
 return new Promise((resolve,reject)=>{
  const finish=(error,value)=>{
   clearTimeout(timer);worker.off('exit',onExit);worker.off('error',onError);
   if(error)reject(error);else resolve(value);
  };
  const onExit=(code,signal)=>{
   if(code!==0||signal!==null)finish(Error('3B8_SHUTDOWN_NOT_NORMAL'));
   else finish(null,{shutdown_ipc_sent:true,worker_exit_code:code,worker_exit_signal:signal});
  };
  const onError=()=>finish(Error('3B8_SHUTDOWN_IPC_ERROR'));
  const timer=setTimeout(()=>finish(Error('3B8_SHUTDOWN_TIMEOUT')),timeout);
  worker.once('exit',onExit);worker.once('error',onError);
  if(!worker.connected){finish(Error('3B8_SHUTDOWN_ALREADY_DISCONNECTED'));return}
  try{worker.send({type:'shutdown'})}catch{finish(Error('3B8_SHUTDOWN_IPC_ERROR'))}
 });
}
