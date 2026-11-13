import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildTencentWsUrl } from '../src/main/asr/tencent-sign.ts';
test('signs sorted connection parameters and encodes the signature',()=>{
 const cfg={appId:'123456',secretId:'exampleSecretId',secretKey:'exampleSecretKey'};
 const actual=buildTencentWsUrl(cfg,{nowMs:1700000000000,nonce:42,voiceId:'abc123'});
 const text='asr.cloud.tencent.com/asr/v2/123456?convert_num_mode=1&engine_model_type=16k_zh&expired=1700086400&filter_punc=0&needvad=1&nonce=42&secretid=exampleSecretId&timestamp=1700000000&vad_silence_time=1000&voice_format=1&voice_id=abc123';
 const sig=createHmac('sha1',cfg.secretKey).update(text).digest('base64');
 assert.equal(actual.url,`wss://${text}&signature=${encodeURIComponent(sig)}`); assert.equal(actual.voiceId,'abc123');
});
test('uses a fresh voice ID and rejects unsafe hotwords',()=>{
 const cfg={appId:'123',secretId:'id',secretKey:'key',hotwords:['腾讯云','Kubernetes']};
 const a=buildTencentWsUrl(cfg),b=buildTencentWsUrl(cfg); assert.notEqual(a.voiceId,b.voiceId);
 assert.ok(a.url.includes('hotword_list=腾讯云|10,Kubernetes|10'));
 assert.throws(()=>buildTencentWsUrl({...cfg,hotwords:['bad&word']}),/热词/);
 assert.throws(()=>buildTencentWsUrl({...cfg,appId:'123/else'}),/凭证/);
});
