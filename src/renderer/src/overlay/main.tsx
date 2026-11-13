import React, { useEffect, useState } from 'react'
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
  useEffect(()=>{
    const offAudio=window.interviewAPI.onAudioStatus(value=>{setAudio(value);if(value.phase==='connecting')setTranscript('')})
    const offText=window.interviewAPI.onTranscript(value=>setTranscript(value.text))
    const offAnswer=window.interviewAPI.onAnswer(setAnswer)
    return()=>{offAudio();offText();offAnswer()}
  },[])
  useEffect(()=>{
    const move=(event:MouseEvent):void=>{
      const interactive=Boolean(document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-interactive]'))
      window.interviewAPI.setIgnoreMouse(!interactive)
    }
    const leave=():void=>window.interviewAPI.setIgnoreMouse(true)
    window.addEventListener('mousemove',move);document.addEventListener('mouseleave',leave)
    return()=>{window.removeEventListener('mousemove',move);document.removeEventListener('mouseleave',leave)}
  },[])
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
      <div className="headline"><span className="accent-line"/><div><h1>面试辅助工作台</h1><p>YOUR THINKING PARTNER</p></div></div>
      {answer ? <div className="answer-content" data-interactive><div className="answer-question">{answer.question}</div><div className="answer-markdown"><ReactMarkdown remarkPlugins={[remarkGfm,remarkMath]} rehypePlugins={[rehypeKatex]} components={{a:({children})=><span>{children}</span>,img:()=>null}}>{answer.text}</ReactMarkdown></div>{answer.error&&<p className="answer-error">{answer.error}</p>}<div className="answer-actions"><button data-interactive type="button" onClick={()=>void window.interviewAPI.cancelAnswer()}>停止 / 下一题</button>{answer.text&&<button data-interactive type="button" onClick={()=>void navigator.clipboard.writeText(answer.text)}>复制</button>}</div></div> : <div className="notice"><span className="notice-index">01</span><div><strong>{transcript?'实时转写':'准备开始'}</strong><p>{transcript||'在设置中启动系统音频转写或手动提问。'}</p></div></div>}
      <div className="footer"><span>ALT / OPTION + SHIFT + H 隐藏或恢复</span><span>TAC / 01</span></div>
    </section>}
  </main>
}
createRoot(document.getElementById('root')!).render(<App/>)
