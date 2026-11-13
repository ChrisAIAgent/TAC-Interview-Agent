import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { KeyListener } from '../src/main/platform/keylistener.ts';
const fixture=fileURLToPath(new URL('./fixtures/fake-listener.cjs',import.meta.url));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(predicate,timeout=2500){ const until=Date.now()+timeout; while(Date.now()<until){if(predicate()) return; await sleep(10)} throw Error('timed out'); }
test('unresponsive listener expires the reveal lease, hides and reports failure',async()=>{
 const statuses=[]; let expired=0; const combos=[];
 const listener=new KeyListener({status:s=>statuses.push(s),combo:p=>combos.push(p),leaseExpired:()=>expired++,displaySleep:()=>{},latency:()=>{}},process.execPath,[fixture]);
 try {
  listener.start(); await waitFor(()=>listener.getState().armed);
  listener.beginLease(); await sleep(180); assert.equal(expired,0);
  listener.child.stdin.write('{"t":"test-freeze"}\n');
  await waitFor(()=>expired===1,1500);
  assert.ok(statuses.some(s=>s.status==='unavailable' && s.reason.includes('心跳超时')));
  assert.ok(combos.includes(false));
 } finally { listener.stop(); }
});
test('native Windows helper starts, answers ping/pulse and exits on stop', {skip:process.platform!=='win32'},async()=>{
 const {spawn}=await import('node:child_process'); const {createInterface}=await import('node:readline');
 const exe=fileURLToPath(new URL('../resources/keylistener/keylistener-win32.exe',import.meta.url));
 const child=spawn(exe,[],{windowsHide:true}); const lines=[]; const rl=createInterface({input:child.stdout});
 rl.on('line',s=>lines.push(JSON.parse(s)));
 try {
  await waitFor(()=>lines.some(m=>m.t==='ready'));
  child.stdin.write('{"t":"ping","seq":23}\n'); child.stdin.write('{"t":"pulse","seq":11}\n');
  await waitFor(()=>lines.some(m=>m.t==='pong'&&m.seq===23)&&lines.some(m=>m.t==='pulse-ack'&&m.seq===11));
  const done=new Promise(resolve=>child.once('exit',resolve)); child.stdin.write('{"t":"stop"}\n'); await Promise.race([done,sleep(1500).then(()=>{throw Error('helper did not stop')})]);
 } finally {rl.close(); if(child.exitCode===null) child.kill();}
});

test('ignores a press event from an earlier listener reset',async()=>{
 const events=[];
 const listener=new KeyListener({status:()=>{},combo:p=>events.push(p),leaseExpired:()=>{},displaySleep:()=>{},latency:()=>{}},process.execPath,[fixture]);
 try { listener.start(); await waitFor(()=>listener.getState().armed); listener.reset(); await waitFor(()=>listener.getState().armed); listener.child.stdin.write('{"t":"test-stale"}\n'); await sleep(80); assert.equal(events.includes(true),false); listener.child.stdin.write('{"t":"test-press"}\n'); await waitFor(()=>events.includes(true)); }
 finally {listener.stop();}
});
test('native state isolates keyboards, ignores repeats and releases on unplug', {skip:process.platform!=='win32'},async()=>{
 const {execFile}=await import('node:child_process'); const {promisify}=await import('node:util');
 const exe=fileURLToPath(new URL('../resources/keylistener/keylistener-win32.exe',import.meta.url));
 const result=await promisify(execFile)(exe,['--self-test']);
 const events=result.stdout.trim().split('\n').map(s=>JSON.parse(s));
 assert.deepEqual(events.map(e=>e.pressed),[true,false,true,false]); assert.equal(events[1].reason,'key-up'); assert.equal(events[3].reason,'device-removed');
});

test('ordinary heartbeat marks an unresponsive helper unavailable after its deadline', {timeout:19000}, async()=>{
 let unavailableAt=0; const start=Date.now();
 const listener=new KeyListener({status:s=>{if(s.status==='unavailable') unavailableAt=Date.now()},combo:()=>{},leaseExpired:()=>{},displaySleep:()=>{},latency:()=>{}},process.execPath,[fixture]);
 try { listener.start(); await waitFor(()=>listener.getState().armed); listener.child.stdin.write('{"t":"test-freeze-all"}\n'); await waitFor(()=>unavailableAt>0,16500); assert.ok(unavailableAt-start>=14500 && unavailableAt-start<16500,`elapsed ${unavailableAt-start}ms`); }
 finally {listener.stop();}
});
