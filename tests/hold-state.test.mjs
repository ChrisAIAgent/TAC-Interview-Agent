import test from 'node:test';
import assert from 'node:assert/strict';
import { initialHoldState, updateHold, mayReveal, isCurrentReveal } from '../src/main/platform/hold-state.ts';
test('requires B mode, readiness, arming and a real press', () => {
 let s=updateHold(initialHoldState,{type:'mode',mode:'full-screen'});
 s=updateHold(s,{type:'combo',pressed:true}); assert.equal(mayReveal(s),false);
 s=updateHold(s,{type:'ready',ready:true,armed:true}); s=updateHold(s,{type:'combo',pressed:true}); assert.equal(mayReveal(s),true);
});
test('release, mode switch and listener failure invalidate delayed reveal', () => {
 let s=updateHold(initialHoldState,{type:'mode',mode:'full-screen'});
 s=updateHold(s,{type:'ready',ready:true,armed:true}); s=updateHold(s,{type:'combo',pressed:true}); const ticket=s.version;
 for (const ev of [{type:'combo',pressed:false},{type:'mode',mode:'unknown'},{type:'reset'},{type:'ready',ready:false,armed:false}]) {
   const next=updateHold(s,ev); assert.equal(isCurrentReveal(next,ticket),false); assert.equal(mayReveal(next),false);
 }
});
test('reset requires fresh arming; switching to B cannot revive old hold', () => {
 let s=updateHold(initialHoldState,{type:'mode',mode:'full-screen'});
 s=updateHold(s,{type:'ready',ready:true,armed:true}); s=updateHold(s,{type:'combo',pressed:true});
 s=updateHold(s,{type:'reset'}); s=updateHold(s,{type:'combo',pressed:true}); assert.equal(mayReveal(s),false);
 s=updateHold(s,{type:'ready',ready:true,armed:true}); s=updateHold(s,{type:'combo',pressed:true}); assert.equal(mayReveal(s),true);
 s=updateHold(s,{type:'mode',mode:'tab-or-window'}); s=updateHold(s,{type:'mode',mode:'full-screen'}); assert.equal(mayReveal(s),false);
});
