import { AudioPacer } from '../audio/pacer.ts';
import { newTencentResultState, reduceTencentMessage, type TencentResultState, type TencentTranscript } from './tencent-result.ts';

export interface TencentAsrError { code: string; message: string; retryable: boolean }
export interface TencentSocket {
  readyState: number;
  bufferedAmount?: number;
  send(data: string | ArrayBuffer | ArrayBufferView): void;
  close(): void;
  addEventListener(type: string, callback: (event: Event) => void): void;
}
export interface TencentAsrOptions {
  /** Main-process signer returns only a short-lived URL. Called on explicit start/reconnect. */
  sign(): Promise<{ url: string; voiceId: string }>;
  socket?(url: string): TencentSocket;
  onResult?(value: TencentTranscript): void;
  onError?(value: TencentAsrError): void;
  onState?(state: 'connecting' | 'listening' | 'paused' | 'reconnecting' | 'stopped' | 'failed', attempts: number): void;
  onOverflow?(bytes: number): void;
  onSent?(bytes: number): void;
  onSession?(): void;
  onDrops?(count: number): void;
  wait?(ms: number): Promise<void>;
}
class AsrFailure extends Error {
  error: TencentAsrError;
  constructor(error: TencentAsrError) { super(error.message); this.error=error; }
}
const networkError=(): TencentAsrError=>({code:'ASR_NETWORK',message:'语音识别连接中断，请检查网络。',retryable:true});
const safeError=(code: number): TencentAsrError=>{
  if (code===4002) return {code:'ASR_AUTH',message:'语音识别凭证无效，请检查设置。',retryable:false};
  if (code===4004 || code===4005) return {code:'ASR_QUOTA',message:'语音识别额度已用完或账户欠费。',retryable:false};
  if (code===4006) return {code:'ASR_CONCURRENCY',message:'并发超限，请稍后重试。',retryable:true};
  if (code===4000) return {code:'ASR_RATE_LIMIT',message:'音频发送过快，正在重连。',retryable:true};
  if (code===4008 || code===4009 || code===5000 || code===5001 || code===5002) return networkError();
  return {code:'ASR_SERVICE',message:'语音识别服务返回错误，请检查设置。',retryable:false};
};

