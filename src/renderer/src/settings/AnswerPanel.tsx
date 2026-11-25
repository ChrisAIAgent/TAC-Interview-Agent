import React, { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { buildPrompt, type ConversationTurn } from '../prompt/build'
import type { AnswerInstruction, Resume } from '../shared/resume'
import { formatSpeechContext, type SpeechTurn } from '../session/conversation'
import { findQuestionBankMatches, type QuestionBankEntry } from '../session/question-bank'
import { resolveAutomaticTurn } from '../session/automatic'
import type { KnowledgeEntry } from '../session/knowledge'
import { interpretKnowledgeQuestion, selectKnowledge } from '../session/semantic-knowledge'
const builtins:AnswerInstruction[]=[
  {id:'concise',title:'简洁口语',body:'先直接回答问题，再用简短要点解释；有相关真实经历时自然带出，不必每题都讲经历。像面试现场交流，用常见词和短句，分短段方便扫读。',builtin:true},
  {id:'star',title:'STAR 结构',body:'按背景、任务、行动和结果组织回答，优先说明本人贡献，不编造数字。',builtin:true},
  {id:'technical',title:'技术深入',body:'说明技术选择、关键权衡和实际结果，信息不足时明确说明。',builtin:true},
]
function initialInstructions():AnswerInstruction[]{
  const oldConciseDefaults=[
    '用自然口语回答，先说结论，再用真实经历支撑，控制在 4 至 6 句话。',
    '先直接回答问题，再用一段最相关的真实经历简短支撑。说清本人做法和结果，像面试现场交流，不要复述简历条目。一般控制在 3 至 5 句。',
  ]
  try{const value:unknown=JSON.parse(localStorage.getItem('tac-answer-instructions')||'null');if(Array.isArray(value)&&value.length&&value.every(x=>x&&typeof x.id==='string'&&typeof x.title==='string'&&typeof x.body==='string'))return (value as AnswerInstruction[]).map(x=>x.id==='concise'&&oldConciseDefaults.includes(x.body)?{...x,body:builtins[0].body}:x)}catch{/* Ignore invalid settings. */}
  return builtins.map(x=>({...x}))
}
export function AnswerPanel({resume,candidate,speech,sessionId,provider,host,configured,bank,knowledge}:{resume:Resume;candidate:{id:number;text:string}|null;speech:SpeechTurn[];sessionId:number;provider:string;host:string;configured:boolean;bank:QuestionBankEntry[];knowledge:KnowledgeEntry[]}):React.JSX.Element {
  const [question,setQuestion]=useState(''),[answer,setAnswer]=useState<AnswerUpdate|null>(null)
  const [consent,setConsent]=useState(false),[automatic,setAutomatic]=useState(false)
  const [webEnabled,setWebEnabled]=useState(false),[autoStatus,setAutoStatus]=useState('')
  const [sources,setSources]=useState<{title:string;url:string}[]>([])
  const [instructions,setInstructions]=useState<AnswerInstruction[]>(initialInstructions)
  const [selected,setSelected]=useState('concise'),[message,setMessage]=useState('')
  const history=useRef<ConversationTurn[]>([]),done=useRef(new Set<string>())
  const [knowledgeStatus,setKnowledgeStatus]=useState('')
  const automaticAnswer=useRef<string|null>(null)
  const speechRef=useRef(speech);speechRef.current=speech
  const knowledgeRef=useRef(knowledge);knowledgeRef.current=knowledge
  const knowledgeModeRef=useRef('')
  const webEnabledRef=useRef(webEnabled);webEnabledRef.current=webEnabled
  const sequence=useRef(0),pending=useRef<string[]>([])
  const remote=provider!=='ollama'
  const instruction=instructions.find(x=>x.id===selected)??instructions[0]
  useEffect(()=>{history.current=[];done.current.clear();automaticAnswer.current=null;pending.current=[];sequence.current++;setSources([]);setAutoStatus('')},[sessionId])
  useEffect(()=>{localStorage.setItem('tac-answer-instructions',JSON.stringify(instructions))},[instructions])
  useEffect(()=>{window.interviewAPI.publishAutoStatus(autoStatus)},[autoStatus])
  useEffect(()=>{
    const start=():void=>{if(configured){setConsent(true);setAutomatic(true);setAutoStatus('')}}
    const stop=():void=>{sequence.current++;pending.current=[];setAutomatic(false);setAutoStatus('');void window.interviewAPI.cancelAnswer()}
    window.addEventListener('tac:interview-start',start)
    window.addEventListener('tac:interview-stop',stop)
    return()=>{window.removeEventListener('tac:interview-start',start);window.removeEventListener('tac:interview-stop',stop)}
  },[configured])
  useEffect(()=>window.interviewAPI.onAnswer(value=>{
    setAnswer(value)
    if(value.status==='done'&&!done.current.has(value.id)){done.current.add(value.id);history.current=[...history.current,{question:value.question,answer:value.text}].slice(-3)}
    if(value.id===automaticAnswer.current && value.status==='done')setAutoStatus(previous=>`${previous.includes('未核验')||previous.includes('跳过联网')?`${previous} · `:''}回答已生成${knowledgeModeRef.current?` · ${knowledgeModeRef.current}`:''}`)
    if(value.id===automaticAnswer.current && value.status==='error')setAutoStatus('自动回答失败，请检查模型服务。')
    if(value.id===automaticAnswer.current && value.status==='interrupted')setAutoStatus('回答已中断，可以重新生成。')
  }),[])
  const generate=async(text:string,options:Parameters<typeof buildPrompt>[5]={},fromAutomatic=false,version=sequence.current):Promise<void>=>{
    const q=text.trim();if(!q || !instruction || (remote&&!consent))return
    const interpretedQuestion=interpretKnowledgeQuestion(q)
    let matched=options?.knowledge
    if(!matched && options.kind!=='math'){
      const warning=options.webUnavailable?'联网未核验 · ':''
      setKnowledgeStatus('正在进行语义检索；首次建立资料索引可能需要一些时间。')
      if(fromAutomatic)setAutoStatus(`${warning}正在语义检索；首次建索引可能需要一些时间…`)
      const selection=await selectKnowledge(interpretedQuestion,!remote||consent,{entries:()=>knowledgeRef.current,isCurrent:()=>version===sequence.current,search:request=>window.interviewAPI.semanticKnowledgeSearch(request)})
      if(selection.mode==='stale')return
      matched=selection.entries
      knowledgeModeRef.current=selection.mode==='embedding'?'向量语义检索':selection.mode==='llm'?'模型语义筛选':selection.mode==='keyword'?'关键词检索（语义服务暂不可用）':'无知识资料'
      setKnowledgeStatus(selection.mode==='embedding'?'本题已使用向量语义检索。':selection.mode==='llm'?'向量服务暂不可用，本题已由回答模型进行语义筛选。':selection.mode==='keyword'?'语义检索暂不可用，本题已使用关键词检索。':'知识资料库为空。')
      if(fromAutomatic)setAutoStatus(`${warning}${knowledgeModeRef.current} · 正在生成回答`)
    } else {knowledgeModeRef.current='';setKnowledgeStatus('')}
    if(version!==sequence.current)return
    const prompt=buildPrompt(resume,instruction,interpretedQuestion,history.current,speechRef.current,{...options,bank:options?.bank??findQuestionBankMatches(interpretedQuestion,bank),knowledge:matched})
    try{setMessage('');const id=await window.interviewAPI.startAnswer({question:q,system:prompt.system,user:prompt.messages[0].content,remoteConsent:!remote||consent,refs:prompt.resumeRefs});automaticAnswer.current=fromAutomatic?id:null}catch{setMessage('无法发起回答，请检查模型配置。');if(fromAutomatic)setAutoStatus('无法发起回答，请检查模型配置。')}
  }
  useEffect(()=>window.interviewAPI.onRetryAnswer(q=>{
    if(!configured || (remote&&!consent)){setMessage('请先开启面试，或在此确认模型数据使用后重试。');window.interviewAPI.openSettings();return}
    const version=++sequence.current;pending.current=[];void window.interviewAPI.cancelSemanticKnowledgeSearch()
    setQuestion(q);setAutoStatus('正在重新生成回答…');void generate(q,{},false,version)
  }))
  useEffect(()=>window.interviewAPI.onSemanticKnowledgeCancelled(()=>{sequence.current++;pending.current=[];setKnowledgeStatus('本次检索已停止。')}),[])
  useEffect(()=>()=>{sequence.current++;pending.current=[];void window.interviewAPI.cancelAnswer()},[])
  useEffect(()=>{
    if(!candidate || !automatic || !configured || (remote&&!consent))return
    const version=++sequence.current;void window.interviewAPI.cancelSemanticKnowledgeSearch();pending.current.push(candidate.text)
    const timer=setTimeout(()=>{
      const utterance=pending.current.join(' ').slice(-1500);pending.current=[]
      void (async()=>{
        try {
          if(version!==sequence.current)return
          const result=await resolveAutomaticTurn({utterance,context:formatSpeechContext(speechRef.current).slice(-5000),resume,bank,webEnabled:()=>webEnabledRef.current},{classify:(value,context)=>window.interviewAPI.classifyUtterance({utterance:value,context,consent:!remote||consent}),search:topic=>window.interviewAPI.searchPublicTopic(topic,true),isCurrent:()=>version===sequence.current,status:setAutoStatus})
          if(result.type!=='ready'){if(result.type==='ignored')setAutoStatus(result.message);return}
          setSources(result.sources);setQuestion(result.question);setAutoStatus(result.message)
          await generate(result.question,{kind:result.kind,bank:result.bank,webReference:result.webReference,webUnavailable:result.webUnavailable},true,version)
        }catch {if(version===sequence.current)setAutoStatus('问题判断失败，请检查模型连接；本次未自动回答。')}
      })()
    },900)
    return()=>clearTimeout(timer)
  },[candidate?.id])
  const refLabel=(ref:string):string=>{
    const [kind,key,field,index]=ref.split(':')
    if(kind==='experience'){const row=resume.experiences.find(x=>x.id===key);return `${row?.company||'工作经历'} · 要点 ${Number(index??0)+1}`}
    if(kind==='project'){const row=resume.projects.find(x=>x.id===key);return `${row?.name||'项目经历'} · ${field==='result'?'结果':field==='contribution'?'个人贡献':`要点 ${Number(index??0)+1}`}`}
    if(kind==='knowledge'){const row=knowledge.find(x=>x.id===key);return `知识资料：${row?.title||'已移除的资料'}`}
    if(kind==='custom'){
      const row=resume.customSections.find(x=>x.id===key)
      const heading=row?.items[Number(field)]?.trim()
      return heading && /^\d+[.、．]\s*/u.test(heading) ? `准备问答：${heading}` : row?.title||'个人资料'
    }
    return '简历素材'
  }
  const patch=(value:Partial<AnswerInstruction>):void=>setInstructions(instructions.map(x=>x.id===instruction.id?{...x,...value}:x))
  return <section className="card" id="step-answer"><div className="section-heading"><div><span className="number">03 / TRY A QUESTION</span><h2>输入一道问题，试着生成回答</h2></div><span className="badge">{answer?.status??'待命'}</span></div>
    <p className="muted">这是最快的试用方式，不需要开启麦克风或实时转写。{remote?`生成时，问题、相关简历、问题库要点、相关知识资料及本次会话转写会发送至 ${host}。语义检索会将全部知识主题及问题发送至已配置的模型服务，可能产生额外用量；向量服务不可用时，可能改由回答模型筛选。`:'问题、会话转写和本地资料只在本机模型处理。'}</p>
    {!configured&&<p className="step-hint">先完成上方“连接回答模型”，然后回到这里输入问题。</p>}
    {remote&&<label className="consent"><input type="checkbox" checked={consent} disabled={!configured} onChange={e=>{setConsent(e.target.checked);if(!e.target.checked){sequence.current++;pending.current=[];void window.interviewAPI.revokeAnswerConsent()}}}/> 我同意将问题、相关简历、问题库要点、知识资料（语义检索时发送全部主题）和本次会话转写发送至 {host}</label>}
    <label className="question-field">面试问题<textarea value={question} onChange={e=>setQuestion(e.target.value)} placeholder="例如：请介绍一个你负责的项目，以及你做出的关键贡献。"/></label>
    <div className="action-line answer-actions"><button className="primary" type="button" disabled={!configured||!question.trim()||(remote&&!consent)} onClick={()=>{const version=++sequence.current;pending.current=[];void window.interviewAPI.cancelSemanticKnowledgeSearch();void generate(question,{},false,version)}}>生成回答</button><button type="button" onClick={()=>{sequence.current++;pending.current=[];setKnowledgeStatus('本次检索已停止。');void window.interviewAPI.cancelSemanticKnowledgeSearch();void window.interviewAPI.cancelAnswer()}}>停止当前回答</button></div>
    {message&&<p className="muted" role="status">{message}</p>}
    {knowledgeStatus&&<p className="muted" role="status">{knowledgeStatus}</p>}
    {answer&&<div className="answer-preview"><strong>{answer.question}</strong><ReactMarkdown remarkPlugins={[remarkGfm,remarkMath]} rehypePlugins={[rehypeKatex]} components={{a:({children})=><span>{children}</span>,img:()=>null}}>{answer.text}</ReactMarkdown>{answer.error&&<p className="warning">{answer.error}</p>}{answer.refs.length>0&&<p className="muted">参考素材：{answer.refs.map(refLabel).join('、')}</p>}{answer.text&&<button type="button" onClick={()=>void navigator.clipboard.writeText(answer.text)}>复制回答</button>}</div>}
    {autoStatus&&<p className="muted" role="status">{autoStatus}</p>}
    {sources.length>0&&<div className="guard-info">公开资料来源：{sources.map((source,index)=><div key={index}>{source.title} — {source.url}</div>)}</div>}
    <details className="advanced-settings"><summary>高级设置：自动生成与回答风格</summary>
      <label className="consent"><input type="checkbox" checked={automatic} disabled={!configured||(remote&&!consent)} onChange={e=>{setAutomatic(e.target.checked);if(!e.target.checked){sequence.current++;pending.current=[];void window.interviewAPI.cancelSemanticKnowledgeSearch();setKnowledgeStatus('自动回答已关闭。');setAutoStatus('自动回答已关闭')}}}/> 由模型判断提问和追问并自动生成回答</label>
      <label className="consent"><input type="checkbox" checked={webEnabled} onChange={e=>{webEnabledRef.current=e.target.checked;setWebEnabled(e.target.checked)}}/> 必要时使用百炼北京地域自动联网查询公开资料（搜索可能额外按次收费）</label>
      <p className="muted">联网只发送预设的公开主题查询，不发送简历、问题库或会话原文；目前覆盖 React、Electron、TypeScript、Node.js、Python、Kubernetes、Docker、JavaScript 和 OpenAI。其他主题或涉及个人信息的问题会跳过联网。无需逐题确认。</p>
      <div className="form-grid"><label>回答风格<select value={instruction?.id??''} onChange={e=>setSelected(e.target.value)}>{instructions.map(x=><option key={x.id} value={x.id}>{x.title}</option>)}</select></label><label>指令名称<input value={instruction?.title??''} onChange={e=>patch({title:e.target.value})}/></label><label className="wide">回答指令<textarea value={instruction?.body??''} onChange={e=>patch({body:e.target.value})}/></label></div>
      <button type="button" onClick={()=>{const item={id:crypto.randomUUID(),title:'自定义指令',body:'请使用自然口语作答。'};setInstructions([...instructions,item]);setSelected(item.id)}}>＋ 新建回答风格</button>
    </details>
  </section>
}
