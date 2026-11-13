import React, { useState } from 'react'
import { QUESTION_BANK_KEY, type QuestionBankEntry } from '../session/question-bank'

export function QuestionBankPanel({entries,setEntries}:{entries:QuestionBankEntry[];setEntries:(value:QuestionBankEntry[])=>void}):React.JSX.Element {
  const [question,setQuestion]=useState(''),[answer,setAnswer]=useState(''),[message,setMessage]=useState('')
  const save=(next:QuestionBankEntry[]):boolean=>{
    try {localStorage.setItem(QUESTION_BANK_KEY,JSON.stringify(next));setEntries(next);setMessage('问题库已保存在本机。');return true}
    catch {setMessage('保存失败，请检查本机存储空间。');return false}
  }
  return <section className="card" id="step-bank"><div className="section-heading"><div><span className="number">OPTIONAL / QUESTION BANK</span><h2>面试问题库</h2></div><span className="badge">{entries.length} 条 · 本机保存</span></div>
    <p className="muted">提前记录问题与回答要点。识别到相似问题时，相关要点会作为生成建议的参考；使用云模型时，匹配到的要点会发送给模型服务商。</p>
    <div className="form-grid"><label className="wide">问题<textarea value={question} maxLength={1000} onChange={event=>setQuestion(event.target.value)} placeholder="例如：介绍一次处理线上故障的经历"/></label><label className="wide">准备好的回答要点<textarea value={answer} maxLength={4000} onChange={event=>setAnswer(event.target.value)} placeholder="记录真实经历、思路或可引用的要点"/></label></div>
    <button type="button" className="primary" disabled={!question.trim()||!answer.trim()||entries.length>=200} onClick={()=>{if(save([...entries,{id:crypto.randomUUID(),question:question.trim(),answer:answer.trim()}])){setQuestion('');setAnswer('')}}}>添加到问题库</button>
    {entries.map(entry=><div className="editor-block" key={entry.id}><strong>{entry.question}</strong><p className="muted">{entry.answer}</p><button type="button" onClick={()=>save(entries.filter(item=>item.id!==entry.id))}>移除</button></div>)}
    {message&&<p className="muted" role="status">{message}</p>}
  </section>
}
