import {readFileSync} from 'node:fs';
import {verifyLaunchContext} from '../buffalo-r2/driver.mjs';

verifyLaunchContext(readFileSync('/proc/self/status','utf8'));
if(process.env.ALLOW_UNSANDBOXED_FALLBACK!=='false' || !process.env.AUTHENTICATION_KEY)
  throw Error('FULL_RUNTIME_REQUIRES_SANDBOX_AND_AUTH');
if(process.env.BUFFALO_PRIVATE_MERLIN_MODEL) await import('../private-merlin/provider.mjs');
