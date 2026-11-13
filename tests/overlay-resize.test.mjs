import test from 'node:test';
import assert from 'node:assert/strict';
import { OverlayResizeGesture } from '../src/main/platform/overlay-resize.ts';

test('resize changes size only during an explicit primary-button gesture', () => {
  const gesture = new OverlayResizeGesture();
  const bounds = { x: 100, y: 100, width: 440, height: 360 };
  const screen = { x: 0, y: 0, width: 1920, height: 1080 };
  assert.equal(gesture.update({ x: 600, y: 500 }, 1, screen), null);
  gesture.begin({ x: 540, y: 460 }, bounds);
  assert.deepEqual(gesture.update({ x: 600, y: 500 }, 1, screen), { width: 500, height: 400 });
  assert.equal(gesture.update({ x: 650, y: 550 }, 0, screen), null);
  assert.equal(gesture.update({ x: 700, y: 600 }, 1, screen), null);
});

test('ending or cancelling a resize prevents later pointer movement changing the window', () => {
  const gesture = new OverlayResizeGesture();
  const bounds = { x: -800, y: 100, width: 440, height: 360 };
  const screen = { x: -1920, y: 0, width: 1920, height: 1080 };
  gesture.begin({ x: -360, y: 460 }, bounds);
  gesture.end();
  assert.equal(gesture.update({ x: -200, y: 600 }, 1, screen), null);
  gesture.begin({ x: -360, y: 460 }, bounds);
  assert.deepEqual(gesture.update({ x: -700, y: 200 }, 1, screen), { width: 380, height: 240 });
});
