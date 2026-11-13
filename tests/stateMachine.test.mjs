import test from 'node:test';
import assert from 'node:assert/strict';
import { transition } from '../src/renderer/src/session/stateMachine.ts';

const cases = [
  ['idle','START','preparing','prepare'], ['preparing','PREPARE_OK','ready',null],
  ['preparing','PERMISSION_DENIED','failed','showPermissionError'], ['preparing','NO_AUDIO_SOURCE','failed','showNoAudioSource'],
  ['preparing','ASR_CONNECT_FAILED','failed','showAsrError'], ['listening','QUESTION_DETECTED','answering','startAnswer'],
  ['answering','FIRST_TOKEN','answering','markStreaming'], ['answering','STREAM_END','listening','finishAnswer'],
  ['answering','NEXT_QUESTION','answering','interruptAndAnswer'], ['answering','STREAM_ERROR','listening','markAnswerError'],
  ['listening','AUDIO_LOST','reconnecting','reconnect'], ['reconnecting','AUDIO_RESTORED','listening','resetReconnect'],
  ['listening','ASR_SOCKET_CLOSED','reconnecting','reconnectAsr'], ['reconnecting','ASR_RECONNECTED','listening','resetAsrReconnect'],
  ['reconnecting','RETRY_EXHAUSTED','failed','showReconnectError'], ['listening','PAUSE','paused','pauseCaptureAndStream'],
  ['answering','PAUSE','paused','pauseCaptureAndStream'], ['paused','RESUME','listening','resumeCapture'],
];
test('all specified transitions produce phase and effect', () => {
  for (const [phase, event, next, effect] of cases) assert.deepEqual(transition(phase, event), { phase: next, effects: effect ? [effect] : [] });
});
test('begin starts capture and pacer', () => assert.deepEqual(transition('ready', 'BEGIN'), { phase: 'listening', effects: ['startCapture', 'startPacer'] }));
test('switches ASR and LLM from every phase', () => {
  for (const phase of ['idle','preparing','ready','listening','answering','paused','reconnecting','stopped','failed']) {
    assert.deepEqual(transition(phase, 'SWITCH_ASR'), { phase: 'preparing', effects: ['switchAsr'] });
    assert.deepEqual(transition(phase, 'SWITCH_LLM'), { phase, effects: ['switchLlmForNextAnswer'] });
  }
});
test('stop works from every phase and is idempotent', () => {
  for (const phase of ['idle','preparing','ready','listening','answering','paused','reconnecting','failed']) assert.deepEqual(transition(phase, 'STOP'), { phase: 'stopped', effects: ['releaseAndSave'] });
  assert.deepEqual(transition('stopped', 'STOP'), { phase: 'stopped', effects: [] });
});
test('invalid events do not change the phase', () => assert.deepEqual(transition('idle', 'BEGIN'), { phase: 'idle', effects: [] }));