/** Cloud connection is started only when the owner calls init after user consent. */
export class TencentAsr {
  readonly id='tencent' as const;
  readonly kind='cloud' as const;
  private options: TencentAsrOptions;
  private socket: TencentSocket | null=null;
  private result: TencentResultState | null=null;
  private pacer: AudioPacer;
  private generation=0;
  private desired=false;
  private paused=false;
  private longPause=false;
  private connected=false;
  private connecting: Promise<void> | null=null;
  private cancelConnection: (()=>void) | null=null;
  private finishResolve: (()=>void) | null=null;
  private finishTimer: ReturnType<typeof setTimeout> | null=null;
  private finishing=false;
  private attempts=0;
  private totalDrops=0;
  constructor(options: TencentAsrOptions) {
    this.options=options;
    this.pacer=new AudioPacer({
      send: frame=>{ if (!this.socket || this.socket.readyState!==1 || (this.socket.bufferedAmount ?? 0)>96_000) throw new Error('socket unavailable or backlogged'); this.socket.send(frame); this.options.onSent?.(frame.byteLength); },
      onOverflow: bytes=>this.options.onOverflow?.(bytes),
      onError: ()=>this.disconnected(networkError()),
      onPauseExpired: ()=>{ this.longPause=true; this.pacer.stop(); this.endSocket(true); },
    });
  }
  async init(): Promise<void> {
    if (this.desired) return this.connecting ?? Promise.resolve();
    this.desired=true; this.paused=false; this.attempts=0; this.totalDrops=0;
    return this.reconnect();
  }
  push(pcm: ArrayBuffer | Float32Array): void {
    if (!this.desired || this.paused || !this.connected || !(pcm instanceof ArrayBuffer) || pcm.byteLength!==3200) return;
    this.pacer.push(new Uint8Array(pcm));
  }
  pause(): void {
    if (!this.desired || this.paused) return;
    this.paused=true; this.pacer.pause(); if (!this.connected) { this.longPause=true; this.endSocket(); } this.options.onState?.('paused',this.attempts);
  }
  resume(): void {
    if (!this.desired || !this.paused) return;
    this.paused=false;
    if (this.longPause || !this.connected) { this.longPause=false; this.attempts=0; this.requestReconnect(); }
    else { this.pacer.resume(); this.options.onState?.('listening',this.attempts); }
  }
  async flush(): Promise<void> {
    if (!this.desired) return;
    this.desired=false; this.finishing=true; this.pacer.stop();
    if (!this.socket || this.socket.readyState!==1) { this.endSocket(); this.finishing=false; this.options.onState?.('stopped',this.attempts); return; }
    const promise=new Promise<void>(resolve=>{
      this.finishResolve=resolve;
      this.finishTimer=setTimeout(()=>this.finish(),3_000);
    });
    try { this.socket.send(JSON.stringify({type:'end'})); } catch { this.finish(); }
    return promise;
  }
  dispose(): void { this.desired=false; this.finishing=false; this.pacer.stop(); this.finish(); this.endSocket(true); this.options.onState?.('stopped',this.attempts); }
  private finish(): void {
    if (this.finishTimer) clearTimeout(this.finishTimer); this.finishTimer=null;
    const resolve=this.finishResolve; this.finishResolve=null;
    if (this.finishing) { this.finishing=false; this.endSocket(); this.options.onState?.('stopped',this.attempts); }
    resolve?.();
  }
  private endSocket(sendEnd=false): void {
    const cancel=this.cancelConnection; this.cancelConnection=null; cancel?.();
    const socket=this.socket; this.socket=null; this.connected=false; ++this.generation;
    if (socket) { try { if (sendEnd && socket.readyState===1) socket.send(JSON.stringify({type:'end'})); socket.close(); } catch { /* already closed */ } }
  }
  private disconnected(error: TencentAsrError): void {
    if (!this.desired || this.paused || this.finishing) return;
    this.pacer.stop(); this.endSocket(); this.options.onError?.(error);
    if (!error.retryable) { this.desired=false; this.options.onState?.('failed',this.attempts); return; }
    this.attempts=0; this.requestReconnect();
  }
  private requestReconnect(): void {
    const pending=this.connecting;
    if (pending) { void pending.catch(()=>undefined).then(()=>{ if (this.desired && !this.paused && !this.connected) void this.reconnect().catch(()=>undefined); }); }
    else void this.reconnect().catch(()=>undefined);
  }
  private reconnect(): Promise<void> {
    if (this.connecting) return this.connecting;
    const work=this.reconnectLoop();
    this.connecting=work.finally(()=>{this.connecting=null;});
    return this.connecting;
  }
  private async reconnectLoop(): Promise<void> {
    const wait=this.options.wait ?? (ms=>new Promise<void>(resolve=>setTimeout(resolve,ms)));
    let last: TencentAsrError=networkError();
    for (let attempt=0; attempt<=5 && this.desired && !this.paused; attempt++) {
      this.attempts=attempt; this.options.onState?.(attempt ? 'reconnecting' : 'connecting',attempt);
      if (attempt) await wait(Math.min(8_000,1_000*2**(attempt-1)));
      if (!this.desired || this.paused) return;
      try { await this.connectOnce(); if (!this.desired || this.paused) return; if (!this.connected) throw new AsrFailure(networkError()); this.attempts=0; this.pacer.start(); this.options.onState?.('listening',0); return; }
      catch (error) {
        if (!this.desired || this.paused) return;
        last=error instanceof AsrFailure ? error.error : networkError();
        this.options.onError?.(last);
        if (!last.retryable) break;
      }
    }
    if (this.desired && !this.paused) { this.desired=false; this.options.onState?.('failed',this.attempts); throw new AsrFailure(last); }
  }
  private async connectOnce(): Promise<void> {
    let signed: {url:string;voiceId:string};
    try { signed=await this.options.sign(); } catch { throw new AsrFailure({code:'ASR_CONFIG',message:'无法生成语音识别连接，请检查凭证。',retryable:false}); }
    if (!this.desired || this.paused) return;
    if (!signed.url.startsWith('wss://asr.cloud.tencent.com/asr/v2/') || !signed.voiceId) throw new AsrFailure({code:'ASR_CONFIG',message:'语音识别连接地址无效。',retryable:false});
    const generation=++this.generation;
    this.result=newTencentResultState(signed.voiceId);
    const socket=(this.options.socket ?? (url=>new WebSocket(url) as unknown as TencentSocket))(signed.url);
    this.socket=socket;
    return new Promise<void>((resolve,reject)=>{
      let settled=false, ready=false;
      const timer=setTimeout(()=>fail(networkError()),10_000);
      this.cancelConnection=()=>{ if (!settled) { settled=true; clearTimeout(timer); reject(new AsrFailure(networkError())); } };
      const fail=(error:TencentAsrError):void=>{
        if (generation!==this.generation) return;
        if (!settled) { settled=true; clearTimeout(timer); this.endSocket(); reject(new AsrFailure(error)); }
        else if (ready) this.disconnected(error);
      };
      socket.addEventListener('message',(event:Event)=>{
        if (generation!==this.generation || !this.result) return;
        const data=(event as MessageEvent<unknown>).data;
        if (typeof data!=='string') { fail({code:'ASR_PROTOCOL',message:'语音识别返回了无效数据。',retryable:false}); return; }
        const oldDrops=this.result.dropCount; const reduced=reduceTencentMessage(this.result,data); this.result=reduced.state; this.totalDrops+=this.result.dropCount-oldDrops; this.options.onDrops?.(this.totalDrops);
        if (reduced.event.type==='error') { fail(typeof reduced.event.code==='number'?safeError(reduced.event.code):{code:'ASR_PROTOCOL',message:reduced.event.message,retryable:false}); return; }
        if (reduced.event.type==='ready' && !settled) { ready=true; settled=true; clearTimeout(timer); this.cancelConnection=null; this.connected=true; this.options.onSession?.(); resolve(); return; }
        if (reduced.event.type==='transcript') { this.options.onResult?.(reduced.event.line); if (reduced.event.streamEnded) this.finish(); }
        if (reduced.event.type==='complete') this.finish();
      });
      socket.addEventListener('error',()=>fail(networkError()));
      socket.addEventListener('close',()=>{if(this.finishing) this.finish();else fail(networkError());});
    });
  }
}
