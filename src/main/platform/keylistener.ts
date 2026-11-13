import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type ListenerStatus = 'disabled' | 'starting' | 'ready' | 'unavailable';
export interface ListenerSnapshot { status: ListenerStatus; reason?: string; sameDevice: boolean; armed: boolean; }
export interface ListenerCallbacks {
  status(value: ListenerSnapshot): void;
  combo(pressed: boolean, eventId?: number): void;
  latency(kind: 'expand' | 'collapse', ms: number): void;
  leaseExpired(): void;
  displaySleep(): void;
}

/** Handles process I/O and health only. It never receives unrelated key events. */
export class KeyListener {
  private child: ChildProcessWithoutNullStreams | null = null;
  private lines: Interface | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private leaseTimer: ReturnType<typeof setInterval> | null = null;
  private leaseDeadline: ReturnType<typeof setTimeout> | null = null;
  private pingDeadline: ReturnType<typeof setTimeout> | null = null;
  private pingSeq = 0; private latestPong = 0; private lastPongAt = 0;
  private pulseSeq = 0; private lastPulseAck = 0; private lastLeaseAt = 0;
  private monitoringLease = false; private generation = 0; private restarts = 0; private epoch = 0;
  private stopping = false; private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshot: ListenerSnapshot = { status: 'disabled', sameDevice: false, armed: false };
  private callbacks: ListenerCallbacks;
  private executable: string;
  private args: readonly string[];
  constructor(callbacks: ListenerCallbacks, executable: string, args: readonly string[] = []) { this.callbacks=callbacks; this.executable=executable; this.args=args; }
  getState(): ListenerSnapshot { return { ...this.snapshot }; }
  private update(next: ListenerSnapshot): void { this.snapshot = next; this.callbacks.status(this.getState()); }
  start(): void {
    if (this.child || this.snapshot.status === 'starting') return;
    this.stopping = false; this.restarts = 0; this.launch();
  }
  private launch(): void {
    if (!existsSync(this.executable)) { this.fail('未找到当前平台的按键监听程序。'); return; }
    const generation = ++this.generation;
    this.update({ status: 'starting', sameDevice: false, armed: false });
    let child: ChildProcessWithoutNullStreams;
    try { child = spawn(this.executable, [...this.args], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { this.fail('按键监听程序启动失败。'); return; }
    this.child = child;
    this.lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.lines.on('line', line => { if (generation === this.generation) this.onLine(line); });
    // Never persist or expose helper stderr: it could include unexpected OS data.
    child.stderr.resume();
    child.stdin.on('error', () => { /* exit/error path handles closed pipe */ });
    child.once('error', () => { if (generation === this.generation) this.onExit('按键监听程序启动失败。'); });
    child.once('exit', () => { if (generation === this.generation) this.onExit('按键监听已断开。'); });
    this.lastPongAt = performance.now(); this.schedulePingDeadline();
    this.pingTimer = setInterval(() => {
      if (performance.now() - this.lastPongAt >= 15_000) { this.onExit('按键监听无响应。'); return; }
      this.write({ t: 'ping', seq: ++this.pingSeq });
    }, 5_000);
  }
  private write(value: object): void {
    if (this.child?.stdin.writable) this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }
  private onLine(line: string): void {
    if (line.length > 4096) { this.onExit('监听程序返回了无效消息。'); return; }
    let msg: unknown; try { msg = JSON.parse(line); } catch { this.onExit('监听程序返回了无效消息。'); return; }
    if (!msg || typeof msg !== 'object') return;
    const m = msg as Record<string, unknown>;
    if (m.t === 'ready') {
      if (m.sameDevice !== true) { this.fail('当前平台尚未验证同一键盘识别，按住显示不可用。'); return; }
      this.update({ status: 'ready', sameDevice: true, armed: false, reason: m.displaySleep === false ? '显示器休眠通知不可用，需手动收起。' : undefined }); this.reset();
    } else if (m.t === 'armed' && m.epoch === this.epoch && this.snapshot.status === 'ready') {
      this.update({ ...this.snapshot, armed: true });
    } else if (m.t === 'combo' && m.epoch === this.epoch && typeof m.pressed === 'boolean' && this.snapshot.status === 'ready') {
      if (m.pressed && this.snapshot.armed) this.callbacks.combo(true, typeof m.id === 'number' ? m.id : undefined);
      else if (!m.pressed) { this.callbacks.combo(false, typeof m.id === 'number' ? m.id : undefined); this.update({ ...this.snapshot, armed: false }); }
    } else if (m.t === 'pong' && typeof m.seq === 'number' && m.seq === this.pingSeq && m.seq > this.latestPong) {
      if (performance.now() - this.lastPongAt >= 15_000) { this.onExit('按键监听无响应。'); return; }
      this.latestPong = m.seq; this.lastPongAt = performance.now(); this.schedulePingDeadline();
    } else if (m.t === 'pulse-ack' && typeof m.seq === 'number' && m.seq > this.lastPulseAck && m.seq <= this.pulseSeq && this.monitoringLease) {
      if (performance.now() - this.lastLeaseAt >= 300) { this.endLease(); this.callbacks.leaseExpired(); this.onExit('按键监听快速心跳超时，已收起窗口。'); return; }
      this.lastPulseAck = m.seq; this.lastLeaseAt = performance.now(); this.scheduleLeaseDeadline();
    } else if (m.t === 'latency' && (m.kind === 'expand' || m.kind === 'collapse') && typeof m.ms === 'number' && Number.isFinite(m.ms) && m.ms >= 0 && m.ms < 60_000) this.callbacks.latency(m.kind,m.ms);
    else if (m.t === 'display-sleep') this.callbacks.displaySleep();
    else if (m.t === 'health' && m.state === 'display-sleep-unavailable') this.update({ ...this.snapshot, reason: '显示器休眠通知不可用，需手动收起。' });
    else if (m.t === 'error') this.onExit('按键监听不可用，请检查权限或重新启用。');
    else if (m.t === 'tap-disabled') { this.callbacks.combo(false); this.update({ ...this.snapshot, armed: false }); }
  }
  acknowledge(eventId: number | undefined, kind: 'expand' | 'collapse'): void { if (eventId !== undefined) this.write({ t: 'event-ack', seq: eventId, kind }); }
  private schedulePingDeadline(): void {
    if (this.pingDeadline) clearTimeout(this.pingDeadline);
    const remaining=Math.max(1,15_000-(performance.now()-this.lastPongAt));
    this.pingDeadline=setTimeout(() => {
      if (performance.now()-this.lastPongAt >= 15_000) this.onExit('按键监听无响应。');
      else this.schedulePingDeadline();
    },remaining);
  }
  private scheduleLeaseDeadline(): void {
    if (this.leaseDeadline) clearTimeout(this.leaseDeadline);
    const remaining=Math.max(1,300-(performance.now()-this.lastLeaseAt));
    this.leaseDeadline=setTimeout(() => {
      if (!this.monitoringLease) return;
      if (performance.now()-this.lastLeaseAt >= 300) {
        this.endLease(); this.callbacks.leaseExpired(); this.onExit('按键监听快速心跳超时，已收起窗口。');
      } else this.scheduleLeaseDeadline();
    },remaining);
  }
  beginLease(): void {
    if (this.monitoringLease || this.snapshot.status !== 'ready') return;
    this.monitoringLease=true; this.lastLeaseAt=performance.now(); this.scheduleLeaseDeadline();
    this.write({ t: 'pulse', seq: ++this.pulseSeq });
    this.leaseTimer=setInterval(() => { this.write({ t: 'pulse', seq: ++this.pulseSeq }); },100);
  }
  endLease(): void {
    this.monitoringLease=false;
    if (this.leaseTimer) clearInterval(this.leaseTimer); this.leaseTimer=null;
    if (this.leaseDeadline) clearTimeout(this.leaseDeadline); this.leaseDeadline=null;
  }
  reset(): void {
    this.endLease();
    if (this.snapshot.status === 'ready') { this.update({ ...this.snapshot, armed: false }); this.write({ t: 'reset', seq: ++this.epoch }); }
  }
  private clearChild(): void {
    ++this.generation; this.endLease();
    if (this.pingTimer) clearInterval(this.pingTimer); this.pingTimer=null;
    if (this.pingDeadline) clearTimeout(this.pingDeadline); this.pingDeadline=null;
    this.lines?.close(); this.lines=null;
    const child=this.child; this.child=null;
    if (child && !child.killed) child.kill();
  }
  private fail(reason: string): void {
    this.clearChild(); this.callbacks.combo(false);
    this.update({ status: 'unavailable', reason, sameDevice: false, armed: false });
  }
  private onExit(reason: string): void {
    this.fail(reason);
    if (!this.stopping && this.restarts < 3) {
      this.restarts++; this.restartTimer=setTimeout(() => { this.restartTimer=null; if (!this.stopping) this.launch(); }, 1_000);
    }
  }
  stop(): void {
    this.stopping=true; if (this.restartTimer) clearTimeout(this.restartTimer); this.restartTimer=null;
    this.write({ t: 'stop' }); this.clearChild(); this.callbacks.combo(false);
    this.update({ status: 'disabled', sameDevice: false, armed: false });
  }
}

export function listenerPath(isPackaged: boolean, resourcesPath: string, appPath: string, platform: NodeJS.Platform): string {
  const filename = platform === 'win32' ? 'keylistener-win32.exe' : 'keylistener-darwin';
  return join(isPackaged ? resourcesPath : join(appPath, 'resources'), 'keylistener', filename);
}
