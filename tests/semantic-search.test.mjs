import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SemanticSearch } from '../src/main/llm/semantic-search.ts';

const cfg={provider:'openai-compat',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',apiKey:'test-key'};
const data={question:'社区怎么开展',entries:[{id:'a',text:'社区运营支持用户'},{id:'b',text:'营销案例'}],consent:true};
const vector=(first,second=0)=>{const a=Array(1024).fill(0);a[0]=first;a[1]=second;return a;};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'semantic-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));return join(dir,'cache.json');}
function mock(calls){return async(url,options)=>{
 const body=JSON.parse(options.body);calls.push({url,body,options});
 return new Response(JSON.stringify({output:{embeddings:body.input.texts.map((text,index)=>({text_index:index,embedding:text.includes('社区')?vector(1):vector(0,1)}))}}),{status:200});
};}
test('uses document and query embeddings, ranks matching content and reuses cached documents',async t=>{
 const path=await fixture(t),calls=[],service=new SemanticSearch(async()=>cfg,()=>path,mock(calls));
 assert.deepEqual((await service.search(data)).matches.map(row=>row.id),['a']);
 assert.equal(calls.length,2);assert.equal(calls.find(call=>call.body.parameters.text_type==='document').body.input.texts.length,2);
 assert.equal(calls.find(call=>call.body.parameters.text_type==='query').body.input.texts[0],data.question);
 assert.equal(calls[0].url,'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding');
 await service.search({...data,question:'社区具体怎么做'});assert.equal(calls.length,3);assert.equal(calls.at(-1).body.parameters.text_type,'query');
 await service.search({...data,entries:[data.entries[0],{id:'b',text:'更新后的营销案例'}]});
 assert.equal(calls.filter(call=>call.body.parameters.text_type==='document').at(-1).body.input.texts.length,1);
 for(let i=0;i<100;i++){try{await readFile(path);break}catch{await delay(5)}}
 const cache=await readFile(path,'utf8');assert.doesNotMatch(cache,/社区运营支持用户|营销案例|test-key/);
 const restartedCalls=[],restarted=new SemanticSearch(async()=>cfg,()=>path,mock(restartedCalls));
 assert.deepEqual((await restarted.search(data)).matches.map(row=>row.id),['a']);
 assert.equal(restartedCalls.length,1);assert.equal(restartedCalls[0].body.parameters.text_type,'query');
});
test('consent and destination are enforced before network access',async t=>{
 const path=await fixture(t),calls=[];
 const service=new SemanticSearch(async()=>cfg,()=>path,mock(calls));
 await assert.rejects(()=>service.search({...data,consent:false}));assert.equal(calls.length,0);
 const unsafe=new SemanticSearch(async()=>({...cfg,baseUrl:'https://dashscope.aliyuncs.com.evil.test/compatible-mode/v1'}),()=>path,mock(calls));
 await assert.rejects(()=>unsafe.search(data));assert.equal(calls.length,0);
});
test('a new request aborts obsolete requests and ignores their late response',async t=>{
 const path=await fixture(t);let first=true;let oldSignal;
 const fetcher=async(url,options)=>{
  const body=JSON.parse(options.body);
  if(first){first=false;oldSignal=options.signal;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));}
  return new Response(JSON.stringify({output:{embeddings:body.input.texts.map((_,index)=>({index,embedding:vector(1)}))}}));
 };
 const service=new SemanticSearch(async()=>cfg,()=>path,fetcher);
 const old=service.search(data);while(!oldSignal)await delay(1);
 const next=service.search({...data,question:'新问题'});
 await assert.rejects(old);assert.equal(oldSignal.aborted,true);assert.equal((await next).matches.length,2);
});
test('malformed embedding and HTTP failures return errors for caller fallback',async t=>{
 const path=await fixture(t);
 for(const fetcher of [async()=>new Response('{}',{status:503}),async()=>new Response('{"output":{"embeddings":[]}}',{status:200})]){
  const service=new SemanticSearch(async()=>cfg,()=>path,fetcher);await assert.rejects(()=>service.search(data),/暂不可用/);
 }
});
