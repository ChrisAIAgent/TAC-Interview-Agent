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
const builtins:AnswerInstruction[]=[
  {id:'concise',title:'简洁口语',body:'用自然口语回答，先说结论，再用真实经历支撑，控制在 4 至 6 句话。',builtin:true},
  {id:'star',title:'STAR 结构',body:'按背景、任务、行动和结果组织回答，优先说明本人贡献，不编造数字。',builtin:true},
  {id:'technical',title:'技术深入',body:'说明技术选择、关键权衡和实际结果，信息不足时明确说明。',builtin:true},
]
function initialInstructions():AnswerInstruction[]{
  try{const value:unknown=JSON.parse(localStorage.getItem('tac-answer-instructions')||'null');if(Array.isArray(value)&&value.length&&value.every(x=>x&&typeof x.id==='string'&&typeof x.title==='string'&&typeof x.body==='string'))return value as AnswerInstruction[]}catch{/* Ignore invalid settings. */}
  return builtins.map(x=>({...x}))
}
export function AnswerPanel({resume,candidate,speech,sessionId,provider,host,configured,bank}:{resume:Resume;candidate:{id:number;text:string}|null;speech:SpeechTurn[];sessionId:number;provider:string;host:string;configured:boolean;bank:QuestionBankEntry[]}):React.JSX.Element {
  const [question,setQuestion]=useState(''),[answer,setAnswer]=useState<AnswerUpdate|null>(null)
  const [consent,setConsent]=useState(false),[automatic,setAutomatic]=useState(false)
  const [webEnabled,setWebEnabled]=useState(false),[autoStatus,setAutoStatus]=useState('')
  const [sources,setSources]=useState<{title:string;url:string}[]>([])
  const [instructions,setInstructions]=useState<AnswerInstruction[]>(initialInstructions)
  const [selected,setSelected]=useState('concise'),[message,setMessage]=useState('')
  const history=useRef<ConversationTurn[]>([]),done=useRef(new Set<string>())
  const automaticAnswer=useRef<string|null>(null)
  const speechRef=useRef(speech);speechRef.current=speech
  const webEnabledRef=useRef(webEnabled);webEnabledRef.current=webEnabled
  const sequence=useRef(0),pending=useRef<string[]>([])
  const remote=provider!=='ollama'
  const instruction=instructions.find(x=>x.id===selected)??instructions[0]
  useEffect(()=>{history.current=[];done.current.clear();automaticAnswer.current=null;pending.current=[];sequence.current++;setSources([]);setAutoStatus('')},[sessionId])
  useEffect(()=>{localStorage.setItem('tac-answer-instructions',JSON.stringify(instructions))},[instructions])
  useEffect(()=>{window.interviewAPI.publishAutoStatus(autoStatus)},[autoStatus])
  useEffect(()=>window.interviewAPI.onAnswer(value=>{
    setAnswer(value)
    if(value.status==='done'&&!done.current.has(value.id)){done.current.add(value.id);history.current=[...history.current,{question:value.question,answer:value.text}].slice(-3)}
    if(value.id===automaticAnswer.current && value.status==='done')setAutoStatus(previous=>previous.includes('未核验')||previous.includes('跳过联网')?`${previous} · 回答已生成`:'回答已生成')
    if(value.id===automaticAnswer.current && value.status==='error')setAutoStatus('自动回答失败，请检查模型服务。')
  }),[])
  const generate=async(text:string,options:Parameters<typeof buildPrompt>[5]={},fromAutomatic=false):Promise<void>=>{
    const q=text.trim();if(!q || !instruction || (remote&&!consent))return
    const prompt=buildPrompt(resume,instruction,q,history.current,speechRef.current,{...options,bank:options?.bank??findQuestionBankMatches(q,bank)})
    try{setMessage('');const id=await window.interviewAPI.startAnswer({question:q,system:prompt.system,user:prompt.messages[0].content,remoteConsent:!remote||consent,refs:prompt.resumeRefs});automaticAnswer.current=fromAutomatic?id:null}catch{setMessage('无法发起回答，请检查模型配置。')}
  }
  useEffect(()=>{
    if(!candidate || !automatic || !configured || (remote&&!consent))return
    const version=++sequence.current;pending.current.push(candidate.text)
    const timer=setTimeout(()=>{
      const utterance=pending.current.join(' ').slice(-1500);pending.current=[]
      void (async()=>{
        try {
          if(version!==sequence.current)return
          const result=await resolveAutomaticTurn({utterance,context:formatSpeechContext(speechRef.current).slice(-5000),resume,bank,webEnabled:()=>webEnabledRef.current},{classify:(value,context)=>window.interviewAPI.classifyUtterance({utterance:value,context,consent:!remote||consent}),search:topic=>window.interviewAPI.searchPublicTopic(topic,true),isCurrent:()=>version===sequence.current,status:setAutoStatus})
          if(result.type!=='ready'){if(result.type==='ignored')setAutoStatus(result.message);return}
          setSources(result.sources);setQuestion(result.question);setAutoStatus(result.message)
          await generate(result.question,{kind:result.kind,bank:result.bank,webReference:result.webReference,webUnavailable:result.webUnavailable},true)
        }catch {if(version===sequence.current)setAutoStatus('问题判断失败，请检查模型连接；本次未自动回答。')}
      })()
    },900)
    return()=>clearTimeout(timer)
  },[candidate?.id])
  const refLabel=(ref:string):string=>{
    const [kind,key,field,index]=ref.split(':')
    if(kind==='experience'){const row=resume.experiences.find(x=>x.id===key);return `${row?.company||'工作经历'} · 要点 ${Number(index??0)+1}`}
    if(kind==='project'){const row=resume.projects.find(x=>x.id===key);return `${row?.name||'项目经历'} · ${field==='result'?'结果':field==='contribution'?'个人贡献':`要点 ${Number(index??0)+1}`}`}
    return '简历素材'
  }
  const patch=(value:Partial<AnswerInstruction>):void=>setInstructions(instructions.map(x=>x.id===instruction.id?{...x,...value}:x))
  return <section className="card" id="step-answer"><div className="section-heading"><div><span className="number">03 / TRY A QUESTION</span><h2>输入一道问题，试着生成回答</h2></div><span className="badge">{answer?.status??'待命'}</span></div>
    <p className="muted">这是最快的试用方式，不需要开启麦克风或实时转写。{remote?`生成时，问题、相关简历与问题库要点及本次会话转写会发送至 ${host}。`:'问题、会话转写和本地资料只在本机模型处理。'}</p>
    {!configured&&<p className="step-hint">先完成上方“连接回答模型”，然后回到这里输入问题。</p>}
    {remote&&<label className="consent"><input type="checkbox" checked={consent} disabled={!configured} onChange={e=>{setConsent(e.target.checked);if(!e.target.checked){sequence.current++;pending.current=[]}}}/> 我同意将问题、相关简历与问题库要点和本次会话转写发送至 {host}</label>}
    <label className="question-field">面试问题<textarea value={question} onChange={e=>setQuestion(e.target.value)} placeholder="例如：请介绍一个你负责的项目，以及你做出的关键贡献。"/></label>
    <div className="action-line answer-actions"><button className="primary" type="button" disabled={!configured||!question.trim()||(remote&&!consent)} onClick={()=>void generate(question)}>生成回答</button><button type="button" onClick={()=>void window.interviewAPI.cancelAnswer()}>停止当前回答</button></div>
    {message&&<p className="muted" role="status">{message}</p>}
    {answer&&<div className="answer-preview"><strong>{answer.question}</strong><ReactMarkdown remarkPlugins={[remarkGfm,remarkMath]} rehypePlugins={[rehypeKatex]} components={{a:({children})=><span>{children}</span>,img:()=>null}}>{answer.text}</ReactMarkdown>{answer.error&&<p className="warning">{answer.error}</p>}{answer.refs.length>0&&<p className="muted">参考素材：{answer.refs.map(refLabel).join('、')}</p>}{answer.text&&<button type="button" onClick={()=>void navigator.clipboard.writeText(answer.text)}>复制回答</button>}</div>}
    {autoStatus&&<p className="muted" role="status">{autoStatus}</p>}
    {sources.length>0&&<div className="guard-info">公开资料来源：{sources.map((source,index)=><div key={index}>{source.title} — {source.url}</div>)}</div>}
    <details className="advanced-settings"><summary>高级设置：自动生成与回答风格</summary>
      <label className="consent"><input type="checkbox" checked={automatic} disabled={!configured||(remote&&!consent)} onChange={e=>{setAutomatic(e.target.checked);if(!e.target.checked){sequence.current++;pending.current=[];setAutoStatus('自动回答已关闭')}}}/> 由模型判断提问和追问并自动生成回答</label>
      <label className="consent"><input type="checkbox" checked={webEnabled} onChange={e=>{webEnabledRef.current=e.target.checked;setWebEnabled(e.target.checked)}}/> 必要时使用百炼北京地域自动联网查询公开资料（搜索可能额外按次收费）</label>
      <p className="muted">联网只发送预设的公开主题查询，不发送简历、问题库或会话原文；目前覆盖 React、Electron、TypeScript、Node.js、Python、Kubernetes、Docker、JavaScript 和 OpenAI。其他主题或涉及个人信息的问题会跳过联网。无需逐题确认。</p>
      <div className="form-grid"><label>回答风格<select value={instruction?.id??''} onChange={e=>setSelected(e.target.value)}>{instructions.map(x=><option key={x.id} value={x.id}>{x.title}</option>)}</select></label><label>指令名称<input value={instruction?.title??''} onChange={e=>patch({title:e.target.value})}/></label><label className="wide">回答指令<textarea value={instruction?.body??''} onChange={e=>patch({body:e.target.value})}/></label></div>
      <button type="button" onClick={()=>{const item={id:crypto.randomUUID(),title:'自定义指令',body:'请使用自然口语作答。'};setInstructions([...instructions,item]);setSelected(item.id)}}>＋ 新建回答风格</button>
    </details>
  </section>
}
