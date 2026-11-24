export const ARM_WINDOW_MS=22*60_000;
export const OBSERVE_GRACE_MS=4*60_000;
export const CLEANUP_WAIT_MS=17*60_000;
export const EXPIRED='1970-01-01T00:00:00.000Z';
export function validArmExpiry(value,now=Date.now()){
 const end=typeof value==='string'?Date.parse(value):NaN;
 return Number.isFinite(end)&&end>now&&end-now<=ARM_WINDOW_MS;
}
export const armExpiry=(now=Date.now())=>new Date(now+ARM_WINDOW_MS).toISOString();
export function observationDeadline(expires){
 const end=Date.parse(expires);
 if(!Number.isFinite(end)||end<=0)throw Error('R1_BAD_OBSERVATION_EXPIRY');
 return end+OBSERVE_GRACE_MS;
}
