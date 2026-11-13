import { createHmac, randomInt, randomUUID } from 'node:crypto';

export interface TencentAsrConfig {
  appId: string;
  secretId: string;
  secretKey: string;
  hotwords?: readonly string[];
  engineModelType?: string;
  vadSilenceMs?: number;
}
export interface TencentUrlDependencies { nowMs?: number; nonce?: number; voiceId?: string }

/** Produces a short-lived credential. Never log the returned URL or the input secrets. */
export function buildTencentWsUrl(config: TencentAsrConfig, deps: TencentUrlDependencies = {}): { url: string; voiceId: string } {
  if (!/^\d+$/.test(config.appId) || !/^[A-Za-z0-9_-]+$/.test(config.secretId) || !config.secretKey) throw new Error('腾讯云语音识别凭证格式无效。');
  const engine=config.engineModelType ?? '16k_zh';
  const silence=config.vadSilenceMs ?? 1000;
  if (!/^[A-Za-z0-9_-]+$/.test(engine) || !Number.isInteger(silence) || silence<500 || silence>2000) throw new Error('语音识别参数无效。');
  const timestamp=Math.floor((deps.nowMs ?? Date.now())/1000);
  const nonce=deps.nonce ?? randomInt(1,1_000_000_000);
  const voiceId=deps.voiceId ?? randomUUID().replaceAll('-','');
  if (!Number.isSafeInteger(timestamp) || timestamp<=0 || !Number.isInteger(nonce) || nonce<=0 || nonce>=10_000_000_000 || !/^[A-Za-z0-9_-]{1,128}$/.test(voiceId)) throw new Error('语音识别连接参数无效。');
  const words=config.hotwords ?? [];
  if (words.length>128 || words.some(w => !w || Array.from(w).length>30 || /[\s,|&=;?#]/u.test(w) || (w.match(/\p{Script=Han}/gu)?.length ?? 0)>10)) throw new Error('热词格式无效。');
  const params: Record<string,string> = {
    secretid:config.secretId, timestamp:String(timestamp), expired:String(timestamp+86400), nonce:String(nonce),
    engine_model_type:engine, voice_id:voiceId, voice_format:'1', needvad:'1', vad_silence_time:String(silence),
    filter_punc:'0', convert_num_mode:'1',
  };
  if (words.length) params.hotword_list=words.map(w=>`${w}|10`).join(',');
  const query=Object.keys(params).sort().map(key=>`${key}=${params[key]}`).join('&');
  const source=`asr.cloud.tencent.com/asr/v2/${config.appId}?${query}`;
  const signature=createHmac('sha1',config.secretKey).update(source,'utf8').digest('base64');
  return { url:`wss://${source}&signature=${encodeURIComponent(signature)}`, voiceId };
}
