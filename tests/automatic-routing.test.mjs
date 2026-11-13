import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle=await build({stdin:{contents:`
  export { resolveAutomaticTurn } from './src/renderer/src/session/automatic.ts';
  export { findQuestionBankMatches } from './src/renderer/src/session/question-bank.ts';
  export { classifyUtterance, parseClassification } from './src/main/llm/classify.ts';
  export { searchPublicTopic } from './src/main/llm/public-search.ts';
`,resolveDir:process.cwd(),sourcefile:'routing-entry.ts'},bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
const {resolveAutomaticTurn,findQuestionBankMatches,classifyUtterance,parseClassification,searchPublicTopic}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const resume={id:'fake',title:'简历',updatedAt:'2026-01-01',personal:{fullName:'陈某',phone:'13800138000',skills:[]},experiences:[{id:'e',company:'星河科技',role:'工程师',highlights:[]}],projects:[{id:'p',name:'支付项目',highlights:[]}],education:[],customSections:[]};
const bank=[{id:'q1',question:'请介绍支付项目的缓存设计',answer:'参与缓存测试与回退验证'}];
function input(utterance){return {utterance,context:'我的麦克风：我负责缓存测试',resume,bank,webEnabled:()=>true}}
function deps(classification,calls){return {classify:async()=>classification,search:async topic=>{calls.push(topic);return {summary:'公开资料摘要',sources:[{title:'官方文档',url:'https://example.org/'}]}},isCurrent:()=>true,status:()=>{}}}

test('LLM classifies follow-up using conversation context and rejects malformed output',async()=>{
  let request;const provider={async *chat(req){request=req;yield {delta:'{"isQuestion":true,"kind":"personal","question":"缓存测试后来怎么样？"}',done:false}}};
  const result=await classifyUtterance(provider,'后来呢？','我的麦克风：我负责缓存测试',new AbortController().signal,false);
  assert.equal(result.kind,'personal');assert.match(result.question,/缓存测试/);assert.match(request.messages[0].content,/我的麦克风/);
  assert.throws(()=>parseClassification('{"isQuestion":true,"kind":"unsafe","question":"x"}'));
});
test('personal and math questions use no web search; local question bank matches',async()=>{
  const calls=[];
  const personal=await resolveAutomaticTurn(input('请介绍支付项目的缓存设计'),deps({isQuestion:true,kind:'personal',question:'请介绍支付项目的缓存设计'},calls));
  assert.equal(personal.type,'ready');assert.equal(personal.bank[0].id,'q1');
  const mathInput=input('10个人互相握手多少次？');mathInput.bank=[{id:'math',question:'10个人互相握手多少次？',answer:'错误示例'}];
  const math=await resolveAutomaticTurn(mathInput,deps({isQuestion:true,kind:'math',question:'10个人互相握手多少次？'},calls));
  assert.equal(math.kind,'math');assert.deepEqual(math.bank,[]);assert.equal(calls.length,0);
  assert.equal(findQuestionBankMatches('请介绍支付项目的缓存设计',bank)[0].id,'q1');
});
test('public web search receives only an allowlisted topic, never interview text or resume',async()=>{
  const calls=[];
  const result=await resolveAutomaticTurn(input('React 最新稳定版本是什么？'),deps({isQuestion:true,kind:'external',question:'React 最新稳定版本是什么？'},calls));
  assert.deepEqual(calls,['react']);assert.equal(result.webUnavailable,false);assert.match(result.webReference,/example.org/);
  const mixed=await resolveAutomaticTurn(input('陈某在星河科技的 React 项目最新情况？'),deps({isQuestion:true,kind:'external',question:'陈某在星河科技的 React 项目最新情况？'},calls));
  assert.equal(mixed.webUnavailable,true);assert.deepEqual(calls,['react']);
  const personal=await resolveAutomaticTurn(input('你之前在 React 上做过什么？'),deps({isQuestion:true,kind:'external',question:'React 做过什么？'},calls));
  assert.equal(personal.webUnavailable,true);assert.deepEqual(calls,['react']);
  const irrelevant=await resolveAutomaticTurn(input('React 最新融资额是多少？'),deps({isQuestion:true,kind:'external',question:'React 最新融资额是多少？'},calls));
  assert.equal(irrelevant.webUnavailable,true);assert.deepEqual(calls,['react']);
  const math=await resolveAutomaticTurn(input('React 最新版本相关的排列组合题怎么计算？'),deps({isQuestion:true,kind:'external',question:'React 最新版本相关的排列组合题怎么计算？'},calls));
  assert.equal(math.webUnavailable,true);assert.deepEqual(calls,['react']);
  const unknown=await resolveAutomaticTurn(input('某城市今天的天气怎么样？'),deps({isQuestion:true,kind:'external',question:'某城市今天的天气怎么样？'},calls));
  assert.equal(unknown.webUnavailable,true);assert.deepEqual(calls,['react']);
});
test('search backend sends a fixed public query and requires real returned sources',async()=>{
  let body,url;
  const fake=async(u,options)=>{url=u;body=JSON.parse(options.body);return new Response(JSON.stringify({output:{choices:[{message:{content:'公开信息'}}],search_info:{search_results:[{title:'官方文档',url:'https://react.dev/'}]}}}),{status:200})};
  const value=await searchPublicTopic({baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen3.8-flash',apiKey:'fake-key'},'react',fake);
  assert.match(url,/dashscope\.aliyuncs\.com/);assert.equal(value.sources.length,1);assert.equal(body.input.messages[1].content,'React 官方最新稳定版本及更新');
  assert.doesNotMatch(JSON.stringify(body),/陈某|星河科技|13800138000|fake-key/);
  await assert.rejects(()=>searchPublicTopic({baseUrl:'https://evil.example/v1',model:'q',apiKey:'x'},'react',fake));
  await assert.rejects(()=>searchPublicTopic({baseUrl:'https://dashscope.aliyuncs.com/v1',model:'q',apiKey:'x'},'陈某 React',fake),/不支持/);
  await assert.rejects(()=>searchPublicTopic({baseUrl:'https://dashscope.aliyuncs.com/v1',model:'q',apiKey:'x'},'react',async()=>new Response(JSON.stringify({output:{choices:[{message:{content:'可能的答案'}}],search_info:{search_results:[]}}}),{status:200})),/未获得可核验/);
});
test('web search is opt-in and classification errors do not trigger search',async()=>{
  const calls=[];const sample=input('React 最新稳定版本是什么？');sample.webEnabled=()=>false;
  const result=await resolveAutomaticTurn(sample,deps({isQuestion:true,kind:'external',question:'React 最新稳定版本是什么？'},calls));
  assert.equal(result.webUnavailable,true);assert.deepEqual(calls,[]);
  const failing=deps(null,calls);failing.classify=async()=>{throw new Error('unavailable')};
  await assert.rejects(()=>resolveAutomaticTurn(sample,failing),/unavailable/);assert.deepEqual(calls,[]);
});
test('obsolete classification does not initiate search or answer',async()=>{
  const calls=[];const d=deps({isQuestion:true,kind:'external',question:'React 最新版本？'},calls);d.isCurrent=()=>false;
  assert.equal((await resolveAutomaticTurn(input('React 最新版本？'),d)).type,'stale');assert.deepEqual(calls,[]);
});
