import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../src/renderer/src/session');
const guide=JSON.parse(fs.readFileSync(path.join(root,'social-guide.json'),'utf8'));
const source=fs.readFileSync(path.join(root,'knowledge.ts'),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const mod={exports:{}};
new Function('exports','require','module',js)(mod.exports,request=>{if(request==='./social-guide.json')return guide;throw new Error('Unexpected dependency: '+request)},mod);
const {findKnowledgeMatches,loadKnowledge,KNOWLEDGE_KEY}=mod.exports;

test('retrieval covers both platforms named with Chinese aliases',()=>{
  const matches=findKnowledgeMatches('领英和油管应该分别发什么内容？',guide);
  assert.ok(matches.some(entry=>entry.title.startsWith('LinkedIn')));
  assert.ok(matches.some(entry=>entry.title.startsWith('YouTube')));
  assert.ok(matches.length<=3);
});
test('retrieval finds community guidance and a relevant public cooperation case',()=>{
  assert.ok(findKnowledgeMatches('如果想在 Reddit 做社区运营，你会怎么开始？',guide).some(entry=>entry.title.startsWith('Reddit：')));
  assert.ok(findKnowledgeMatches('有什么开源项目合作案例，可以给海外营销一些启发？',guide).some(entry=>entry.kind==='case'&&/开源/.test(entry.title)));
  assert.ok(findKnowledgeMatches('如何衡量品牌声量和获客线索？',guide).some(entry=>/指标/.test(entry.title)));
});
test('unrelated questions do not pull the social-media guide',()=>{
  for(const question of ['请解释一下牛顿第二定律','如何提高我的英语口语水平？'])assert.deepEqual(findKnowledgeMatches(question,guide),[]);
});
test('guide imports once and user deletion is preserved across reloads',()=>{
  const values=new Map();
  globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value))};
  try {
    const first=loadKnowledge();assert.equal(first.length,guide.length);
    values.set(KNOWLEDGE_KEY,JSON.stringify(first.slice(1)));
    assert.equal(loadKnowledge().length,guide.length-1);
    values.set(KNOWLEDGE_KEY,'[]');assert.deepEqual(loadKnowledge(),[]);
  } finally { delete globalThis.localStorage; }
});
