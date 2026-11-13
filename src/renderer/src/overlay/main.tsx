import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import './style.css'

function App(): React.JSX.Element {
  const [collapsed,setCollapsed]=useState(false)
  const [audio,setAudio]=useState({phase:'idle',level:0})
  const [transcript,setTranscript]=useState('')
  const [answer,setAnswer]=useState<AnswerUpdate|null>(null)
  const [autoStatus,setAutoStatus]=useState('')
  const resizePointer=useRef<number|null>(null)
  useEffect(()=>{
    const offAudio=window.interviewAPI.onAudioStatus(value=>{setAudio(value);if(value.phase==='connecting')setTranscript('')})
    const offText=window.interviewAPI.onTranscript(value=>setTranscript(value.text))
    const offAnswer=window.interviewAPI.onAnswer(setAnswer)
    const offAuto=window.interviewAPI.onAutoStatus(setAutoStatus)
    return()=>{offAudio();offText();offAnswer();offAuto()}
  },[])
  const beginResize=(event:React.PointerEvent<HTMLDivElement>):void=>{
    if(event.button!==0) return
    event.preventDefault()
    event.stopPropagation()
    resizePointer.current=event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    window.interviewAPI.beginWindowResize()
  }
  const updateResize=(event:React.PointerEvent<HTMLDivElement>):void=>{
    if(resizePointer.current!==event.pointerId) return
    if((event.buttons&1)===0){endResize(event);return}
    window.interviewAPI.updateWindowResize(event.buttons)
  }
  const endResize=(event:React.PointerEvent<HTMLDivElement>):void=>{
    if(resizePointer.current!==event.pointerId) return
    event.stopPropagation()
    resizePointer.current=null
    window.interviewAPI.endWindowResize()
    if(event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const toggle=():void=>{const next=!collapsed;setCollapsed(next);window.interviewAPI.setCollapsed(next)}
  return <main className={`panel${collapsed?' collapsed':''}`}>
    <header className="titlebar" data-interactive>
      <div className="identity"><span className="mark">TAC</span><span className="divider"/><span className="product">INTERVIEW AGENT</span></div>
      <div className="controls">
        <button data-interactive onClick={()=>window.interviewAPI.openSettings()} aria-label="打开设置" title="设置">⚙</button>
        <button data-interactive onClick={toggle} aria-label={collapsed?'展开窗口':'收起窗口'} title={collapsed?'展开':'收起'}>{collapsed?'□':'⌃'}</button>
        <button data-interactive className="close" onClick={()=>window.interviewAPI.hide()} aria-label="隐藏悬浮窗" title="隐藏悬浮窗">×</button>
      </div>
    </header>
    {!collapsed && <section className="content">
      <div className="eyebrow"><span className="status-dot"/> {audio.phase.toUpperCase()} <span className="stage">{audio.phase==='idle'?'INTERVIEW ASSISTANT':audio.phase==='testing'?'仅本机检测':'音频 → 腾讯云'}</span></div>
      {autoStatus&&<div className="auto-status">{autoStatus}</div>}
      <div className="headline"><span className="accent-line"/><div><h1>面试辅助工作台</h1><p>YOUR THINKING PARTNER</p></div></div>
      {answer ? <div className="answer-content" data-interactive><div className="answer-question">{answer.question}</div><div className="answer-markdown"><ReactMarkdown remarkPlugins={[remarkGfm,remarkMath]} rehypePlugins={[rehypeKatex]} components={{a:({children})=><span>{children}</span>,img:()=>null}}>{answer.text}</ReactMarkdown></div>{answer.error&&<p className="answer-error">{answer.error}</p>}<div className="answer-actions"><button data-interactive type="button" onClick={()=>void window.interviewAPI.cancelAnswer()}>停止 / 下一题</button>{answer.text&&<button data-interactive type="button" onClick={()=>void navigator.clipboard.writeText(answer.text)}>复制</button>}</div></div> : <div className="notice"><span className="notice-index">01</span><div><strong>{transcript?'实时转写':'准备开始'}</strong><p>{transcript||'在设置中启动系统音频转写或手动提问。'}</p></div></div>}
      <div className="footer"><span>ALT / OPTION + SHIFT + H 隐藏或恢复</span><span>TAC / 01</span></div>
    </section>}
    <div className="resize-grip" data-interactive role="button" aria-label="拖动以调整窗口大小" title="拖动以调整窗口大小" onPointerDown={beginResize} onPointerMove={updateResize} onPointerUp={endResize} onPointerCancel={endResize} onLostPointerCapture={endResize}><span/></div>
  </main>
}
createRoot(document.getElementById('root')!).render(<App/>)
