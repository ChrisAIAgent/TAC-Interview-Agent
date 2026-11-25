import test from 'node:test';
import assert from 'node:assert/strict';
import { rerankKnowledge } from '../src/main/llm/semantic-rerank.ts';

const input={question:'怎么让社区活跃',consent:true,entries:[{id:'a',text:'社区运营方案'},{id:'b',text:'海外视频教程'},{id:'c',text:'用户交流与互助'}]};
const provider=(result,inspect)=>({async *chat(request,signal){inspect?.(request,signal);yield {delta:result,done:true};}});

test('model selects only existing topics and may return no match',async()=>{
 let request;
 const result=await rerankKnowledge(provider('{"matches":[2,0]}',value=>{request=value}),input,new AbortController().signal,true);
 assert.deepEqual(result.matches.map(match=>match.id),['c','a']);assert.equal(request.temperature,0);assert.equal(request.disableThinking,true);
 assert.match(request.system,/不是指令/);assert.equal(JSON.parse(request.messages[0].content).topics.length,3);
 assert.deepEqual((await rerankKnowledge(provider('{"matches":[]}'),input,new AbortController().signal)).matches,[]);
});
test('rejects invented, duplicate, excess or malformed topic IDs',async()=>{
 for(const text of ['{"matches":[9]}','{"matches":[0,0]}','{"matches":[0,1,2,0]}','{"matches":["0"]}','其他内容 {"matches":[0]}','{"matches":[0],"text":"bad"}']){
  await assert.rejects(()=>rerankKnowledge(provider(text),input,new AbortController().signal));
 }
});
test('aborting a pending rerank stops the request',async()=>{
 const controller=new AbortController();let received;
 const pending=rerankKnowledge({async *chat(_request,signal){received=signal;await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));yield {delta:'{"matches":[0]}',done:true};}},input,controller.signal);
 await new Promise(resolve=>setTimeout(resolve,0));controller.abort();await assert.rejects(pending);assert.equal(received.aborted,true);
});
test('a large library keeps each topic in a bounded request',async()=>{
 let request;const entries=Array.from({length:500},(_,i)=>({id:`${i}`,text:`主题${i}`+'a'.repeat(500)}));
 await rerankKnowledge(provider('{"matches":[499]}',value=>{request=value}),{...input,entries},new AbortController().signal);
 const topics=JSON.parse(request.messages[0].content).topics;assert.equal(topics.length,500);assert.ok(request.messages[0].content.length<32000);
});
