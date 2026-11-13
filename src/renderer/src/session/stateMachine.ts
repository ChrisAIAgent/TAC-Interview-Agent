/** Pure phase transitions. Effects are descriptions for an eventual runtime to execute. */
export type SessionPhase = 'idle' | 'preparing' | 'ready' | 'listening' | 'answering' | 'paused' | 'reconnecting' | 'stopped' | 'failed';
export type SessionEvent = 'START' | 'PREPARE_OK' | 'PERMISSION_DENIED' | 'NO_AUDIO_SOURCE' | 'ASR_CONNECT_FAILED' | 'BEGIN' | 'QUESTION_DETECTED' | 'FIRST_TOKEN' | 'STREAM_END' | 'NEXT_QUESTION' | 'STREAM_ERROR' | 'AUDIO_LOST' | 'ASR_SOCKET_CLOSED' | 'AUDIO_RESTORED' | 'ASR_RECONNECTED' | 'RETRY_EXHAUSTED' | 'PAUSE' | 'RESUME' | 'SWITCH_ASR' | 'SWITCH_LLM' | 'STOP';
export type SessionEffect = 'prepare' | 'showPermissionError' | 'showNoAudioSource' | 'showAsrError' | 'startCapture' | 'startPacer' | 'startAnswer' | 'markStreaming' | 'finishAnswer' | 'interruptAndAnswer' | 'markAnswerError' | 'reconnect' | 'reconnectAsr' | 'resetReconnect' | 'resetAsrReconnect' | 'showReconnectError' | 'pauseCaptureAndStream' | 'resumeCapture' | 'switchAsr' | 'switchLlmForNextAnswer' | 'releaseAndSave';
export interface Transition { phase: SessionPhase; effects: readonly SessionEffect[] }

type TransitionMap = Partial<Record<SessionPhase, Partial<Record<SessionEvent, Transition>>>>;
const transitions: TransitionMap = {
  idle: { START: { phase: 'preparing', effects: ['prepare'] } },
  preparing: {
    PREPARE_OK: { phase: 'ready', effects: [] },
    PERMISSION_DENIED: { phase: 'failed', effects: ['showPermissionError'] },
    NO_AUDIO_SOURCE: { phase: 'failed', effects: ['showNoAudioSource'] },
    ASR_CONNECT_FAILED: { phase: 'failed', effects: ['showAsrError'] },
  },
  ready: { BEGIN: { phase: 'listening', effects: ['startCapture', 'startPacer'] } },
  listening: {
    QUESTION_DETECTED: { phase: 'answering', effects: ['startAnswer'] },
    AUDIO_LOST: { phase: 'reconnecting', effects: ['reconnect'] },
    ASR_SOCKET_CLOSED: { phase: 'reconnecting', effects: ['reconnectAsr'] },
    PAUSE: { phase: 'paused', effects: ['pauseCaptureAndStream'] },
  },
  answering: {
    FIRST_TOKEN: { phase: 'answering', effects: ['markStreaming'] },
    STREAM_END: { phase: 'listening', effects: ['finishAnswer'] },
    NEXT_QUESTION: { phase: 'answering', effects: ['interruptAndAnswer'] },
    STREAM_ERROR: { phase: 'listening', effects: ['markAnswerError'] },
    PAUSE: { phase: 'paused', effects: ['pauseCaptureAndStream'] },
  },
  reconnecting: {
    AUDIO_RESTORED: { phase: 'listening', effects: ['resetReconnect'] },
    ASR_RECONNECTED: { phase: 'listening', effects: ['resetAsrReconnect'] },
    RETRY_EXHAUSTED: { phase: 'failed', effects: ['showReconnectError'] },
  },
  paused: { RESUME: { phase: 'listening', effects: ['resumeCapture'] } },
};

/** Invalid events are ignored. Global switch and stop events apply in every phase. */
export function transition(phase: SessionPhase, event: SessionEvent): Transition {
  if (event === 'SWITCH_ASR') return { phase: 'preparing', effects: ['switchAsr'] };
  if (event === 'SWITCH_LLM') return { phase, effects: ['switchLlmForNextAnswer'] };
  if (event === 'STOP') return phase === 'stopped' ? { phase, effects: [] } : { phase: 'stopped', effects: ['releaseAndSave'] };
  return transitions[phase]?.[event] ?? { phase, effects: [] };
}
