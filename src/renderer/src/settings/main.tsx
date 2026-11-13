import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'
import { AudioPanel } from './AudioPanel'
import { ResumePanel, emptyResume } from './ResumePanel'
import { AnswerPanel } from './AnswerPanel'
const presets=[
  {name:'阿里云百炼',url:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen-plus'},
  {name:'火山方舟',url:'https://ark.cn-beijing.volces.com/api/v3',model:''},
  {name:'腾讯混元',url:'https://api.hunyuan.cloud.tencent.com/v1',model:'hunyuan-turbos-latest'},
  {name:'DeepSeek',url:'https://api.deepseek.com/v1',model:'deepseek-chat'},
  {name:'智谱',url:'https://open.bigmodel.cn/api/paas/v4',model:'glm-4-plus'},
  {name:'自定义',url:'',model:''},
  {name:'本地 Ollama',url:'http://127.0.0.1:11434/api/chat',model:'qwen2.5:7b-instruct'},
]
type Summary=Awaited<ReturnType<typeof window.interviewAPI.getCredentials>>
function App():React.JSX.Element {
  const [summary,setSummary]=useState<Summary|null>(null)
  const [resume,setResume]=useState(emptyResume)
  const [candidate,setCandidate]=useState<{id:number;text:string}|null>(null)
  const [windowState,setWindowState]=useState<WindowState|null>(null)
  const [shortcut,setShortcut]=useState('Alt+Shift+H')
  const [error,setError]=useState(''),[notice,setNotice]=useState('')
  const [credentials,setCredentials]=useState({tencentAppId:'',tencentSecretId:'',tencentSecretKey:'',llmApiKey:''})
  const [preset,setPreset]=useState(0),[baseUrl,setBaseUrl]=useState(presets[0].url),[model,setModel]=useState(presets[0].model)
  useEffect(()=>{
    void window.interviewAPI.getWindowState().then(value=>{setWindowState(value);setShortcut(value.shortcut)}).catch(()=>setError('无法读取窗口设置。'))
    void window.interviewAPI.getResume().then(value=>{if(value)setResume(value)}).catch(()=>setError('无法读取本地简历。'))
    void window.interviewAPI.getCredentials().then(value=>{setSummary(value);const index=presets.findIndex(item=>item.name===value.llmPreset);if(index>=0)setPreset(index);if(value.llmBaseUrl)setBaseUrl(value.llmBaseUrl);if(value.llmModel)setModel(value.llmModel)}).catch(()=>setError('无法读取凭证状态。'))
    return window.interviewAPI.onWindowState(setWindowState)
  },[])
  const save=async(event:React.FormEvent):Promise<void>=>{
    event.preventDefault()
    try {setError('');setSummary(await window.interviewAPI.saveCredentials({...credentials,llmPreset:presets[preset].name,llmBaseUrl:baseUrl,llmModel:model,llmProvider:presets[preset].name==='本地 Ollama'?'ollama':'openai-compat'}));setCredentials({tencentAppId:'',tencentSecretId:'',tencentSecretKey:'',llmApiKey:''});setNotice('凭证与模型设置已保存。')}
    catch {setError('保存失败，请确认系统凭证加密功能可用。')}
  }
  const saveShortcut=async():Promise<void>=>{
    try {setError('');const value=await window.interviewAPI.setShortcut(shortcut);setWindowState(value);if(value.shortcutError)setError(value.shortcutError);else setNotice('快捷键已更新。')}
    catch {setError('快捷键设置失败，请检查格式。')}
  }
  const field=(key:keyof typeof credentials,label:string,masked:string|undefined):React.JSX.Element=><label>{label}<input type="password" autoComplete="off" placeholder={masked||'尚未设置'} value={credentials[key]} onChange={event=>setCredentials({...credentials,[key]:event.target.value})}/></label>
  let host='所选模型服务商';try{host=new URL(baseUrl).host||host}catch{/* User may still be editing. */}
  let savedHost='已保存的模型服务商';try{if(summary?.llmBaseUrl)savedHost=new URL(summary.llmBaseUrl).host||savedHost}catch{/* Invalid saved URL is surfaced by connection. */}
  return <div className="shell"><aside><div className="brand">TAC <span>/ INTERVIEW AGENT</span></div><div className="side-title">CONTROL<br/>CENTER<span>.</span></div><div className="side-line"/><p>面试辅助工作台</p><div className="side-bottom">CONFIGURATION<br/>01 / SETUP</div></aside>
    <main><div className="topline"><span>WORKSPACE SETTINGS</span><span>TAC / 01</span></div><h1>准备面试</h1><p className="intro">配置语音识别、模型服务和悬浮窗快捷键。</p>
      {error&&<div className="alert error" role="alert">{error}</div>}{notice&&<div className="alert" role="status">{notice}</div>}
      <section className="card"><div className="section-heading"><div><span className="number">01 / WINDOW</span><h2>悬浮窗</h2></div><span className="badge">始终置顶</span></div>
        <p className="muted">不共享屏幕时，悬浮窗只显示在你的电脑上。若需要共享整个屏幕，请先隐藏悬浮窗；屏幕采集保护无法对所有会议软件保证有效。</p>
        <div className="form-grid"><label>隐藏 / 恢复快捷键<input value={shortcut} onChange={event=>setShortcut(event.target.value)} placeholder="Alt+Shift+H"/></label></div>
        {windowState?.shortcutError&&<p className="warning">{windowState.shortcutError}</p>}
        <div className="action-line"><button type="button" className="primary" onClick={()=>void saveShortcut()}>保存快捷键 →</button><span>默认 Alt/Option + Shift + H</span></div>
      </section>
      <section className="card"><div className="section-heading"><div><span className="number">02 / CREDENTIALS</span><h2>服务凭证</h2></div><span className="badge">系统加密存储</span></div>
        <p className="muted">输入新值替换对应凭证，留空保留原值。页面只显示遮罩，不显示已保存的明文。</p>
        {summary&&!summary.available&&<p className="warning">系统安全存储不可用，无法保存凭证。</p>}
        <form onSubmit={event=>void save(event)}><div className="form-grid">{field('tencentAppId','腾讯云 AppId',summary?.tencentAppId)}{field('tencentSecretId','腾讯云 SecretId',summary?.tencentSecretId)}{field('tencentSecretKey','腾讯云 SecretKey',summary?.tencentSecretKey)}{field('llmApiKey','LLM API Key',summary?.llmApiKey)}</div>
          <div className="form-grid"><label>模型服务商<select value={preset} onChange={event=>{const i=Number(event.target.value);setPreset(i);setBaseUrl(presets[i].url);setModel(presets[i].model)}}>{presets.map((p,i)=><option key={p.name} value={i}>{p.name}</option>)}</select></label><label>模型<input value={model} onChange={event=>setModel(event.target.value)} placeholder="填写模型名或接入点 ID"/></label><label className="wide">Base URL<input value={baseUrl} onChange={event=>setBaseUrl(event.target.value)} placeholder="https://…/v1"/></label></div>
          <p className="flow">开始转写后音频将发送至腾讯云；{presets[preset].name==='本地 Ollama'?'回答在本机生成。':`生成回答时问题文字和相关简历片段会发送至 ${host}。`}回答使用已保存的模型设置。</p>
          <button className="primary" type="submit" disabled={summary?.available===false}>保存凭证与模型设置 →</button>
        </form>
      </section>
      <ResumePanel resume={resume} setResume={setResume}/>
      <AnswerPanel resume={resume} candidate={candidate} provider={summary?.llmProvider||'openai-compat'} host={savedHost}/>
      <AudioPanel credentialsReady={Boolean(summary?.tencentAppId && summary?.tencentSecretId && summary?.tencentSecretKey)} onFinal={text=>setCandidate(previous=>({id:(previous?.id??0)+1,text}))}/>
      <footer>ENGINEERING TOMORROW’S PRECISION <span>TAC / INTERVIEW AGENT</span></footer>
    </main></div>
}
createRoot(document.getElementById('root')!).render(<App/>)
