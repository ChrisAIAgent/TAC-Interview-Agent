import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundle=await build({entryPoints:['src/renderer/src/session/semantic-knowledge.ts'],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
const {selectKnowledge,interpretKnowledgeQuestion}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const item=(id,title,content,tags=[])=>({id,title,content,tags,sources:[],verifiedAt:'',kind:'guidance',document:''});
const entries=[item('linkedin','LinkedIn：岗位场景','职场专业信任',['LinkedIn']),item('youtube','YouTube：教程','任务教程',['YouTube']),item('reddit','Reddit：社区','倾听讨论',['Reddit'])];

test('the observed platform ASR error is interpreted only with a clear platform context',async()=>{
  const raw='令英河油管应该分别发什么内容？';
  const question=interpretKnowledgeQuestion(raw);
  assert.equal(question,'领英和油管应该分别发什么内容？');
  const result=await selectKnowledge(question,true,{entries:()=>entries,isCurrent:()=>true,search:async request=>{
    assert.equal(request.question,'领英和油管应该分别发什么内容？');
    return {method:'llm',matches:[{id:'youtube',score:.9}]};
  }});
  assert.deepEqual(result.entries.map(entry=>entry.id),['linkedin','youtube']);
  assert.equal(raw,'令英河油管应该分别发什么内容？');
  for(const value of ['令英的履历怎么样？','同事令英和油管的负责人讨论视频内容','请介绍一下叫令英的人','给令英发内容，她负责油管','我和令英讨论油管发布','令英负责社媒运营'])assert.equal(interpretKnowledgeQuestion(value),value);
});

test('semantic hits are constrained to current records and explicitly named platforms are covered',async()=>{
  const result=await selectKnowledge('领英和油管怎样分别运营？',true,{entries:()=>entries,isCurrent:()=>true,search:async request=>{
    assert.equal(request.consent,true);assert.equal(request.entries.length,3);
    return {method:'embedding',matches:[{id:'linkedin',score:.9},{id:'linkedin',score:.8},{id:'missing',score:.7}]};
  }});
  assert.equal(result.mode,'embedding');assert.deepEqual(result.entries.map(entry=>entry.id),['linkedin','youtube']);
});
test('a semantic no-match stays empty; a failure uses keyword fallback',async()=>{
  const base={entries:()=>entries,isCurrent:()=>true};
  const llm=await selectKnowledge('Reddit 社区怎么运营？',true,{...base,search:async()=>({method:'llm',matches:[{id:'reddit',score:.8}]})});
  assert.equal(llm.mode,'llm');assert.equal(llm.entries[0].id,'reddit');
  assert.deepEqual((await selectKnowledge('Reddit 社区怎么运营？',true,{...base,search:async()=>({method:'llm',matches:[]})})).entries,[]);
  const fallback=await selectKnowledge('Reddit 社区怎么运营？',true,{...base,search:async()=>{throw new Error('unavailable')}});
  assert.equal(fallback.mode,'keyword');assert.ok(fallback.entries.some(entry=>entry.id==='reddit'));
});
test('a superseded question never accepts late semantic results',async()=>{
  let current=true,release;
  const waiting=new Promise(resolve=>{release=resolve});
  const task=selectKnowledge('Reddit 社区怎么运营？',true,{entries:()=>entries,isCurrent:()=>current,search:()=>waiting});
  current=false;release({method:'embedding',matches:[{id:'reddit',score:.9}]});
  assert.equal((await task).mode,'stale');
});
test('edits or deletions during indexing cause a fresh search against the latest library',async()=>{
  let currentEntries=entries,release,calls=0;
  const waiting=new Promise(resolve=>{release=resolve});
  const task=selectKnowledge('Reddit 社区怎么运营？',true,{entries:()=>currentEntries,isCurrent:()=>true,search:async request=>{
    calls++;if(calls===1)return waiting;
    assert.deepEqual(request.entries.map(entry=>entry.id),['youtube']);
    return {method:'llm',matches:[{id:'youtube',score:.8}]};
  }});
  currentEntries=[entries[1]];release({method:'embedding',matches:[{id:'reddit',score:.9}]});
  const result=await task;assert.equal(calls,2);assert.deepEqual(result.entries.map(entry=>entry.id),['youtube']);
});
