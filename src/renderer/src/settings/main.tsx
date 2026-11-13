import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

type ShareMode = 'tab-or-window' | 'full-screen' | 'unknown'
const options: { mode: ShareMode; name: string; detail: string; tier: string }[] = [
  { mode: 'tab-or-window', name: '面试标签页或单个窗口', detail: '只共享选定的标签页或窗口。请在会议软件中确认实际共享范围。', tier: 'A' },
  { mode: 'full-screen', name: '整个屏幕', detail: '悬浮窗收起到屏幕边缘。展开时内容可能被捕获。', tier: 'B' },
  { mode: 'unknown', name: '不确定 / 专业监考系统', detail: '隐藏悬浮窗，适用于未知采集范围或监考环境。', tier: 'C' }
]
const presets = [
  { name: '阿里云百炼', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { name: '火山方舟', url: 'https://ark.cn-beijing.volces.com/api/v3', model: '' },
  { name: '腾讯混元', url: 'https://api.hunyuan.cloud.tencent.com/v1', model: 'hunyuan-turbos-latest' },
  { name: 'DeepSeek', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: '智谱', url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-plus' },
  { name: '自定义', url: '', model: '' }
]
type Guard = Awaited<ReturnType<typeof window.interviewAPI.getGuardState>>
type CredentialSummary = Awaited<ReturnType<typeof window.interviewAPI.getCredentials>>

function App(): React.JSX.Element {
  const [guard, setGuard] = useState<Guard | null>(null)
  const [summary, setSummary] = useState<CredentialSummary | null>(null)
  const [selected, setSelected] = useState<ShareMode | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [permission, setPermission] = useState('尚未检测')
  const [credentials, setCredentials] = useState({ tencentAppId: '', tencentSecretId: '', tencentSecretKey: '', llmApiKey: '' })
  const [preset, setPreset] = useState(0)
  const [baseUrl, setBaseUrl] = useState(presets[0].url)
  const [model, setModel] = useState(presets[0].model)
  useEffect(() => {
    void window.interviewAPI.getGuardState().then(setGuard).catch(() => setError('无法读取共享状态。'))
    void window.interviewAPI.getCredentials().then(value => { setSummary(value); const index = presets.findIndex(item => item.name === value.llmPreset); if (index >= 0) setPreset(index); if (value.llmBaseUrl) setBaseUrl(value.llmBaseUrl); if (value.llmModel) setModel(value.llmModel) }).catch(() => setError('无法读取凭证状态。'))
    return window.interviewAPI.onGuardState(setGuard)
  }, [])
  const confirm = async (): Promise<void> => {
    if (!selected) return
    try { setError(''); setGuard(await window.interviewAPI.declareShare(selected)); setNotice('共享范围已记录；请在会议软件中再次核对。') }
    catch { setError('无法记录共享范围，请重试。') }
  }
  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    try {
      setError('')
      const result = await window.interviewAPI.saveCredentials({ ...credentials, llmPreset: presets[preset].name, llmBaseUrl: baseUrl, llmModel: model })
      setSummary(result)
      setCredentials({ tencentAppId: '', tencentSecretId: '', tencentSecretKey: '', llmApiKey: '' })
      setNotice('凭证和模型设置已保存。')
    } catch { setError('保存失败，请确认系统凭证加密功能可用。') }
  }
  const changePreset = (value: number): void => { setPreset(value); setBaseUrl(presets[value].url); setModel(presets[value].model) }
  const field = (key: keyof typeof credentials, label: string, masked: string | undefined): React.JSX.Element => <label>{label}<input type="password" autoComplete="off" placeholder={masked || '尚未设置'} value={credentials[key]} onChange={event => setCredentials({ ...credentials, [key]: event.target.value })} /></label>
  const tier = guard?.mode === 'tab-or-window' ? 'A' : guard?.mode === 'full-screen' ? 'B' : guard?.mode === 'unknown' ? 'C' : '待确认'
  return <div className="shell">
    <aside><div className="brand">TAC <span>/ INTERVIEW AGENT</span></div><div className="side-title">CONTROL<br />CENTER<span>.</span></div><div className="side-line" /><p>面试辅助工作台</p><div className="side-bottom">CONFIGURATION<br />01 / SETUP</div></aside>
    <main><div className="topline"><span>WORKSPACE SETTINGS</span><span>STAGE 01</span></div><h1>设置与共享范围</h1><p className="intro">开始前确认当前共享方式，并配置所需服务凭证。</p>
      {error && <div className="alert error" role="alert">{error}</div>}{notice && <div className="alert" role="status">{notice}</div>}
      <section className="card"><div className="section-heading"><div><span className="number">01 / SHARE SCOPE</span><h2>确认共享范围</h2></div><span className={`badge ${guard?.mode === 'unconfirmed' ? 'pending' : ''}`}>当前：{tier} 档</span></div>
        <p className="muted">请根据会议软件中的实际设置选择。本工具无法自动确认你的共享范围。</p>
        <div className="choices">{options.map(option => <button type="button" key={option.mode} className={`choice ${selected === option.mode ? 'selected' : ''}`} onClick={() => setSelected(option.mode)} aria-pressed={selected === option.mode}><span className="tier">{option.tier}</span><span><strong>{option.name}</strong><small>{option.detail}</small></span><span className="radio" /></button>)}</div>
        <div className="guard-info">{guard?.scanAvailable === false ? '进程扫描不可用，不能判断当前是否运行会议或监考软件。' : guard?.detectedProcs.length ? `检测到：${guard.detectedProcs.map(item => item.name).join('、')}。进程检测不能确定共享范围。` : '未检测到已知会议或监考进程；这不代表当前环境没有采集。'}{guard?.reason && <><br />{guard.reason}</>}</div>
        <div className="action-line"><button className="primary" disabled={!selected} onClick={() => void confirm()}>确认共享范围 <span>→</span></button><span>每次面试前请重新确认</span></div>
        {guard?.mode === 'full-screen' && <p className="warning">按住显示期间，画面可能被对方看到。松开即收起。</p>}
      </section>
      <section className="card"><div className="section-heading"><div><span className="number">02 / HOLD TO SHOW</span><h2>按住显示</h2></div><span className="badge">{guard?.listener.status === 'ready' ? '监听运行中' : guard?.listener.status === 'starting' ? '正在启动' : '未启用'}</span></div>
        <p className="muted">开启本功能后，系统会把键盘事件提供给监听程序。程序只识别 Alt/Option、Shift、H 三个键的按下与松开状态，用于判断组合键是否按住；其他按键一律不记录、不保存、不上传，不拦截输入。</p>
        <p className="warning">按住显示期间，画面可能被对方看到。松开即收起。监听故障或权限不足时保持收起。</p>
        <div className="guard-info">快捷键：Alt/Option + Shift + H<br />状态：{guard?.listener.reason ?? (guard?.listener.status === 'ready' ? (guard.listener.armed ? '已就绪' : '请松开所有组合键') : '按键监听未启用')}<br />窗口操作耗时：展开 {guard?.expandApiMs === undefined ? '—' : `${guard.expandApiMs.toFixed(1)} ms`} / 收起 {guard?.collapseApiMs === undefined ? '—' : `${guard.collapseApiMs.toFixed(1)} ms`}（不含画面合成和采集延迟）<br />监听到窗口操作的通信往返上界：展开 {guard?.expandRoundTripMs === undefined ? '—' : `${guard.expandRoundTripMs.toFixed(1)} ms`} / 收起 {guard?.collapseRoundTripMs === undefined ? '—' : `${guard.collapseRoundTripMs.toFixed(1)} ms`}</div>
        {guard?.platform === 'darwin' && <div className="guard-info">输入监控权限：{permission}。授权后请重新启动应用。当前 macOS 同键盘识别尚未通过验证，按住显示会保持关闭。
          <div className="action-line"><button type="button" onClick={() => void window.interviewAPI.listenerPermission('request').then(() => setPermission('已请求；请检查系统设置并重启')).catch(() => setPermission('无法请求，请检查监听程序'))}>请求授权</button><button type="button" onClick={() => void window.interviewAPI.openListenerPermissionSettings()}>去系统设置</button><button type="button" onClick={() => void window.interviewAPI.listenerPermission('check').then(setPermission).catch(() => setPermission('无法检测'))}>重新检测</button><button type="button" onClick={() => void window.interviewAPI.restartApp()}>立即重启</button></div>
        </div>}
        <div className="action-line"><button className="primary" type="button" onClick={() => void window.interviewAPI.startListener()} disabled={guard?.listener.status === 'starting' || guard?.listener.status === 'ready'}>启用按键监听</button><button type="button" onClick={() => void window.interviewAPI.stopListener()} disabled={guard?.listener.status === 'disabled'}>停止监听</button></div>
      </section>
      <section className="card"><div className="section-heading"><div><span className="number">02 / CREDENTIALS</span><h2>服务凭证</h2></div><span className="badge">系统加密存储</span></div><p className="muted">输入新值会替换对应凭证；留空则保留原值。页面只显示遮罩，不显示已保存的明文。</p>
        {summary && !summary.available && <p className="warning">系统安全存储不可用，无法保存凭证。</p>}
        <form onSubmit={event => void save(event)}><div className="form-grid">{field('tencentAppId', '腾讯云 AppId', summary?.tencentAppId)}{field('tencentSecretId', '腾讯云 SecretId', summary?.tencentSecretId)}{field('tencentSecretKey', '腾讯云 SecretKey', summary?.tencentSecretKey)}{field('llmApiKey', 'LLM API Key', summary?.llmApiKey)}</div><button className="primary" type="submit" disabled={summary?.available === false}>保存凭证与模型设置 <span>→</span></button></form>
      </section>
      <section className="card"><div className="section-heading"><div><span className="number">03 / MODEL</span><h2>大模型服务</h2></div></div><p className="muted">选择服务商并保存设置。模型连接将在后续阶段接入。</p><div className="form-grid"><label>服务商<select value={preset} onChange={event => changePreset(Number(event.target.value))}>{presets.map((item, index) => <option value={index} key={item.name}>{item.name}</option>)}</select></label><label>模型<input value={model} onChange={event => setModel(event.target.value)} placeholder="填写模型名或接入点 ID" /></label><label className="wide">Base URL<input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://…/v1" /></label></div><p className="flow">默认规划：音频将实时发送至腾讯云语音识别；问题文本与简历片段将发送至所选大模型服务商。当前阶段尚未采集或发送数据。</p></section>
      <footer>ENGINEERING TOMORROW’S PRECISION <span>TAC / INTERVIEW AGENT</span></footer>
    </main></div>
}

createRoot(document.getElementById('root')!).render(<App />)

