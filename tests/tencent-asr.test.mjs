import test from 'node:test';
import assert from 'node:assert/strict';
import { TencentAsr } from '../src/renderer/src/asr/tencent.ts';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(f,timeout=1500){const end=Date.now()+timeout;while(Date.now()<end){if(f())return;await sleep(5)}throw Error('timeout')}
class FakeSocket extends EventTarget {
  readyState=1; sent=[]; voice;
  constructor(voice,authError=false){super();this.voice=voice;queueMicrotask(()=>this.emit({code:authError?4002:0,voice_id:voice}));}
  emit(value){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(value)}));}
  send(value){this.sent.push(value);if(typeof value==='string' && value.includes('"end"'))queueMicrotask(()=>this.emit({code:0,voice_id:this.voice,final:1}));}
  close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
  disconnect(){this.readyState=3;this.dispatchEvent(new Event('close'));}
}
test('does not connect until started, streams audio after handshake, preserves final and stops',async()=>{
 let signs=0;const sockets=[],results=[],states=[];
 const asr=new TencentAsr({sign:async()=>({url:'wss://asr.cloud.tencent.com/asr/v2/123?signature=fake',voiceId:`v${++signs}`}),socket:()=>{const s=new FakeSocket(`v${signs}`);sockets.push(s);return s;},onResult:r=>results.push(r),onState:s=>states.push(s)});
 assert.equal(signs,0); await asr.init(); assert.deepEqual(states.slice(0,2),['connecting','listening']);
 asr.push(new Uint8Array(3200).fill(7).buffer); await waitFor(()=>sockets[0].sent.some(v=>v instanceof Uint8Array));
 const frame=sockets[0].sent.find(v=>v instanceof Uint8Array); assert.equal(frame.length,3200); assert.equal(frame[0],7);
 sockets[0].emit({code:0,voice_id:'v1',result:{slice_type:2,index:0,start_time:0,end_time:500,voice_text_str:'请介绍项目'}});
 assert.equal(results[0].text,'请介绍项目'); await asr.flush(); assert.equal(states.at(-1),'stopped');
 assert.equal(sockets[0].sent.filter(v=>typeof v==='string'&&v.includes('"end"')).length,1);
});
test('a dropped connection gets a new signed session without switching backend',async()=>{
 let signs=0; const sockets=[],states=[];
 const asr=new TencentAsr({sign:async()=>({url:'wss://asr.cloud.tencent.com/asr/v2/123?signature=fake',voiceId:`v${++signs}`}),wait:async()=>{},socket:()=>{const s=new FakeSocket(`v${signs}`);sockets.push(s);return s;},onState:s=>states.push(s)});
 try {await asr.init();sockets[0].disconnect();await waitFor(()=>sockets.length===2 && states.filter(x=>x==='listening').length===2);assert.equal(signs,2);assert.equal(asr.id,'tencent');}
 finally{asr.dispose();}
});
test('authentication error stops instead of retrying or exposing provider messages',async()=>{
 let signs=0;const errors=[];
 const asr=new TencentAsr({sign:async()=>({url:'wss://asr.cloud.tencent.com/asr/v2/123?signature=fake',voiceId:`v${++signs}`}),socket:()=>new FakeSocket(`v${signs}`,true),onError:e=>errors.push(e),wait:async()=>{}});
 try{await assert.rejects(asr.init());assert.equal(signs,1);assert.equal(errors[0].code,'ASR_AUTH');}finally{asr.dispose();}
});
test('dispose during handshake resolves lifecycle without starting a pacer',async()=>{
 let sock;const states=[];
 const asr=new TencentAsr({sign:async()=>({url:'wss://asr.cloud.tencent.com/asr/v2/123?signature=fake',voiceId:'v1'}),socket:()=>{sock=new FakeSocket('v1');return sock;},onState:s=>states.push(s)});
 const started=asr.init(); asr.dispose(); await started; await sleep(20); assert.equal(states.includes('listening'),false); assert.ok(!sock || sock.sent.length===0);
});
