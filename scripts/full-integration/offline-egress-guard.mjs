/**
 * Import with: node --import ./scripts/full-integration/offline-egress-guard.mjs ...
 *
 * Early, process-local defensive guard for the stage 3 NO-PROVIDER lab. It is NOT
 * an OS sandbox: CI must run with no provider secrets and no external command.
 * Any attempt through common Node outbound transports makes the trial FAIL,
 * never a simulated success. No production agent files are patched.
 */
import {syncBuiltinESMExports} from 'node:module';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import childProcess from 'node:child_process';

if(globalThis.__BUFFALO_STAGE3_EGRESS__)throw Error('STAGE3_GUARD_DOUBLE_INSTALL');
const attempts=[];
const stop=channel=>(..._args)=>{
 attempts.push(channel);
 throw Error('STAGE3_EXTERNAL_OPERATION_BLOCKED_'+channel);
};
globalThis.fetch=stop('FETCH');
for(const [module,methods,prefix] of [
 [http,['request','get'],'HTTP'],
 [https,['request','get'],'HTTPS'],
 [net,['connect','createConnection'],'NET'],
 [tls,['connect'],'TLS'],
 [dgram,['createSocket'],'DGRAM'],
 [childProcess,['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'],'PROCESS']
]){
 for(const name of methods)module[name]=stop(prefix+'_'+name.toUpperCase());
}
syncBuiltinESMExports();
Object.defineProperty(globalThis,'__BUFFALO_STAGE3_EGRESS__',{
 value:Object.freeze({mode:'BLOCK_ALL_NODE_STANDARD_EGRESS_AND_SUBPROCESSES',
  count:()=>attempts.length,channels:()=>[...attempts]}),
 enumerable:false,configurable:false,writable:false
});
