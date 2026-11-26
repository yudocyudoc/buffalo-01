import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
export const protocol=JSON.parse(readFileSync(new URL('./protocol.json',import.meta.url)));
export const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export function buildWire(capture,config){
 assert(protocol.configs.some(c=>JSON.stringify(c)===JSON.stringify(config)),'Unapproved configuration');
 assert(Array.isArray(capture.messages)&&capture.messages.length>0);
 assert(capture.messages.every(m=>['system','user','assistant'].includes(m.role)&&typeof m.content==='string'));
 assert.equal(capture.schema.type,'object');
 assert.deepEqual([...capture.schema.required].sort(),['feedbackInformationRequired','response']);
 assert.equal(capture.schema.properties.response.type,'string');
 assert.equal(capture.schema.properties.feedbackInformationRequired.type,'boolean');
 // Native run endpoint schema differs for GPT-OSS. Preserve the actual Seldon
 // schema and wrap it in the documented JSON-mode json_schema object; exact
 // provider acceptance remains to be established by the pilot.
 const wire={messages:structuredClone(capture.messages),stream:false,temperature:protocol.temperature,
  [config.limit]:protocol.max_output_tokens,
  response_format:{type:'json_schema',json_schema:{name:'seldon_response',schema:structuredClone(capture.schema),strict:true}},
  ...structuredClone(config.reasoning)};
 const bytes=Buffer.byteLength(JSON.stringify(wire));
 assert(bytes<=1024*1024,'Research request size ceiling exceeded');
 return wire;
}
const integer=n=>Number.isSafeInteger(n)&&n>=0;
export function inspectResult(result,config,schema){
 // Keep raw response separately. The native GPT-OSS API may have a response
 // field instead of OpenAI-style choices; never silently translate a refusal,
 // missing finish reason, missing usage or malformed structured output.
 const choice=Array.isArray(result?.choices)&&result.choices.length===1?result.choices[0]:null;
 const message=choice?.message;
 const native=config.id==='gpt-oss'&&!Object.hasOwn(result??{},'choices');
 const content=native?result?.response:message?.content;
 const finish=native?result?.finish_reason:choice?.finish_reason;
 let parsed=null;
 if(typeof content==='string')try{parsed=JSON.parse(content);}catch{}
 else if(native&&object(content))parsed=content;
 const valid=object(parsed)&&Object.keys(parsed).sort().join(',')==='feedbackInformationRequired,response'&&
  typeof parsed.response==='string'&&typeof parsed.feedbackInformationRequired==='boolean';
 const u=result?.usage;
 const usageValid=integer(u?.prompt_tokens)&&u.prompt_tokens>0&&integer(u?.completion_tokens)&&u.completion_tokens>0&&
  u.completion_tokens<=protocol.max_output_tokens;
 const modelObserved=typeof result?.model==='string'?result.model:null;
 const identity=modelObserved===config.model?'EXACT':modelObserved===null?'UNREPORTED':'DIFFERENT';
 const reasons=[];
 if(!native&&(!choice||message?.role!=='assistant'))reasons.push('INVALID_CHOICES');
 if(message?.refusal||message?.tool_calls?.length||message?.function_call)reasons.push('UNEXPECTED_REFUSAL_OR_TOOL');
 if(!valid)reasons.push('INVALID_SCHEMA');
 if(valid&&!parsed.response.trim())reasons.push('EMPTY_EXPLANATION');
 if(finish!=='stop')reasons.push(finish===undefined?'FINISH_UNREPORTED':'NON_STOP_FINISH');
 if(!usageValid)reasons.push('USAGE_UNVERIFIED');
 if(identity==='DIFFERENT')reasons.push('MODEL_IDENTITY_UNVERIFIED');
 if(identity==='UNREPORTED')reasons.push('MODEL_IDENTITY_UNREPORTED');
 const cost=usageValid?(u.prompt_tokens*config.price[0]+u.completion_tokens*config.price[1])/1e6:null;
 return {status:reasons.length?'REVIEW_REQUIRED':'TRANSPORT_OK',reasons,identity,modelObserved,
  finish:finish??null,usage:u??null,estimated_usd:cost,parsed:valid?parsed:null,semantic_accuracy:'NOT_MEASURED'};
}
