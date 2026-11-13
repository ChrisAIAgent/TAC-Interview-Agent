import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const emitted = [];
let Processor;
class Base { constructor() { this.port = { postMessage: (value) => emitted.push(value) }; } }
vm.runInNewContext(fs.readFileSync(new URL('../src/renderer/src/audio/worklet.js', import.meta.url), 'utf8'), {
  AudioWorkletProcessor: Base, registerProcessor: (_name, ctor) => { Processor = ctor; }, Float32Array, ArrayBuffer, DataView, Math,
});
test('accumulates 100ms across audio callbacks and encodes signed little-endian PCM', () => {
  const processor = new Processor();
  for (let i = 0; i < 12; i++) processor.process([[new Float32Array(128).fill(0.5)]]);
  assert.equal(emitted.length, 0);
  processor.process([[new Float32Array(128).fill(0.5)]]);
  assert.equal(emitted.length, 1);
  const { pcm, rms } = emitted[0];
  assert.equal(pcm.byteLength, 3200);
  assert.equal(new DataView(pcm).getInt16(0, true), 16384);
  assert.equal(rms, 0.5);
});
test('downmixes stereo, clips and retains remainder between callbacks', () => {
  emitted.length = 0;
  const processor = new Processor();
  processor.process([[new Float32Array(800).fill(1), new Float32Array(800).fill(-1)]]);
  processor.process([[new Float32Array(800).fill(2), new Float32Array(800).fill(2)]]);
  const view = new DataView(emitted[0].pcm);
  assert.equal(view.getInt16(0, true), 0);
  assert.equal(view.getInt16(1600, true), 32767);
  assert.ok(Math.abs(emitted[0].rms - Math.sqrt(0.5)) < 1e-10);
});
