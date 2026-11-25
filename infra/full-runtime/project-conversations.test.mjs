import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validConversation,validTurn,validConversationEvent} from './project-conversations.mjs';

const identity={revision:2,model_sha256:'a'.repeat(64)};
test('conversation metadata retains original supported mode and agent, rejects credential fields',()=>{
 assert(validConversation({mode:'sfd',agent:'merlin',provider:'cloudflare'}));
 assert(validConversation({mode:'cld',agent:'athena_CLD',provider:'cloudflare'}));
 for(const input of [{mode:'cld',agent:'themis',provider:'cloudflare'},{mode:['cld'],agent:'merlin',provider:'cloudflare'},{mode:'sfd',agent:'merlin',provider:'cloudflare',authenticationKey:'forbidden'}])assert(!validConversation(input));
});
test('turn requires actual runtime session ID, bounded user text and revision identity',()=>{
 const value={runtime_session_id:'sess_'+'a'.repeat(32),message:'Compare runs.',...identity};
 assert(validTurn(value));
 for(const patch of [{revision:0},{model_sha256:'bad'},{runtime_session_id:'bad'},{message:''},{message:'x'.repeat(24001)},{authenticationKey:'forbidden'}])assert(!validTurn({...value,...patch}));
});
test('journal event allowlist rejects raw frames and distinguishes completion from pending',()=>{
 const start={type:'tool_started',call_id:'one',tool_name:'run_model'};
 assert(validConversationEvent(start));
 assert(validConversationEvent({...start,arguments:{}}));
 assert(validConversationEvent({...start,type:'tool_completed',is_error:false,result:{runId:'one'}}));
 assert(!validConversationEvent({...start,type:'tool_completed'}));
 assert(validConversationEvent({type:'model_accepted',request_id:'request',...identity}));
 assert(validConversationEvent({type:'completed',...identity}));
 assert(validConversationEvent({type:'interrupted',reason:'reconciled_after_restart'}));
 assert(!validConversationEvent({type:'interrupted',reason:'retry'}));
 assert(!validConversationEvent({type:'assistant_text',content:'thinking',isThinking:true}));
 assert(!validConversationEvent({type:'initialize_session',authenticationKey:'forbidden'}));
});
