// AudioWorklet global scope; the browser runs this file directly.
// Each output packet is 100 ms mono PCM S16LE at a verified 16 kHz.
class InterviewPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(1600);
    this.count = 0;
    this.sumSquares = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0 || !channels[0]) return true;
    const length = channels[0].length;
    for (let index = 0; index < length; index += 1) {
      let sample = 0;
      for (const channel of channels) sample += channel[index] || 0;
      sample = Math.max(-1, Math.min(1, sample / channels.length));
      this.samples[this.count++] = sample;
      this.sumSquares += sample * sample;
      if (this.count === 1600) {
        const pcm = new ArrayBuffer(3200);
        const view = new DataView(pcm);
        for (let i = 0; i < 1600; i += 1) {
          const value = this.samples[i];
          view.setInt16(i * 2, Math.round(value * 32767), true);
        }
        const rms = Math.sqrt(this.sumSquares / 1600);
        this.port.postMessage({ pcm, rms }, [pcm]);
        this.count = 0;
        this.sumSquares = 0;
      }
    }
    return true;
  }
}
registerProcessor('interview-pcm', InterviewPcmProcessor);
