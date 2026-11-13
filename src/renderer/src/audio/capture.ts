/** The buffer is an in-memory PCM S16LE packet; never persist it. */
export interface AudioPacket { pcm: ArrayBuffer; rms: number }
export interface CaptureHandle { stop(): Promise<void> }
export interface CaptureOptions {
  /** URL of the bundled worklet.js asset. */
  workletUrl: string;
  onPacket(packet: AudioPacket): void;
  onEnded?(): void;
}

/**
 * Requests screen loopback (not microphone) from Electron's display-media
 * handler. Called only after a direct user gesture. Capture is local only:
 * this module performs no ASR or network requests.
 */
export async function startSystemAudio(options: CaptureOptions): Promise<CaptureHandle> {
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
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const audio = stream.getAudioTracks()[0];
    stream.getVideoTracks().forEach((track) => track.stop());
    if (!audio || audio.readyState !== 'live') throw new Error('未获得有效的系统音频流，请检查系统权限与设备。');
    context = new AudioContext({ sampleRate: 16000 });
    // Never silently label a different sample rate as 16 kHz.
    if (context.sampleRate !== 16000) throw new Error('当前环境无法创建 16 kHz 音频上下文。');
    await context.audioWorklet.addModule(options.workletUrl);
    if (audio.readyState !== 'live') throw new Error('系统音频流已结束。');
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
    if (context.state !== 'running') throw new Error('音频上下文未能启动。');
    audio.addEventListener('ended', () => {
      if (!stopped) {
        void stop();
        options.onEnded?.();
      }
    }, { once: true });
    if (audio.readyState !== 'live') throw new Error('系统音频流已结束。');
    return { stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
