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
test('an empty model response is reported as an error instead of a completed answer',async()=>{
 const sent=[];const provider={async *chat(){yield {delta:'',done:true}}};
 const manager=new AnswerManager(async()=>({provider,remote:false}),x=>sent.push(x));manager.start(request);
 await waitFor(()=>sent.some(x=>x.status==='error'));assert.match(sent.at(-1).error,/没有返回回答/);assert.equal(sent.some(x=>x.status==='done'),false);
});
test('passes the provider response mode to the answer request',async()=>{
 const sent=[];let observed;
 const provider={async *chat(req){observed=req;yield {delta:'回答',done:false}}};
 const manager=new AnswerManager(async()=>({provider,remote:true,disableThinking:true}),x=>sent.push(x));manager.start(request);
 await waitFor(()=>sent.some(x=>x.status==='done'));assert.equal(observed.disableThinking,true);
});
test('translates only the completed Chinese answer using its original provider when enabled',async()=>{
 const sent=[],calls=[];let loads=0;
 const provider={async *chat(req){calls.push(req);yield {delta:calls.length===1?'我负责国际营销。':'I work in international marketing.',done:false}}};
 const manager=new AnswerManager(async()=>{loads++;return {provider,remote:true,disableThinking:true}},x=>sent.push(x));
 assert.equal(manager.getEnglishEnabled(),false);
 manager.start({...request,question:'私密问题',system:'私密简历',user:'私密对话',refs:['private']});
 await waitFor(()=>sent.some(x=>x.status==='done'));
 assert.equal(calls.length,1);
 manager.setEnglishEnabled(true);
 await waitFor(()=>sent.some(x=>x.englishStatus==='done'));
 assert.equal(loads,1);assert.equal(calls.length,2);
 assert.deepEqual(calls[1].messages,[{role:'user',content:'我负责国际营销。'}]);
 assert.doesNotMatch(JSON.stringify(calls[1]),/私密问题|私密简历|私密对话/);
 assert.equal(calls[1].disableThinking,true);assert.equal(sent.at(-1).text,'我负责国际营销。');
 manager.setEnglishEnabled(false);manager.setEnglishEnabled(true);await sleep(10);assert.equal(calls.length,2);
});
test('enabling during Chinese streaming waits for completion, and disabling aborts the translation',async()=>{
 const sent=[];let releaseChinese,releaseEnglish;const chinese=new Promise(r=>releaseChinese=r),english=new Promise(r=>releaseEnglish=r);
 let calls=0,englishSignal;
 const provider={async *chat(req,signal){calls++;if(calls===1){yield {delta:'中文',done:false};await chinese;yield {delta:'回答',done:false}}else{englishSignal=signal;yield {delta:'English',done:false};await english;yield {delta:' late',done:false}}}};
 const manager=new AnswerManager(async()=>({provider,remote:true}),x=>sent.push(x));manager.start(request);
 await waitFor(()=>sent.some(x=>x.status==='streaming'));manager.setEnglishEnabled(true);assert.equal(calls,1);
 releaseChinese();await waitFor(()=>sent.some(x=>x.englishText==='English'));
 manager.setEnglishEnabled(false);assert.equal(englishSignal.aborted,true);releaseEnglish();await sleep(10);
 assert.equal(sent.at(-1).status,'done');assert.equal(sent.at(-1).englishText,'');assert.equal(sent.at(-1).englishStatus,'idle');
 assert.equal(sent.some(x=>x.englishText.includes('late')),false);
});
test('new questions cancel the previous translation and ignore late chunks',async()=>{
 const sent=[];let release;const blocked=new Promise(r=>release=r);let translationCalls=0,oldSignal;
 const provider={async *chat(req,signal){if(req.system==='真实回答'){yield {delta:req.messages[0].content,done:false};return}translationCalls++;if(translationCalls===1){oldSignal=signal;yield {delta:'old',done:false};await blocked;yield {delta:' stale',done:false}}else yield {delta:'new English',done:false}}};
 const manager=new AnswerManager(async()=>({provider,remote:true}),x=>sent.push(x));manager.setEnglishEnabled(true);const first=manager.start({...request,user:'第一题中文'});
 await waitFor(()=>sent.some(x=>x.id===first&&x.englishText==='old'));
 const second=manager.start({...request,question:'第二题',user:'第二题中文'});assert.equal(oldSignal.aborted,true);release();
 await waitFor(()=>sent.some(x=>x.id===second&&x.englishStatus==='done'));await sleep(10);
 assert.equal(sent.at(-1).id,second);assert.equal(sent.at(-1).englishText,'new English');assert.equal(sent.some(x=>x.englishText.includes('stale')),false);
});
test('switching back on starts a fresh translation without accepting late prior chunks',async()=>{
 const sent=[];let release;const blocked=new Promise(r=>release=r);let translations=0,oldSignal;
 const provider={async *chat(req,signal){if(req.system==='真实回答'){yield {delta:'中文',done:false};return}translations++;if(translations===1){oldSignal=signal;yield {delta:'old',done:false};await blocked;yield {delta:' stale',done:false}}else yield {delta:'new translation',done:false}}};
 const manager=new AnswerManager(async()=>({provider,remote:true}),x=>sent.push(x));manager.setEnglishEnabled(true);manager.start(request);
 await waitFor(()=>sent.some(x=>x.englishText==='old'));manager.setEnglishEnabled(false);assert.equal(oldSignal.aborted,true);manager.setEnglishEnabled(true);
 await waitFor(()=>sent.some(x=>x.englishStatus==='done'));release();await sleep(10);
 assert.equal(sent.at(-1).englishText,'new translation');assert.equal(sent.some(x=>x.englishText.includes('stale')),false);
});
test('stop cancels English without interrupting the completed Chinese answer',async()=>{
 const sent=[];let release;const blocked=new Promise(r=>release=r);let signal;
 const provider={async *chat(req,s){if(req.system==='真实回答'){yield {delta:'中文',done:false};return}signal=s;yield {delta:'partial',done:false};await blocked;yield {delta:' late',done:false}}};
 const manager=new AnswerManager(async()=>({provider,remote:true}),x=>sent.push(x));manager.setEnglishEnabled(true);manager.start(request);
 await waitFor(()=>sent.some(x=>x.englishText==='partial'));manager.cancel();assert.equal(signal.aborted,true);release();await sleep(10);
 assert.equal(sent.at(-1).status,'done');assert.equal(sent.at(-1).text,'中文');assert.equal(sent.at(-1).englishStatus,'idle');assert.equal(sent.some(x=>x.englishText.includes('late')),false);
});
test('translation failures preserve Chinese and can be retried independently',async()=>{
 const sent=[];let translations=0;
 const provider={async *chat(req){if(req.system==='真实回答'){yield {delta:'原中文',done:false};return}translations++;if(translations===1)throw Error('private remote body');yield {delta:'English answer',done:false}}};
 const manager=new AnswerManager(async()=>({provider,remote:true}),x=>sent.push(x));manager.setEnglishEnabled(true);manager.start(request);
 await waitFor(()=>sent.some(x=>x.englishStatus==='error'));assert.equal(sent.at(-1).status,'done');assert.equal(sent.at(-1).text,'原中文');assert.doesNotMatch(sent.at(-1).englishError,/private/);
 manager.retryEnglish();await waitFor(()=>sent.some(x=>x.englishStatus==='done'));assert.equal(sent.at(-1).englishText,'English answer');assert.equal(translations,2);
});
test('revoking remote consent prevents later translation of the existing answer',async()=>{
 const sent=[];let calls=0;
 const provider={async *chat(){calls++;yield {delta:'中文回答',done:false}}};
 const manager=new AnswerManager(async()=>({provider,remote:true}),x=>sent.push(x));manager.start(request);
 await waitFor(()=>sent.some(x=>x.status==='done'));manager.revokeRemoteConsent();manager.setEnglishEnabled(true);manager.retryEnglish();await sleep(10);assert.equal(calls,1);assert.equal(sent.at(-1).englishStatus,'error');assert.match(sent.at(-1).englishError,/重新确认/);
 manager.start({...request,remoteConsent:true});await waitFor(()=>calls===3);assert.equal(calls,3);
});
