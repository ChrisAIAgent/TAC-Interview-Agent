import test from 'node:test';
import assert from 'node:assert/strict';
import { PcmRingBuffer } from '../src/renderer/src/audio/ringBuffer.ts';
import { AudioPacer } from '../src/renderer/src/audio/pacer.ts';
function fakeClock(){
 let current=0, nextId=1; const timers=new Map();
 return {
  now:()=>current,
  setTimer:(fn,ms)=>{const id=nextId++;timers.set(id,{fn,due:current+ms});return id},
  clearTimer:id=>timers.delete(id),
  jump:ms=>{ current+=ms; const due=[...timers].filter(([,t])=>t.due<=current).sort((a,b)=>a[1].due-b[1].due); for(const [id,t] of due) if(timers.delete(id)) t.fn(); }
 };
}
test('ring preserves sample order, discards oldest overflow and pads silence',()=>{
 const ring=new PcmRingBuffer(8); assert.equal(ring.push(Uint8Array.from([1,2,3,4,5,6])),0);
 assert.equal(ring.push(Uint8Array.from([7,8,9,10])),2);
 assert.deepEqual([...ring.readPadded(10)],[3,4,5,6,7,8,9,10,0,0]);
 assert.equal(ring.size,0); assert.throws(()=>ring.push(new Uint8Array(1)),RangeError);
});
test('pacer never catches up with a burst after a delayed timer',()=>{
 const clock=fakeClock(), times=[], packets=[];
 const pacer=new AudioPacer({...clock,send:frame=>{times.push(clock.now());packets.push(frame)}});
 pacer.start(); pacer.push(Uint8Array.from([9,8,7,6])); clock.jump(100); clock.jump(500); clock.jump(1); clock.jump(99);
 assert.deepEqual(times,[100,600,700]); assert.equal(packets.every(x=>x.length===3200),true);
 assert.deepEqual([...packets[0].slice(0,6)],[9,8,7,6,0,0]); assert.equal(packets[1].every(x=>x===0),true); pacer.stop();
});
test('pause suppresses sends, drops buffered audio, and signals the 10-second limit',()=>{
 const clock=fakeClock(); let sent=0, expired=0;
 const pacer=new AudioPacer({...clock,send:()=>sent++,onPauseExpired:()=>expired++});
 pacer.start(); pacer.push(new Uint8Array(3200).fill(1)); pacer.pause(); clock.jump(9999); assert.equal(sent,0); assert.equal(expired,0);
 clock.jump(1); assert.equal(expired,1); pacer.resume(); clock.jump(100); assert.equal(sent,1); pacer.stop(); clock.jump(30000); assert.equal(sent,1);
});
test('overflow callback reports data loss and send failures stop scheduling',()=>{
 const clock=fakeClock(); let drops=0,errors=0;
 const pacer=new AudioPacer({...clock,send:()=>{throw Error('closed')},onOverflow:n=>{drops+=n},onError:()=>errors++});
 pacer.start(); pacer.push(new Uint8Array(100_000)); assert.equal(drops,4000); clock.jump(100); clock.jump(1000); assert.equal(errors,1);
});
