/**
 * Stage 3B-7: no-secrets, append-only D1 events. Never starts a DO or Container.
 * Tables are precreated through lab migration 0003; the probe cannot migrate.
 */
export const PROBE_ID='one-shot-private-bridge-v1';
export const SOURCE='a8b1ad0c02d5c3367bd24962e8fd36d277a8135d';
export const HANDOFF='f9c4db4e-aa31-4b2a-921e-201a5a79fd37';

export const FINAL_PHASES=Object.freeze([
 'REAL_BRIDGE_HANDSHAKE_PASS','REAL_BRIDGE_HANDSHAKE_FAILED',
 'PREFLIGHT_FAILED','RPC_FAILED','CLAIM_READ_FAILED',
 'DO_CLAIM_ALREADY_USED','PREPARE_FAILED','HANDSHAKE_FAILED',
 'RECEIPT_FAILED','DIAGNOSTIC_FAILED'
]);
const ALLOWED=new Set([
 'SCHEDULED_ENTERED','CLAIM_READ_REQUESTED','CLAIM_ABSENT',
 'PREFLIGHT_PASSED','RPC_PREPARE_REQUESTED','ORIGIN_READY',
 'WEBSOCKET_REQUESTED','RECEIPT_SAVE_REQUESTED',...FINAL_PHASES
]);
const CODE_PATTERN=/^(?:BRIDGE|PROBE|WS_GATE|ORIGIN|D1)_[A-Z0-9_]{1,75}$/;

export function safeCode(error){
 const raw=String(error?.message??'UNKNOWN');
 return CODE_PATTERN.test(raw)?raw:'UNCLASSIFIED_ERROR';
}

/**
 * Atomic D1 claim BEFORE ANY call to the named origin RPC. A second cron
 * invocation must not run the preflight again or start another Container.
 * Missing meta.changes fails closed rather than assuming admission.
 */
export async function claimScheduledEntry(db) {
 const result=await db.prepare(
  'INSERT INTO buffalo_stage3b7_private_bridge_events '+
  '(probe_id,phase,code) VALUES (?,?,NULL) '+
  'ON CONFLICT(probe_id,phase) DO NOTHING'
 ).bind(PROBE_ID,'SCHEDULED_ENTERED').run();
 if(result?.success!==true||!Number.isInteger(result?.meta?.changes))
  throw Error('BRIDGE_D1_ENTRY_ADMISSION_UNKNOWN');
 if(result.meta.changes!==0&&result.meta.changes!==1)
  throw Error('BRIDGE_D1_ENTRY_ADMISSION_INVALID');
 return result.meta.changes===1;
}
/** No raw errors, credentials, RPC payloads, or model content enter D1. */
export async function markStage(db,phase,code=null){
 if(!ALLOWED.has(phase)||phase==='SCHEDULED_ENTERED')throw Error('BRIDGE_DIAGNOSTIC_BAD_PHASE');
 if(code!==null&&!CODE_PATTERN.test(code)&&code!=='UNCLASSIFIED_ERROR')
  throw Error('BRIDGE_DIAGNOSTIC_BAD_CODE');
 const result=await db.prepare(
  'INSERT INTO buffalo_stage3b7_private_bridge_events '+
  '(probe_id,phase,code) VALUES (?,?,?) '+
  'ON CONFLICT(probe_id,phase) DO NOTHING'
 ).bind(PROBE_ID,phase,code).run();
 if(result?.success!==true)throw Error('BRIDGE_DIAGNOSTIC_D1_WRITE_FAILED');
}
