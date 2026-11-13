import test from 'node:test';
import assert from 'node:assert/strict';
import { newTencentResultState, reduceTencentMessage } from '../src/renderer/src/asr/tencent-result.ts';
const body=(index,slice_type,text='你好')=>JSON.stringify({code:0,voice_id:'v1',result:{index,slice_type,voice_text_str:text,start_time:0,end_time:100}});
test('intermediate and final text are distinct; duplicate and older finals are dropped',()=>{
 let state=newTencentResultState('v1'); let result=reduceTencentMessage(state,body(0,1)); assert.equal(result.event.type,'transcript'); assert.equal(result.event.line.isFinal,false);
 result=reduceTencentMessage(result.state,body(0,2)); assert.equal(result.event.line.isFinal,true); state=result.state;
 result=reduceTencentMessage(state,body(0,2)); assert.equal(result.event.type,'ignored'); assert.equal(result.state.dropCount,1);
 result=reduceTencentMessage(result.state,body(1,2)); assert.equal(result.event.line.sentenceIndex,1);
 result=reduceTencentMessage(result.state,body(0,1)); assert.equal(result.event.type,'ignored'); assert.equal(result.state.dropCount,2);
});
test('does not trust stale connection, malformed data or server message text',()=>{
 let state=newTencentResultState('v1'); let result=reduceTencentMessage(state,JSON.stringify({code:0,voice_id:'old'})); assert.equal(result.event.type,'ignored');
 result=reduceTencentMessage(state,'{bad'); assert.equal(result.event.code,'INVALID_MESSAGE');
 result=reduceTencentMessage(state,JSON.stringify({code:4002,message:'secret in remote error'})); assert.equal(result.event.code,4002); assert.equal(result.event.message.includes('secret'),false); assert.equal(result.event.retryable,false);
 result=reduceTencentMessage(state,JSON.stringify({code:4008})); assert.equal(result.event.retryable,true);
});

test('retains a final transcript bundled with the end marker and drops out-of-order partials',()=>{
 let state=newTencentResultState('v1');
 let result=reduceTencentMessage(state,body(2,1)); state=result.state;
 result=reduceTencentMessage(state,body(1,1)); assert.equal(result.event.type,'ignored');
 const last=JSON.parse(body(2,2,'最后一句')); last.final=1;
 result=reduceTencentMessage(result.state,JSON.stringify(last)); assert.equal(result.event.type,'transcript'); assert.equal(result.event.line.text,'最后一句'); assert.equal(result.event.streamEnded,true);
});
