import {MODEL,validCommit,validRun} from '../buffalo-r2/receipt.mjs';

export {MODEL};
export const DENIED = 'buffalo_stage3_provider_denied';
export const CONFIG_HASH = '3a7e3a6eb20c192e7aa1d4a44cf8ebf000df225738872d3475fb1c7869068d16';
export const MODEL_IDS = ['@cf/thinkingmachines/inkling-2-small','@cf/google/gemma-4-26b-a4b-it'];
export const ENDPOINT = 'http://merlin-provider.internal/v1/chat/completions';
export const PROJECT = 'arena-igc';
export const elapsedLimit = 90_000;
export const requireThat = (ok, reason) => { if (!ok) throw Error(reason); };
export const digest = async text => Array.from(new Uint8Array(await crypto.subtle.digest(
  'SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2,'0')).join('');

export function grant(env, phase) {
  const g = JSON.parse(env.MERLIN_GRANT ?? 'null');
  requireThat(g && ['R','I'].includes(phase) && g.phase === phase && validRun(g.task_id)
    && g.project_id === PROJECT && g.model_sha256 === MODEL && validCommit(g.source_commit)
    && /^sha256:[0-9a-f]{64}$/.test(g.image_digest) && Number.isSafeInteger(g.expires)
    && g.expires > Date.now() && g.expires <= Date.now()+22*60_000, 'NO_CURRENT_GRANT');
  if (phase === 'I') {
    requireThat(MODEL_IDS.includes(g.provider_model) && g.max_posts === 1 &&
      Number.isInteger(g.max_output_tokens) && g.max_output_tokens > 0 && g.max_output_tokens <= 2048 &&
      Number.isInteger(g.max_input_bytes) && g.max_input_bytes > 0 && g.max_input_bytes <= 131072,
      'MISSING_INFERENCE_LIMITS');
  }
  return g;
}

export function checkTaskKey(key) {
  requireThat(key?.project_id === PROJECT && validRun(key.task_id) && ['R','I'].includes(key.phase),
    'INVALID_TASK_KEY');
}

export async function checkInput(input) {
  checkTaskKey(input);
  requireThat(input.model_sha256 === MODEL && typeof input.sd_json === 'string' &&
    input.sd_json.length <= 60000 && await digest(input.sd_json) === MODEL, 'MODEL_VERSION_MISMATCH');
  return JSON.parse(input.sd_json);
}

// Both ends independently derive every permissible client frame from native server events.
// The private origin consumes each expected frame once before forwarding it to Buffalo.
export class Turn {
  constructor(phase, model) {
    requireThat(['R','I'].includes(phase), 'INVALID_PHASE');
    this.phase = phase;
    this.model = model;
    this.state = 'created';
    this.frames = [];
  }
  onNative(m) {
    const same = m.sessionId === this.session;
    const type = m.type;
    const sessionId = m.sessionId;
    requireThat(this.frames.length < 12, 'TOO_MANY_FRAMES');
    this.frames.push(type);
    switch (this.state) {
      case 'created':
        requireThat(type === 'session_created' && /^sess_[a-f0-9]{32}$/.test(sessionId), 'EXPECTED_SESSION');
        this.session = sessionId;
        this.state = 'ready';
        return {type:'initialize_session',clientProduct:'Arena IGC',clientVersion:'1.0.0',
          mode:'sfd',model:this.model,tools:[],supportsArrays:true,supportsModules:false,supportsSubTypes:false};
      case 'ready':
        requireThat(same && type === 'session_ready','EXPECTED_READY');
        this.state = 'selected';
        return {type:'select_agent',sessionId,agentId:'merlin',provider:this.phase==='R'?DENIED:'cloudflare'};
      case 'selected':
        requireThat(same && type === 'agent_selected' && m.agentId === 'merlin' &&
          m.currentProvider === (this.phase === 'R'?DENIED:'cloudflare'), 'EXPECTED_MERLIN');
        this.state = 'welcome';
        break;
      case 'welcome':
        requireThat(same && type === 'agent_text' && m.isThinking === false &&
          /^Merlin \([^\r\n]+\) — What can I do for you today\?$/.test(m.content), 'EXPECTED_HANDLER_WELCOME');
        this.state = 'sync';
        return {type:'chat',sessionId,message:this.phase === 'R' ? 'List the stocks in the initial model.' :
          'List the stocks, flows and main equations in this SD-JSON. Use only this model.\n'+JSON.stringify(this.model)};
      case 'sync':
        requireThat(same && type === 'get_current_model' && typeof m.requestId === 'string' &&
          m.requestId.length > 0 && m.requestId.length <=128,'EXPECTED_MODEL_READ');
        this.state = 'answer';
        return {type:'tool_call_response',sessionId,callId:m.requestId,result:this.model,isError:false};
      case 'answer':
        requireThat(same, 'SESSION_MISMATCH');
        if (this.phase === 'R') {
          requireThat(type === 'error' && m.errorCode === 'CONVERSATION_ERROR' &&
            m.error === 'Unknown combination: provider='+DENIED+', loop=sdk', 'EXPECTED_NATIVE_DENIAL');
        } else {
          requireThat(type === 'agent_text' && m.isThinking === false && typeof m.content === 'string' &&
            m.content.trim() && m.content.length <= 24000,'EXPECTED_GENERATED_ANSWER');
          this.output = m.content;
        }
        this.state = 'complete';
        break;
      case 'complete':
        requireThat(same && type === 'agent_complete' && m.status === (this.phase==='R'?'awaiting_user':'success'),
          'EXPECTED_NATIVE_COMPLETION');
        this.state = 'disconnect';
        return {type:'disconnect',sessionId};
      default:
        throw Error('FRAME_AFTER_COMPLETION');
    }
  }
}
