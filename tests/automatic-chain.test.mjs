import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Exercise the existing modules together with a fake ASR message and fake LLM HTTP response.
// This does not mount the Electron/React UI or contact cloud services.
const bundle = await build({
  stdin: { contents: `
    export { newTencentResultState, reduceTencentMessage } from './src/renderer/src/asr/tencent-result.ts';
    export { detectQuestion } from './src/renderer/src/session/questionDetect.ts';
    export { buildPrompt } from './src/renderer/src/prompt/build.ts';
    export { resolveAutomaticTurn } from './src/renderer/src/session/automatic.ts';
    export { classifyUtterance } from './src/main/llm/classify.ts';
    export { AnswerManager } from './src/main/llm/answer-manager.ts';
    export { OpenAICompatProvider } from './src/main/llm/openai-compat.ts';
  `, resolveDir: process.cwd(), sourcefile: 'automatic-chain-entry.ts' },
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
});
const { newTencentResultState, reduceTencentMessage, buildPrompt, resolveAutomaticTurn, classifyUtterance, AnswerManager, OpenAICompatProvider } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

test('a final simulated ASR question reaches a mock streaming LLM with resume and actual speech', async () => {
  const text='请讲讲支付系统缓存设计？';
  const result=reduceTencentMessage(newTencentResultState('v1'),JSON.stringify({code:0,voice_id:'v1',result:{index:0,slice_type:2,voice_text_str:text,start_time:0,end_time:1000}}));
  assert.equal(result.event.type,'transcript');
  assert.equal(result.event.line.isFinal,true);
  const resume={id:'fake',title:'模拟简历',updatedAt:'2026-01-01',personal:{fullName:'',skills:[]},experiences:[],projects:[{id:'p1',name:'支付系统',contribution:'设计支付系统缓存与回退机制',highlights:[]}],education:[],customSections:[]};
  const speech=[{source:'system',text:'请介绍这个项目'},{source:'microphone',text:'我负责缓存测试'},{source:'system',text}];
  let request;let classificationCalls=0;
  const mockFetch=async (_url,options)=>{
    const body=JSON.parse(options.body);const classification=body.messages[0].content.includes('面试对话判断器');
    if(classification)classificationCalls++;else request=body;
    const content=classification?JSON.stringify({isQuestion:true,kind:'personal',question:text}):'先说明缓存策略';
    const frame=`data: ${JSON.stringify({choices:[{delta:{content}}]})}\n\ndata: [DONE]\n\n`;
    return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(frame));controller.close()}}),{status:200});
  };
  const provider=new OpenAICompatProvider('mock-model','mock-key','https://example.invalid/v1',mockFetch);
  const routed=await resolveAutomaticTurn({utterance:text,context:'我的麦克风：我负责缓存测试',resume,bank:[],webEnabled:()=>true},{classify:(utterance,context)=>classifyUtterance(provider,utterance,context,new AbortController().signal,false),search:()=>{throw new Error('personal question must not search')},isCurrent:()=>true,status:()=>{}});
  assert.equal(routed.type,'ready');assert.equal(classificationCalls,1);
  const prompt=buildPrompt(resume,{id:'mock',title:'模拟',body:'简短回答'},routed.question,[],speech,{kind:routed.kind,bank:routed.bank});
  const updates=[];
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('mock stream timeout')),2000);
    const manager=new AnswerManager(async()=>({provider,remote:true}),update=>{
      updates.push(update);
      if(update.status==='done' || update.status==='error'){clearTimeout(timeout);resolve()}
    });
    manager.start({question:text,system:prompt.system,user:prompt.messages[0].content,remoteConsent:true,refs:prompt.resumeRefs});
  });
  assert.match(request.messages[0].content,/支付系统缓存与回退机制/);
  assert.match(request.messages[1].content,/我的麦克风：我负责缓存测试/);
  assert.match(request.messages[1].content,/支付系统缓存设计/);
  assert.ok(updates.some(item=>item.status==='streaming'));
  assert.equal(updates.at(-1).status,'done');
  assert.equal(updates.at(-1).text,'先说明缓存策略');
});
