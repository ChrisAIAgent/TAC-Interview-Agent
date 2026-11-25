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
  const [transcript,setTranscript]=useState<{text:string;isFinal:boolean}|null>(null)
  const [answer,setAnswer]=useState<AnswerUpdate|null>(null)
  const [autoStatus,setAutoStatus]=useState('')
  const [englishEnabled,setEnglishEnabled]=useState(false)
  const [englishControlError,setEnglishControlError]=useState('')
  const englishChange=useRef(0)
  const resizePointer=useRef<number|null>(null)
  useEffect(()=>{
    let alive=true,receivedEnglishUpdate=false
    const offEnglish=window.interviewAPI.onEnglishEnabled(value=>{receivedEnglishUpdate=true;setEnglishEnabled(value)})
    void window.interviewAPI.getEnglishEnabled().then(value=>{if(alive&&!receivedEnglishUpdate)setEnglishEnabled(value)}).catch(()=>{if(alive)setEnglishControlError('无法读取英文回答设置。')})
    const offAudio=window.interviewAPI.onAudioStatus(value=>{
      setAudio(value)
      if(value.phase==='connecting')setTranscript(null)
      else if(value.phase==='stopped'||value.phase==='failed')setTranscript(previous=>previous?.isFinal?previous:null)
    })
    const offText=window.interviewAPI.onTranscript(value=>setTranscript({text:value.text,isFinal:value.isFinal}))
    const offAnswer=window.interviewAPI.onAnswer(value=>{
      setAnswer(value)
      if(value.status==='interrupted')setAutoStatus('回答已中断，可以重新生成。')
      else if(value.status==='error')setAutoStatus('回答生成失败，可以重试。')
      else if(value.status==='thinking')setAutoStatus('正在生成回答…')
      else if(value.status==='done')setAutoStatus(previous=>previous.includes('未核验')?(previous.includes('回答已生成')?previous:`${previous} · 回答已生成`):'回答已生成')
    })
    const offAuto=window.interviewAPI.onAutoStatus(setAutoStatus)
    return()=>{alive=false;offEnglish();offAudio();offText();offAnswer();offAuto()}
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
  const interviewActive=['testing','connecting','listening','paused','reconnecting'].includes(audio.phase)
  const toggleInterview=():void=>{
    if(!interviewActive)setAudio({phase:'connecting',level:0})
    window.interviewAPI.controlInterview(interviewActive?'stop':'start')
  }
  const toggleEnglish=(enabled:boolean):void=>{
    const previous=englishEnabled,revision=++englishChange.current
    setEnglishEnabled(enabled);setEnglishControlError('')
    void window.interviewAPI.setEnglishEnabled(enabled).then(value=>{if(revision===englishChange.current)setEnglishEnabled(value)}).catch(()=>{
      if(revision===englishChange.current){setEnglishEnabled(previous);setEnglishControlError('无法更新英文回答设置，请重试。')}
    })
  }
  return <main className={`panel${collapsed?' collapsed':''}`}>
    <header className="titlebar" data-interactive>
      <div className="identity"><span className="mark">TAC</span><span className="divider"/><span className="product">INTERVIEW AGENT</span></div>
      <div className="controls">
        <label className="english-toggle" data-interactive title="中文回答完成后生成英文版本，会增加模型调用"><input data-interactive type="checkbox" checked={englishEnabled} onChange={event=>toggleEnglish(event.target.checked)}/><span>英文回答</span></label>
        <button data-interactive className={`interview-toggle${interviewActive?' active':''}`} onClick={toggleInterview} title={interviewActive?'结束面试并停止音频上传':'开启后音频发送至腾讯云，知识资料及问题发送至已配置的模型服务用于检索和回答'}>{interviewActive?'结束面试':'开启面试'}</button>
        <button data-interactive onClick={()=>window.interviewAPI.openSettings()} aria-label="打开设置" title="设置">⚙</button>
        <button data-interactive onClick={toggle} aria-label={collapsed?'展开窗口':'收起窗口'} title={collapsed?'展开':'收起'}>{collapsed?'□':'⌃'}</button>
        <button data-interactive className="close" onClick={()=>window.interviewAPI.hide()} aria-label="隐藏悬浮窗" title="隐藏悬浮窗">×</button>
      </div>
    </header>
    {!collapsed && <section className="content">
      <div className="eyebrow"><span className="status-dot"/> {audio.phase.toUpperCase()} <span className="stage">{audio.phase==='idle'?'INTERVIEW ASSISTANT':audio.phase==='testing'?'仅本机检测':'音频 → 腾讯云'}</span></div>
      {autoStatus&&<div className="auto-status">{autoStatus}</div>}
      {englishControlError&&<div className="auto-status" role="alert">{englishControlError}</div>}
      {audio.phase==='failed'&&<div className="auto-status">启动失败，请打开设置检查音频权限和配置。</div>}
      {transcript?.text&&<div className="live-transcript" data-interactive aria-live="polite"><strong>{transcript.isFinal?'识别完成':'正在识别…'}</strong><p>{transcript.text}</p></div>}
      {answer ? <div className="answer-content" data-interactive>
        <div className="answer-question">{answer.question}</div>
        {englishEnabled&&<div className="answer-language">中文回答</div>}
        <div className="answer-markdown"><ReactMarkdown remarkPlugins={[remarkGfm,remarkMath]} rehypePlugins={[rehypeKatex]} components={{a:({children})=><span>{children}</span>,img:()=>null}}>{answer.text}</ReactMarkdown></div>
        {answer.status==='interrupted'&&<p className="answer-error">回答已中断。</p>}{answer.error&&<p className="answer-error">{answer.error}</p>}
        {englishEnabled&&<div className="english-answer" aria-live="polite">
          <div className="answer-language">英文回答</div>
          {answer.englishText&&<div className="answer-markdown"><ReactMarkdown remarkPlugins={[remarkGfm,remarkMath]} rehypePlugins={[rehypeKatex]} components={{a:({children})=><span>{children}</span>,img:()=>null}}>{answer.englishText}</ReactMarkdown></div>}
          {answer.englishStatus==='translating'&&<p className="english-status">正在生成英文回答…</p>}
          {answer.englishStatus==='idle'&&answer.status!=='error'&&answer.status!=='interrupted'&&<p className="english-status">{answer.status==='done'?'暂未生成英文回答':'中文回答完成后生成'}</p>}
          {answer.englishStatus==='error'&&<div className="english-failure"><p className="answer-error">{answer.englishError||'英文回答生成失败。'}</p><button data-interactive type="button" onClick={()=>void window.interviewAPI.retryEnglish().catch(()=>setEnglishControlError('无法重试英文回答，请稍后再试。'))}>重试英文</button></div>}
        </div>}
        <div className="answer-actions"><button data-interactive type="button" onClick={()=>void window.interviewAPI.cancelAnswer()}>停止 / 下一题</button>{(answer.status==='error'||answer.status==='interrupted')&&<button data-interactive type="button" onClick={()=>window.interviewAPI.retryAnswer(answer.question)}>重新生成</button>}{answer.text&&<button data-interactive type="button" onClick={()=>void navigator.clipboard.writeText(answer.text)}>{englishEnabled?'复制中文':'复制'}</button>}{englishEnabled&&answer.englishText&&<button data-interactive type="button" onClick={()=>void navigator.clipboard.writeText(answer.englishText)}>复制英文</button>}</div>
      </div> : !transcript?.text&&<div className="notice"><span className="notice-index">01</span><div><strong>准备开始</strong><p>系统音频发送至腾讯云；问题、相关简历及知识资料发送至已配置的模型服务。语义检索可能增加模型用量。</p></div></div>}
      <div className="footer"><span>ALT / OPTION + SHIFT + H 隐藏或恢复</span><span>TAC / 01</span></div>
    </section>}
    <div className="resize-grip" data-interactive role="button" aria-label="拖动以调整窗口大小" title="拖动以调整窗口大小" onPointerDown={beginResize} onPointerMove={updateResize} onPointerUp={endResize} onPointerCancel={endResize} onLostPointerCapture={endResize}><span/></div>
  </main>
}
createRoot(document.getElementById('root')!).render(<App/>)
