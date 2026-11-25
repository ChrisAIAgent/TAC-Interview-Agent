import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildTencentWsUrl } from '../src/main/asr/tencent-sign.ts';
import { parseAsrHotwords } from '../src/shared/asr-hotwords.ts';
test('signs sorted connection parameters and encodes the signature',()=>{
 const cfg={appId:'123456',secretId:'exampleSecretId',secretKey:'exampleSecretKey'};
 const actual=buildTencentWsUrl(cfg,{nowMs:1700000000000,nonce:42,voiceId:'abc123'});
 const text='asr.cloud.tencent.com/asr/v2/123456?convert_num_mode=1&engine_model_type=16k_zh&expired=1700086400&filter_punc=0&needvad=1&nonce=42&secretid=exampleSecretId&timestamp=1700000000&vad_silence_time=1500&voice_format=1&voice_id=abc123';
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
test('parses and validates editable hotwords without allowing query injection',()=>{
 assert.deepEqual(parseAsrHotwords('社媒，展会\n QwenWork,社媒'),['社媒','展会','QwenWork']);
 assert.deepEqual(parseAsrHotwords('社媒|100,展会|11,营销|1'),['社媒|100','展会|11','营销|1']);
 assert.deepEqual(parseAsrHotwords('  '),[]);
 assert.throws(()=>parseAsrHotwords('营销&secret=1'),/热词/);
 assert.throws(()=>parseAsrHotwords('社媒|12'),/热词/);
 assert.throws(()=>parseAsrHotwords('社媒,社媒|100'),/同一个热词/);
 assert.throws(()=>parseAsrHotwords('超'.repeat(11)),/热词/);
 assert.throws(()=>parseAsrHotwords(Array.from({length:129},(_,i)=>`word${i}`).join(',')),/热词/);
});
test('preserves an explicitly selected hotword weight when signing',()=>{
 const result=buildTencentWsUrl({appId:'123',secretId:'id',secretKey:'key',hotwords:['社媒|100','展会']});
 assert.ok(result.url.includes('hotword_list=社媒|100,展会|10'));
});
test('signs the 2.0 model using V2 parameters',()=>{
 const result=buildTencentWsUrl({appId:'123',secretId:'id',secretKey:'key',engineModelType:'16k_zh_en_2.0'});
 assert.ok(result.url.includes('engine_model_type=16k_zh_en_2.0'));
 assert.ok(!result.url.includes('vad_silence_time='));
 assert.throws(()=>buildTencentWsUrl({appId:'123',secretId:'id',secretKey:'key',engineModelType:'unexpected'}));
});
