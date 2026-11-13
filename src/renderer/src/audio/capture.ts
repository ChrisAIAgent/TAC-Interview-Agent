/** The buffer is an in-memory PCM S16LE packet; never persist it. */
export interface AudioPacket { pcm: ArrayBuffer; rms: number }
export interface CaptureHandle { stop(): Promise<void> }
export interface CaptureOptions {
  /** URL of the bundled worklet.js asset. */
  workletUrl: string;
  onPacket(packet: AudioPacket): void;
  onEnded?(): void;
}

/** A safe, user-facing capture failure; never exposes platform or provider errors. */
export class SystemAudioCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SystemAudioCaptureError';
  }
}

/**
 * Requests screen loopback (not microphone) from Electron's display-media
 * handler. Called only after a direct user gesture. Capture is local only:
 * this module performs no ASR or network requests.
 */
export async function startSystemAudio(options: CaptureOptions): Promise<CaptureHandle> {
  return startCapture(options, 'system');
}

/** Start only from an explicit user action after explaining cloud transcription. */
export async function startMicrophoneAudio(options: CaptureOptions): Promise<CaptureHandle> {
  return startCapture(options, 'microphone');
}

async function startCapture(options: CaptureOptions, kind: 'system' | 'microphone'): Promise<CaptureHandle> {
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let processor: AudioWorkletNode | undefined;
  let sink: GainNode | undefined;
  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    if (processor) processor.port.onmessage = null;
    source?.disconnect();
    processor?.disconnect();
    sink?.disconnect();
    stream?.getTracks().forEach((track) => track.stop());
    if (context && context.state !== 'closed') await context.close();
  };
  try {
    // getDisplayMedia requires a video track. Release it immediately after grant.
    stream = kind === 'system'
      ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      : await navigator.mediaDevices.getUserMedia({ video: false, audio: { echoCancellation: true, noiseSuppression: true } });
    const audio = stream.getAudioTracks()[0];
    stream.getVideoTracks().forEach((track) => track.stop());
    if (!audio || audio.readyState !== 'live') {
      throw new SystemAudioCaptureError(kind === 'system' ? '没有取得有效的系统音频轨道，或音轨已结束。请检查系统权限、音频设备和当前版本的系统音频支持。' : '没有取得有效的麦克风音轨，请检查麦克风设备和系统权限。');
    }
    context = new AudioContext({ sampleRate: 16000 });
    // Never silently label a different sample rate as 16 kHz.
    if (context.sampleRate !== 16000) throw new SystemAudioCaptureError('当前环境无法创建 16 kHz 音频上下文。');
    await context.audioWorklet.addModule(options.workletUrl);
    if (audio.readyState !== 'live') throw new SystemAudioCaptureError('系统音频轨道已结束，请检查系统权限和音频设备。');
    source = context.createMediaStreamSource(stream);
    processor = new AudioWorkletNode(context, 'interview-pcm', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    sink = context.createGain();
    sink.gain.value = 0;
    processor.port.onmessage = (event: MessageEvent<unknown>) => {
      if (stopped || typeof event.data !== 'object' || event.data === null) return;
      const packet = event.data as { pcm?: unknown; rms?: unknown };
      if (packet.pcm instanceof ArrayBuffer && packet.pcm.byteLength === 3200 && typeof packet.rms === 'number') {
        options.onPacket({ pcm: packet.pcm, rms: packet.rms });
      }
    };
    source.connect(processor);
    processor.connect(sink);
    sink.connect(context.destination);
    await context.resume();
    if (context.state !== 'running') throw new SystemAudioCaptureError('音频上下文未能启动。');
    audio.addEventListener('ended', () => {
      if (!stopped) {
        void stop();
        options.onEnded?.();
      }
    }, { once: true });
    if (audio.readyState !== 'live') throw new SystemAudioCaptureError('系统音频轨道已结束，请检查系统权限和音频设备。');
    return { stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
