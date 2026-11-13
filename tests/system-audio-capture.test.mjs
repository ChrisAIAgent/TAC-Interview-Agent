import test from 'node:test';
import assert from 'node:assert/strict';
import { startSystemAudio, startMicrophoneAudio, SystemAudioCaptureError } from '../src/renderer/src/audio/capture.ts';

function replaceGlobal(t, name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else delete globalThis[name];
  });
}

function track(initialState = 'live') {
  let ended;
  return {
    readyState: initialState,
    stopCount: 0,
    stop() { this.stopCount++; this.readyState = 'ended'; },
    addEventListener(name, listener) { if (name === 'ended') ended = listener; },
    end() { this.readyState = 'ended'; ended?.(); }
  };
}

function stream(audio, video) {
  return {
    getAudioTracks: () => audio ? [audio] : [],
    getVideoTracks: () => [video],
    getTracks: () => audio ? [audio, video] : [video]
  };
}

test('microphone capture requests audio only and rejects an ended input', async t => {
  const audio = track('ended'); let constraints;
  replaceGlobal(t, 'navigator', { mediaDevices: { getUserMedia: async value => { constraints = value; return { getAudioTracks: () => [audio], getVideoTracks: () => [], getTracks: () => [audio] }; } } });
  await assert.rejects(startMicrophoneAudio({ workletUrl:'test.js', onPacket() {} }), /麦克风音轨/);
  assert.equal(constraints.video, false);
  assert.equal(constraints.audio.echoCancellation, true);
  assert.equal(audio.stopCount, 1);
});

test('microphone forwards audio and releases the input when stopped', async t => {
  const audio = track(); let worklet; let context;
  replaceGlobal(t, 'navigator', { mediaDevices: { getUserMedia: async () => ({ getAudioTracks: () => [audio], getVideoTracks: () => [], getTracks: () => [audio] }) } });
  class Node { connect() {} disconnect() {} }
  class FakeContext {
    sampleRate=16000; state='running'; destination={}; audioWorklet={ addModule: async()=>{} };
    constructor(){context=this} createMediaStreamSource(){return new Node()} createGain(){return Object.assign(new Node(),{gain:{value:1}})}
    async resume(){} async close(){this.state='closed'}
  }
  class FakeWorklet extends Node { port={onmessage:null}; constructor(){super();worklet=this} }
  replaceGlobal(t,'AudioContext',FakeContext); replaceGlobal(t,'AudioWorkletNode',FakeWorklet);
  const packets=[]; const handle=await startMicrophoneAudio({workletUrl:'test.js',onPacket:packet=>packets.push(packet)});
  worklet.port.onmessage({data:{pcm:new ArrayBuffer(3200),rms:0.3}});
  assert.equal(packets.length,1);
  await handle.stop(); await handle.stop();
  assert.equal(audio.stopCount,1); assert.equal(context.state,'closed');
});

test('an absent or already-ended audio track fails explicitly and releases video', async t => {
  let currentStream;
  replaceGlobal(t, 'navigator', { mediaDevices: { getDisplayMedia: async () => currentStream } });
  for (const audio of [null, track('ended')]) {
    const video = track();
    currentStream = stream(audio, video);
    await assert.rejects(
      startSystemAudio({ workletUrl: 'test.js', onPacket() {} }),
      error => error instanceof SystemAudioCaptureError && /音频轨道/.test(error.message)
    );
    assert.ok(video.stopCount >= 1);
    if (audio) assert.ok(audio.stopCount >= 1);
  }
});

test('a live track forwards PCM and an ended event releases the capture exactly once', async t => {
  const audio = track(), video = track();
  const input = stream(audio, video);
  replaceGlobal(t, 'navigator', { mediaDevices: { getDisplayMedia: async () => input } });
  let worklet;
  let context;
  class Node {
    connect() {}
    disconnect() {}
  }
  class FakeContext {
    sampleRate = 16000;
    state = 'running';
    audioWorklet = { addModule: async () => {} };
    destination = {};
    constructor() { context = this; }
    createMediaStreamSource() { return new Node(); }
    createGain() { return Object.assign(new Node(), { gain: { value: 1 } }); }
    async resume() {}
    async close() { this.state = 'closed'; }
  }
  class FakeWorklet extends Node {
    port = { onmessage: null };
    constructor() { super(); worklet = this; }
  }
  replaceGlobal(t, 'AudioContext', FakeContext);
  replaceGlobal(t, 'AudioWorkletNode', FakeWorklet);
  const packets = [];
  let ended = 0;
  const handle = await startSystemAudio({ workletUrl: 'test.js', onPacket: p => packets.push(p), onEnded: () => ended++ });
  assert.equal(video.readyState, 'ended');
  worklet.port.onmessage({ data: { pcm: new ArrayBuffer(3200), rms: 0.25 } });
  assert.equal(packets.length, 1);
  assert.equal(packets[0].rms, 0.25);
  audio.end();
  await handle.stop();
  assert.equal(ended, 1);
  assert.equal(audio.stopCount, 1);
  assert.equal(context.state, 'closed');
});
