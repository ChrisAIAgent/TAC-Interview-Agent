import React, { useEffect, useRef, useState } from 'react'
import workletUrl from '../audio/worklet.js?url'
import { startSystemAudio, SystemAudioCaptureError, type CaptureHandle } from '../audio/capture'
import { TencentAsr, type TencentAsrError } from '../asr/tencent'
import { MicrophonePanel } from './MicrophonePanel'

type Phase='idle'|'testing'|'connecting'|'listening'|'paused'|'reconnecting'|'stopped'|'failed'
interface Row {text:string;isFinal:boolean}
type CredentialKey='tencentAppId'|'tencentSecretId'|'tencentSecretKey'
type CredentialValues=Record<CredentialKey,string>
type CredentialSummary=Partial<Record<CredentialKey,string>>|null
interface AudioPanelProps {
  credentialsReady:boolean
  credentialSummary:CredentialSummary
  credentialValues:CredentialValues
  onCredentialChange:(key:CredentialKey,value:string)=>void
  onSaveCredentials:()=>void
  savingCredentials:boolean
  onFinal:(source:'system'|'microphone',text:string)=>void
  onReset:()=>void
}
export function AudioPanel({credentialsReady,credentialSummary,credentialValues,onCredentialChange,onSaveCredentials,savingCredentials,onFinal,onReset}:AudioPanelProps):React.JSX.Element {
  const [consent,setConsent]=useState(false)
  const [phase,setPhase]=useState<Phase>('idle')
  const [message,setMessage]=useState('')
  const [rows,setRows]=useState<Row[]>([])
  const [level,setLevel]=useState(0)
  const [age,setAge]=useState<number|null>(null)
  const [rate,setRate]=useState(0)
  const [latency,setLatency]=useState<number|null>(null)
  const [attempts,setAttempts]=useState(0)
  const [decodeErrors,setDecodeErrors]=useState(0)
  const [drops,setDrops]=useState(0)
  const capture=useRef<CaptureHandle|null>(null)
  const engine=useRef<TencentAsr|null>(null)
  const run=useRef(0),lastFrame=useRef<number|null>(null),sent=useRef<number[]>([]),marks=useRef<{endMs:number;at:number}[]>([]),audioMs=useRef(0)
  const phaseRef=useRef<Phase>('idle')
  const captureStartedAt=useRef<number|null>(null)
  function changePhase(value:Phase):void {phaseRef.current=value;setPhase(value);window.interviewAPI.publishAudioStatus({phase:value,level:0})}
  useEffect(()=>{
    const timer=setInterval(()=>{
      const now=performance.now();setAge(lastFrame.current===null?null:Math.max(0,Math.round(now-lastFrame.current)))
      sent.current=sent.current.filter(time=>now-time<1000);setRate(sent.current.length*3200)
      if (['testing','connecting','listening','reconnecting'].includes(phaseRef.current) && captureStartedAt.current!==null && now-(lastFrame.current ?? captureStartedAt.current)>3000) {
        ++run.current;void capture.current?.stop();capture.current=null;engine.current?.dispose();engine.current=null;
        setMessage('超过 3 秒没有收到音频帧，请检查系统音频权限、设备和当前版本的系统音频支持后重新开始。');changePhase('failed')
      }
    },1000)
    return()=>{clearInterval(timer);run.current++;engine.current?.dispose();void capture.current?.stop()}
  },[])
  function inputEnded():void {
    run.current++;capture.current=null;engine.current?.dispose();engine.current=null
    setMessage('系统音频已中断，请检查设备后重新开始。');changePhase('failed')
  }
  function openCapture():Promise<CaptureHandle> {
    return startSystemAudio({workletUrl,onPacket:packet=>{
      lastFrame.current=performance.now();const value=Math.min(1,packet.rms*4);setLevel(value)
      window.interviewAPI.publishAudioStatus({phase:phaseRef.current,level:value})
      engine.current?.push(packet.pcm)
    },onEnded:inputEnded})
  }
  async function begin():Promise<void> {
    if (!consent || !credentialsReady || engine.current) return
    const current=++run.current
    setMessage('');setRows([]);onReset();lastFrame.current=null;captureStartedAt.current=null;marks.current=[];audioMs.current=0;sent.current=[];setDrops(0);setDecodeErrors(0);setLatency(null)
    changePhase('connecting')
    const asr=new TencentAsr({sign:()=>window.interviewAPI.signTencent(),
      onResult:line=>{
        setRows(previous=>{
          const next=previous.at(-1)?.isFinal===false ? previous.slice(0,-1) : [...previous]
          if(line.text) next.push({text:line.text,isFinal:line.isFinal})
          return next.slice(-200)
        })
        if(line.text) window.interviewAPI.publishTranscript({text:line.text,isFinal:line.isFinal,sentenceIndex:line.sentenceIndex})
        if(line.isFinal && line.text) onFinal('system',line.text)
        if(line.isFinal){const mark=marks.current.find(item=>item.endMs>=line.endMs);if(mark)setLatency(Math.max(0,Math.round(performance.now()-mark.at)))}
      },
      onError:(error:TencentAsrError)=>setMessage(error.message),
      onState:(value,number)=>{ if(current!==run.current) return; setAttempts(number);if(value==='failed'){void capture.current?.stop();capture.current=null;engine.current=null}changePhase(value) },
      onSession:()=>{marks.current=[];audioMs.current=0},
      onSent:()=>{const now=performance.now();sent.current.push(now);audioMs.current+=100;marks.current.push({endMs:audioMs.current,at:now});if(marks.current.length>1800)marks.current.shift()},
      onOverflow:()=>setDecodeErrors(n=>n+1),onDrops:setDrops,
    })
    engine.current=asr
    // Called synchronously in the click handler before any await, preserving the user gesture.
    const capturePromise=openCapture()
    try {
      const handle=await capturePromise
      if(current!==run.current){await handle.stop();return}
      capture.current=handle;captureStartedAt.current=performance.now()
      await asr.init()
    } catch (error) {
      if(current!==run.current) return
      await capture.current?.stop();capture.current=null;asr.dispose();engine.current=null
      setMessage(error instanceof SystemAudioCaptureError ? error.message : '启动失败：请检查系统音频权限、设备、腾讯云凭证与网络。');changePhase('failed')
    }
  }
  async function stop():Promise<void> {
    ++run.current;const current=engine.current;engine.current=null
    await capture.current?.stop();capture.current=null;captureStartedAt.current=null;setLevel(0)
    if(current){try{await current.flush()}finally{current.dispose()}}
    changePhase('stopped')
  }
  async function pause():Promise<void> {
    engine.current?.pause();await capture.current?.stop();capture.current=null;captureStartedAt.current=null;setLevel(0);changePhase('paused')
  }
  async function resume():Promise<void> {
    const current=run.current
    const capturePromise=openCapture()
    try {const handle=await capturePromise;if(current!==run.current){await handle.stop();return}capture.current=handle;captureStartedAt.current=performance.now();lastFrame.current=null;engine.current?.resume()}
    catch(error){engine.current?.dispose();engine.current=null;setMessage(error instanceof SystemAudioCaptureError ? error.message : '无法恢复系统音频，请重新开始。');changePhase('failed')}
  }
  async function testAudio():Promise<void> {
    if (engine.current || capture.current) return
    const current=++run.current;setMessage('');lastFrame.current=null;captureStartedAt.current=null;changePhase('testing')
    const promise=openCapture()
    try {const handle=await promise;if(current!==run.current){await handle.stop();return}capture.current=handle;captureStartedAt.current=performance.now()}
    catch (error) {if(current===run.current){setMessage(error instanceof SystemAudioCaptureError ? error.message : '系统音频检测失败，请检查权限和设备。');changePhase('failed')}}
  }
  const busy=['testing','connecting','listening','reconnecting','paused'].includes(phase)
  return <section className="card" id="step-audio"><div className="section-heading"><div><span className="number">OPTIONAL / LIVE TRANSCRIPTION</span><h2>实时语音转写</h2></div><span className="badge">{credentialsReady?'凭证已配置':'可稍后设置'}</span></div>
    <p className="muted">这是可选功能。开启后，系统播放的声音会实时发送至腾讯云识别；音频只在内存处理，不写入文件。你可以先用上方“手动试答”，之后再配置语音。</p>
    <details className="credential-disclosure"><summary>{credentialsReady?'更换腾讯云语音识别凭证':'设置腾讯云语音识别凭证'}</summary>
      <p className="muted">填入腾讯云 ASR 的 AppId、SecretId 和 SecretKey。输入留空会保留已保存的值；凭证使用系统安全存储。</p>
      <div className="form-grid">
        <label>腾讯云 AppId<input type="password" autoComplete="off" placeholder={credentialSummary?.tencentAppId||'输入后保存'} value={credentialValues.tencentAppId} onChange={event=>onCredentialChange('tencentAppId',event.target.value)}/></label>
        <label>腾讯云 SecretId<input type="password" autoComplete="off" placeholder={credentialSummary?.tencentSecretId||'输入后保存'} value={credentialValues.tencentSecretId} onChange={event=>onCredentialChange('tencentSecretId',event.target.value)}/></label>
        <label className="wide">腾讯云 SecretKey<input type="password" autoComplete="off" placeholder={credentialSummary?.tencentSecretKey||'输入后保存'} value={credentialValues.tencentSecretKey} onChange={event=>onCredentialChange('tencentSecretKey',event.target.value)}/></label>
      </div>
      <button type="button" disabled={savingCredentials} onClick={onSaveCredentials}>{savingCredentials?'正在保存…':'保存语音识别凭证'}</button>
    </details>
    <label className="consent"><input type="checkbox" checked={consent} disabled={busy} onChange={event=>setConsent(event.target.checked)}/> 我了解本次音频会发送至腾讯云</label>
    {!credentialsReady&&<p className="warning">请先在上方保存腾讯云 AppId、SecretId 和 SecretKey。</p>}
    {message&&<p className="warning" role="alert">{message}</p>}
    <div className="action-line">
      {!busy&&<button type="button" onClick={()=>void testAudio()}>本机检测声音</button>}
      {!busy&&<button className="primary" disabled={!consent||!credentialsReady} onClick={()=>void begin()}>开始实时转写 →</button>}
      {phase==='listening'&&<button type="button" onClick={()=>void pause()}>暂停</button>}
      {phase==='paused'&&<button type="button" onClick={()=>void resume()}>恢复</button>}
      {busy&&<button type="button" onClick={()=>void stop()}>结束</button>}
      <span>音频电平 {Math.round(level*100)}%{phase==='testing'?' · 仅本机检测':''}</span>
    </div>
    <div className="audio-meter" aria-label={`音频电平 ${Math.round(level*100)}%`}><span style={{width:`${Math.round(level*100)}%`}}/></div>
    {(phase==='testing'||phase==='listening')&&<p className="muted">请在电脑上播放声音并观察音频电平。持续为零可能是静音、设备或权限问题，不能仅凭音轨存在确认采集成功。</p>}
    <div className="guard-info">最近音频：{age===null?'—':`${age} ms`} · 上行：{rate} B/s · 识别延迟（从音频发送起）：{latency===null?'—':`${latency} ms`} · 重连：{attempts} · 缓冲丢弃：{decodeErrors} · 乱序丢弃：{drops}</div>
    <div className="transcript" aria-live="polite">{rows.length?rows.map((row,index)=><p key={index} className={row.isFinal?'':'partial'}>{row.text}</p>):<p className="muted">开始后，识别文字会显示在这里。</p>}</div>
    <MicrophonePanel enabled={phase==='listening'} onFinal={text=>onFinal('microphone',text)}/>
  </section>
}
