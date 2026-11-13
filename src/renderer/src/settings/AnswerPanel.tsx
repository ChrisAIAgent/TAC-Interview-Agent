import React, { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { buildPrompt, type ConversationTurn } from '../prompt/build'
import { detectQuestion } from '../session/questionDetect'
import type { AnswerInstruction, Resume } from '../shared/resume'
const builtins:AnswerInstruction[]=[
  {id:'concise',title:'简洁口语',body:'用自然口语回答，先说结论，再用真实经历支撑，控制在 4 至 6 句话。',builtin:true},
  {id:'star',title:'STAR 结构',body:'按背景、任务、行动和结果组织回答，优先说明本人贡献，不编造数字。',builtin:true},
  {id:'technical',title:'技术深入',body:'说明技术选择、关键权衡和实际结果，信息不足时明确说明。',builtin:true},
]
function initialInstructions():AnswerInstruction[]{
  try{const value:unknown=JSON.parse(localStorage.getItem('tac-answer-instructions')||'null');if(Array.isArray(value)&&value.length&&value.every(x=>x&&typeof x.id==='string'&&typeof x.title==='string'&&typeof x.body==='string'))return value as AnswerInstruction[]}catch{/* Ignore invalid settings. */}
  return builtins.map(x=>({...x}))
}
export function AnswerPanel({resume,candidate,provider,host}:{resume:Resume;candidate:{id:number;text:string}|null;provider:string;host:string}):React.JSX.Element {
  const [question,setQuestion]=useState(''),[answer,setAnswer]=useState<AnswerUpdate|null>(null)
  const [consent,setConsent]=useState(false),[automatic,setAutomatic]=useState(false)
  const [instructions,setInstructions]=useState<AnswerInstruction[]>(initialInstructions)
  const [selected,setSelected]=useState('concise'),[message,setMessage]=useState(''),[testing,setTesting]=useState(false)
  const history=useRef<ConversationTurn[]>([]),seen=useRef<string[]>([]),done=useRef(new Set<string>())
  const remote=provider!=='ollama'
  const instruction=instructions.find(x=>x.id===selected)??instructions[0]
  useEffect(()=>{localStorage.setItem('tac-answer-instructions',JSON.stringify(instructions))},[instructions])
  useEffect(()=>window.interviewAPI.onAnswer(value=>{
    setAnswer(value)
    if(value.status==='done'&&!done.current.has(value.id)){done.current.add(value.id);history.current=[...history.current,{question:value.question,answer:value.text}].slice(-3)}
  }),[])
  const generate=async(text:string):Promise<void>=>{
    const q=text.trim();if(!q || !instruction || (remote&&!consent))return
    const prompt=buildPrompt(resume,instruction,q,history.current)
    try{setMessage('');await window.interviewAPI.startAnswer({question:q,system:prompt.system,user:prompt.messages[0].content,remoteConsent:!remote||consent,refs:prompt.resumeRefs});seen.current=[...seen.current,q].slice(-5)}catch{setMessage('无法发起回答，请检查模型配置。')}
  }
  useEffect(()=>{
    if(!candidate || !automatic || (remote&&!consent))return
    if(detectQuestion(candidate.text,true,seen.current).isQuestion){setQuestion(candidate.text);void generate(candidate.text)}
  },[candidate?.id])
  const testConnection=async():Promise<void>=>{
    setTesting(true);setMessage('')
    try{const result=await window.interviewAPI.testModel(!remote||consent);setMessage(result.ok?`连接成功（${result.latencyMs} ms）。`:result.error??'连接失败。')}
    catch{setMessage('模型连接失败，请先保存配置并检查授权。')}finally{setTesting(false)}
  }
  const refLabel=(ref:string):string=>{
    const [kind,key,field,index]=ref.split(':')
    if(kind==='experience'){const row=resume.experiences.find(x=>x.id===key);return `${row?.company||'工作经历'} · 要点 ${Number(index??0)+1}`}
    if(kind==='project'){const row=resume.projects.find(x=>x.id===key);return `${row?.name||'项目经历'} · ${field==='result'?'结果':field==='contribution'?'个人贡献':`要点 ${Number(index??0)+1}`}`}
    return '简历素材'
  }
  const patch=(value:Partial<AnswerInstruction>):void=>setInstructions(instructions.map(x=>x.id===instruction.id?{...x,...value}:x))
  return <section className="card"><div className="section-heading"><div><span className="number">04 / ANSWER</span><h2>面试回答</h2></div><span className="badge">{answer?.status??'待命'}</span></div>
    <p className="muted">{remote?`生成时会把问题文字和相关简历片段发送至 ${host}。`:'使用本机 Ollama 生成；问题和简历片段不发送至远程模型。'} 仅根据真实材料作答。</p>
    {remote&&<label className="consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> 我同意将问题及相关简历片段发送至 {host}</label>}
    <label className="consent"><input type="checkbox" checked={automatic} disabled={remote&&!consent} onChange={e=>setAutomatic(e.target.checked)}/> 转写识别到问题后自动生成回答</label>
    <div className="form-grid"><label>回答指令<select value={instruction?.id??''} onChange={e=>setSelected(e.target.value)}>{instructions.map(x=><option key={x.id} value={x.id}>{x.title}</option>)}</select></label><label>指令名称<input value={instruction?.title??''} onChange={e=>patch({title:e.target.value})}/></label><label className="wide">指令内容<textarea value={instruction?.body??''} onChange={e=>patch({body:e.target.value})}/></label></div>
    <button type="button" onClick={()=>{const item={id:crypto.randomUUID(),title:'自定义指令',body:'请使用自然口语作答。'};setInstructions([...instructions,item]);setSelected(item.id)}}>＋ 新建回答指令</button>
    <label className="question-field">手动提问<textarea value={question} onChange={e=>setQuestion(e.target.value)} placeholder="例如：请介绍一个你负责的项目"/></label>
    <div className="action-line"><button className="primary" type="button" disabled={!question.trim()||(remote&&!consent)} onClick={()=>void generate(question)}>生成回答 →</button><button type="button" onClick={()=>void window.interviewAPI.cancelAnswer()}>停止 / 下一题</button><button type="button" disabled={testing||(remote&&!consent)} onClick={()=>void testConnection()}>测试模型连接</button></div>
    {message&&<p className="muted" role="status">{message}</p>}
    {answer&&<div className="answer-preview"><strong>{answer.question}</strong><ReactMarkdown remarkPlugins={[remarkGfm,remarkMath]} rehypePlugins={[rehypeKatex]} components={{a:({children})=><span>{children}</span>,img:()=>null}}>{answer.text}</ReactMarkdown>{answer.error&&<p className="warning">{answer.error}</p>}{answer.refs.length>0&&<p className="muted">参考素材：{answer.refs.map(refLabel).join('、')}</p>}{answer.text&&<button type="button" onClick={()=>void navigator.clipboard.writeText(answer.text)}>复制回答</button>}</div>}
  </section>
}
