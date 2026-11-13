import { PcmRingBuffer } from './ringBuffer.ts';
export interface PacerOptions {
  /** Receives one 100 ms PCM16 frame; caller must connect only after user consent. */
  send(frame: Uint8Array): void;
  onOverflow?(droppedBytes: number): void;
  onPauseExpired?(): void;
  onError?(error: unknown): void;
  now?(): number;
  setTimer?(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimer?(timer: ReturnType<typeof setTimeout>): void;
}
/** Schedules one frame per 100 ms; never catches up by sending bursts. */
export class AudioPacer {
  private readonly buffer=new PcmRingBuffer();
  private readonly now: () => number;
  private readonly setTimer: NonNullable<PacerOptions['setTimer']>;
  private readonly clearTimer: NonNullable<PacerOptions['clearTimer']>;
  private timer: ReturnType<typeof setTimeout> | null=null;
  private pauseTimer: ReturnType<typeof setTimeout> | null=null;
  private running=false;
  private paused=false;
  private lastSentAt: number | null=null;
  private readonly options: PacerOptions;
  constructor(options: PacerOptions) {
    this.options=options;
    this.now=options.now ?? (() => performance.now());
    this.setTimer=options.setTimer ?? ((fn,ms) => setTimeout(fn,ms));
    this.clearTimer=options.clearTimer ?? (timer => clearTimeout(timer));
  }
  push(frame: Uint8Array): void {
    if (!this.running || this.paused) return;
    const dropped=this.buffer.push(frame);
    if (dropped) this.options.onOverflow?.(dropped);
  }
  start(): void {
    if (this.running) return;
    this.running=true; this.paused=false; this.lastSentAt=null;
    this.schedule(100);
  }
  pause(): void {
    if (!this.running || this.paused) return;
    this.paused=true;
    if (this.timer !== null) this.clearTimer(this.timer); this.timer=null;
    this.buffer.clear();
    this.pauseTimer=this.setTimer(() => { this.pauseTimer=null; if (this.running && this.paused) this.options.onPauseExpired?.(); },10_000);
  }
  resume(): void {
    if (!this.running || !this.paused) return;
    if (this.pauseTimer !== null) this.clearTimer(this.pauseTimer); this.pauseTimer=null;
    this.paused=false; this.lastSentAt=null; this.schedule(100);
  }
  stop(): void {
    this.running=false; this.paused=false;
    if (this.timer !== null) this.clearTimer(this.timer); this.timer=null;
    if (this.pauseTimer !== null) this.clearTimer(this.pauseTimer); this.pauseTimer=null;
    this.buffer.clear(); this.lastSentAt=null;
  }
  private schedule(delay: number): void { this.timer=this.setTimer(() => this.tick(),delay); }
  private tick(): void {
    this.timer=null;
    if (!this.running || this.paused) return;
    const at=this.now();
    if (this.lastSentAt!==null && at-this.lastSentAt<100) { this.schedule(100-(at-this.lastSentAt)); return; }
    try { this.options.send(this.buffer.readPadded(3200)); }
    catch (error) { this.stop(); this.options.onError?.(error); return; }
    this.lastSentAt=at;
    if (this.running && !this.paused) this.schedule(100);
  }
}
