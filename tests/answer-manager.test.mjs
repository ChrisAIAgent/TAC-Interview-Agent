import test from 'node:test';
import assert from 'node:assert/strict';
import { AnswerManager } from '../src/main/llm/answer-manager.ts';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(f){for(let i=0;i<100;i++){if(f())return;await sleep(5)}throw Error('timeout')}
const request={question:'介绍项目',system:'真实回答',user:'介绍项目',remoteConsent:true};
test('streams answer updates and retains completed content',async()=>{
 const sent=[];const provider={async *chat(){yield {delta:'第一',done:false};yield {delta:'句话',done:false};yield {delta:'',done:true}}};
 const manager=new AnswerManager(async()=>({provider,remote:true}),x=>sent.push(x));manager.start(request);
 await waitFor(()=>sent.some(x=>x.status==='done'));assert.equal(sent.at(-1).text,'第一句话');assert.ok(sent.some(x=>x.status==='streaming'));
});
test('remote consent prevents any provider request',async()=>{
 const sent=[];let calls=0;const provider={async *chat(){calls++;yield {delta:'x',done:false}}};
 const manager=new AnswerManager(async()=>({provider,remote:true}),x=>sent.push(x));manager.start({...request,remoteConsent:false});
 await waitFor(()=>sent.some(x=>x.status==='error'));assert.equal(calls,0);assert.match(sent.at(-1).error,/确认/);
});
test('next request interrupts previous partial answer and ignores late tokens',async()=>{
 const sent=[];let release;const blocked=new Promise(r=>release=r);let number=0;
 const provider={async *chat(){number++;if(number===1){yield {delta:'保留',done:false};await blocked;yield {delta:'旧内容',done:false}}else yield {delta:'新答案',done:false}}};
 const manager=new AnswerManager(async()=>({provider,remote:false}),x=>sent.push(x));manager.start(request);await waitFor(()=>sent.some(x=>x.text==='保留'));
 manager.start({...request,question:'下一题'});release();await waitFor(()=>sent.some(x=>x.status==='done'));
 assert.ok(sent.some(x=>x.status==='interrupted'&&x.text==='保留'));assert.equal(sent.at(-1).text,'新答案');assert.equal(sent.some(x=>x.text.includes('旧内容')),false);
});
