import test from 'node:test';
import assert from 'node:assert/strict';
import { insideDragBar } from '../src/main/platform/overlay-hit-test.ts';
test('drag bar includes the top 32 DIP, including on a negative-coordinate monitor',()=>{
 const bounds={x:-800,y:100,width:440,height:360};
 assert.equal(insideDragBar({x:-799,y:101},bounds),true);
 assert.equal(insideDragBar({x:-361,y:131},bounds),true);
 assert.equal(insideDragBar({x:-361,y:132},bounds),false);
 assert.equal(insideDragBar({x:-360,y:101},bounds),false);
});
