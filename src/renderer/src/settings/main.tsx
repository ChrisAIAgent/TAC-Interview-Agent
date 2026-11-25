import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'
import { AudioPanel } from './AudioPanel'
import { ResumePanel, emptyResume } from './ResumePanel'
import { AnswerPanel } from './AnswerPanel'
import { appendSpeechTurn, type SpeechTurn } from '../session/conversation'
import { loadQuestionBank, type QuestionBankEntry } from '../session/question-bank'
import { QuestionBankPanel } from './QuestionBankPanel'
import { loadKnowledge, type KnowledgeEntry } from '../session/knowledge'
import { KnowledgePanel } from './KnowledgePanel'

const presets = [
  { name: '阿里云百炼', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.8-flash' },
  { name: '火山方舟', url: 'https://ark.cn-beijing.volces.com/api/v3', model: '' },
  { name: '腾讯混元', url: 'https://api.hunyuan.cloud.tencent.com/v1', model: 'hunyuan-turbos-latest' },
  { name: 'DeepSeek', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: '智谱', url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-plus' },
  { name: '自定义', url: '', model: '' },
  { name: '本地 Ollama', url: 'http://127.0.0.1:11434/api/chat', model: 'qwen2.5:7b-instruct' },
]
type Summary = Awaited<ReturnType<typeof window.interviewAPI.getCredentials>>
type CredentialKey = 'tencentAppId' | 'tencentSecretId' | 'tencentSecretKey' | 'llmApiKey'
type CredentialValues = Record<CredentialKey, string>

function App(): React.JSX.Element {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [resume, setResume] = useState(emptyResume)
  const [candidate, setCandidate] = useState<{ id: number; text: string } | null>(null)
  const [speech, setSpeech] = useState<SpeechTurn[]>([])
  const [sessionId, setSessionId] = useState(0)
  const [bank, setBank] = useState<QuestionBankEntry[]>(loadQuestionBank)
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>(loadKnowledge)
  const [windowState, setWindowState] = useState<WindowState | null>(null)
  const [shortcut, setShortcut] = useState('Alt+Shift+H')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [credentials, setCredentials] = useState<CredentialValues>({ tencentAppId: '', tencentSecretId: '', tencentSecretKey: '', llmApiKey: '' })
  const [preset, setPreset] = useState(0)
  const [baseUrl, setBaseUrl] = useState(presets[0].url)
  const [model, setModel] = useState(presets[0].model)
  const [savingModel, setSavingModel] = useState(false)
  const [savingAsr, setSavingAsr] = useState(false)
  const [testingModel, setTestingModel] = useState(false)
  const [modelTestMessage, setModelTestMessage] = useState('')

  useEffect(() => {
    void window.interviewAPI.getWindowState().then(value => { setWindowState(value); setShortcut(value.shortcut) }).catch(() => setError('无法读取窗口设置。'))
    void window.interviewAPI.getResume().then(value => { if (value) setResume(value) }).catch(() => setError('无法读取本地简历。'))
    void window.interviewAPI.getCredentials().then(value => {
      setSummary(value)
      const index = presets.findIndex(item => item.name === value.llmPreset)
      if (index >= 0) setPreset(index)
      if (value.llmBaseUrl) setBaseUrl(value.llmBaseUrl)
      if (value.llmModel) setModel(value.llmModel)
    }).catch(() => setError('无法读取凭证状态。'))
    return window.interviewAPI.onWindowState(setWindowState)
  }, [])

  const updateCredential = (key: CredentialKey, value: string): void => setCredentials(previous => ({ ...previous, [key]: value }))
  const saveModel = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setSavingModel(true)
    setError('')
    setNotice('')
    setModelTestMessage('')
    try {
      const value = await window.interviewAPI.saveCredentials({
        llmApiKey: credentials.llmApiKey,
        llmPreset: presets[preset].name,
        llmBaseUrl: baseUrl,
        llmModel: model,
        llmProvider: presets[preset].name === '本地 Ollama' ? 'ollama' : 'openai-compat',
      })
      setSummary(value)
      updateCredential('llmApiKey', '')
      setNotice('模型设置已保存。本次测试只会发送固定测试短句，不会发送简历或面试内容。')
    } catch {
      setError('保存失败，请确认系统凭证加密功能可用。')
    } finally {
      setSavingModel(false)
    }
  }
  const saveAsr = async (): Promise<void> => {
    setSavingAsr(true)
    setError('')
    setNotice('')
    try {
      setSummary(await window.interviewAPI.saveCredentials({
        tencentAppId: credentials.tencentAppId,
        tencentSecretId: credentials.tencentSecretId,
        tencentSecretKey: credentials.tencentSecretKey,
      }))
      setCredentials(previous => ({ ...previous, tencentAppId: '', tencentSecretId: '', tencentSecretKey: '' }))
      setNotice('腾讯云语音识别凭证已保存。')
    } catch {
      setError('保存失败，请确认系统凭证加密功能可用。')
    } finally {
      setSavingAsr(false)
    }
  }
  const testModel = async (): Promise<void> => {
    setTestingModel(true)
    setModelTestMessage('正在连接已保存的模型配置…')
    try {
      const remote = presets[preset].name !== '本地 Ollama'
      const result = await window.interviewAPI.testModel(true)
      setModelTestMessage(result.ok ? `连接成功 · ${result.model ?? model} · ${result.latencyMs} ms` : result.error ?? '连接失败，请检查配置。')
      if (result.ok && remote) setNotice('模型已连通。下一步可以直接输入一道面试题试答。')
    } catch {
      setModelTestMessage('连接失败。请先保存配置，并检查 API Key、模型名称和网络。')
    } finally {
      setTestingModel(false)
    }
  }
  const saveShortcut = async (): Promise<void> => {
    try {
      setError('')
      const value = await window.interviewAPI.setShortcut(shortcut)
      setWindowState(value)
      if (value.shortcutError) setError(value.shortcutError)
      else setNotice('快捷键已更新。')
    } catch {
      setError('快捷键设置失败，请检查格式。')
    }
  }
  const field = (key: CredentialKey, label: string, masked: string | undefined): React.JSX.Element => (
    <label>{label}<input type="password" autoComplete="off" placeholder={masked || '输入后保存'} value={credentials[key]} onChange={event => updateCredential(key, event.target.value)} /></label>
  )
  let host = '所选模型服务商'
  try { host = new URL(baseUrl).host || host } catch { /* User may still be editing. */ }
  let savedHost = '已保存的模型服务商'
  try { if (summary?.llmBaseUrl) savedHost = new URL(summary.llmBaseUrl).host || savedHost } catch { /* Invalid saved URL is surfaced by the connection test. */ }

  const localModel = presets[preset].name === '本地 Ollama'
  const modelConfigured = Boolean(summary?.llmModel && summary?.llmBaseUrl && (summary?.llmProvider === 'ollama' || summary?.llmApiKey))
  const asrReady = Boolean(summary?.tencentAppId && summary?.tencentSecretId && summary?.tencentSecretKey)
  const resumeReady = Boolean(resume.personal.fullName || resume.personal.title || resume.personal.skills.length || resume.experiences.length || resume.projects.length || resume.education.length)

  return <div className="shell">
    <aside>
      <div className="brand">TAC <span>/ INTERVIEW AGENT</span></div>
      <div className="side-title">CONTROL<br />CENTER<span>.</span></div>
      <div className="side-line" />
      <p>面试辅助工作台</p>
      <nav className="settings-nav" aria-label="设置导航">
        <a href="#start">开始使用</a>
        <a href="#step-model">01 模型连接</a>
        <a href="#step-resume">02 简历资料</a>
        <a href="#step-bank">问题库</a>
        <a href="#step-knowledge">知识资料库</a>
        <a href="#step-answer">03 手动试答</a>
        <a href="#step-audio">可选 · 实时转写</a>
        <a href="#step-window">窗口快捷键</a>
      </nav>
      <div className="side-bottom">TAC / INTERVIEW AGENT<br />设置可随时返回修改</div>
    </aside>

    <main>
      <div className="topline"><span>INTERVIEW WORKSPACE</span><span>TAC / SETUP</span></div>
      <h1>先跑通一条回答</h1>
      <p className="intro">先连模型，再输入一道问题。简历和实时语音都可以稍后配置。</p>
      {error && <div className="alert error" role="alert">{error}</div>}
      {notice && <div className="alert" role="status">{notice}</div>}

      <section className="card start-card" id="start">
        <div className="start-heading"><div><span className="number">START HERE / 约 2 分钟</span><h2>完成下面三步，就能试用</h2></div><span className="badge">语音不是必需项</span></div>
        <p className="muted">最快路径：保存模型配置 → 输入一个面试问题 → 查看流式回答。没有简历也能先试答。</p>
        <div className="setup-steps">
          <a href="#step-model" className="setup-step"><span className="step-index">1</span><span><strong>连接模型</strong><small>{modelConfigured ? '已保存，可测试连接' : '必需 · 配置 API Key 和模型'}</small></span><span className={modelConfigured ? 'step-state done' : 'step-state'}>{modelConfigured ? '完成' : '去设置'}</span></a>
          <a href="#step-resume" className="setup-step"><span className="step-index">2</span><span><strong>添加简历</strong><small>{resumeReady ? '本机已有简历资料' : '可选 · 让回答结合真实经历'}</small></span><span className="step-state optional">{resumeReady ? '已添加' : '可跳过'}</span></a>
          <a href="#step-answer" className="setup-step"><span className="step-index">3</span><span><strong>输入问题试答</strong><small>{modelConfigured ? '现在可以手动试答' : '完成模型连接后即可试答'}</small></span><span className={modelConfigured ? 'step-state ready' : 'step-state'}>{modelConfigured ? '开始' : '稍后'}</span></a>
        </div>
        <div className="start-footnote"><span className="status-dot" /> 实时转写需要另行配置腾讯云；你可以先用手动问题验证模型。</div>
      </section>

      <section className="card" id="step-model">
        <div className="section-heading"><div><span className="number">01 / REQUIRED</span><h2>连接回答模型</h2></div><span className={modelConfigured ? 'badge complete' : 'badge pending'}>{modelConfigured ? '配置已保存' : '完成后继续'}</span></div>
        <p className="muted">选择服务商并保存模型信息。下面的“测试连接”只发送固定测试短句，不包含你的简历或面试问题。</p>
        {!summary?.available && summary && <p className="warning">系统安全存储不可用，无法保存 API Key。</p>}
        <form onSubmit={event => void saveModel(event)}>
          <div className="form-grid">
            <label>模型服务商<select value={preset} onChange={event => { const index = Number(event.target.value); setPreset(index); setBaseUrl(presets[index].url); setModel(presets[index].model); setModelTestMessage('') }}>{presets.map((item, index) => <option key={item.name} value={index}>{item.name}</option>)}</select></label>
            <label>模型名称<input value={model} onChange={event => { setModel(event.target.value); setModelTestMessage('') }} placeholder="例如 qwen3.8-flash" /></label>
            {!localModel && field('llmApiKey', 'API Key', summary?.llmApiKey)}
            <label className="wide">Base URL<input value={baseUrl} onChange={event => { setBaseUrl(event.target.value); setModelTestMessage('') }} placeholder="https://…/v1" /></label>
          </div>
          {presets[preset].name === '阿里云百炼' && <p className="provider-tip">百炼请使用北京地域的普通 API Key。若用免费额度试跑，先在控制台为该模型开启“免费额度用完即停”。</p>}
          <p className="data-note">生成回答时，问题、相关简历片段、匹配的知识资料和本次会话转写会发送至 <strong>{host}</strong>。连接测试只发送固定测试短句。</p>
          <div className="action-line model-actions"><button className="primary" type="submit" disabled={savingModel || summary?.available === false}>{savingModel ? '正在保存…' : '保存模型设置'}</button><button type="button" disabled={testingModel || !modelConfigured} onClick={() => void testModel()}>{testingModel ? '正在测试…' : '测试已保存配置'}</button><span>{modelConfigured ? `当前已保存：${savedHost}` : '保存后再测试连接'}</span></div>
          {modelTestMessage && <p className={modelTestMessage.includes('成功') ? 'test-result success' : 'test-result'} role="status">{modelTestMessage}</p>}
        </form>
      </section>

      <ResumePanel resume={resume} setResume={setResume} />
      <QuestionBankPanel entries={bank} setEntries={setBank} />
      <KnowledgePanel entries={knowledge} setEntries={setKnowledge} />
      <AnswerPanel resume={resume} candidate={candidate} speech={speech} sessionId={sessionId} provider={summary?.llmProvider || 'openai-compat'} host={savedHost} configured={modelConfigured} bank={bank} knowledge={knowledge} />
      <AudioPanel credentialsReady={asrReady} modelConfigured={modelConfigured} credentialSummary={summary} credentialValues={credentials} onCredentialChange={updateCredential} onSaveCredentials={() => void saveAsr()} savingCredentials={savingAsr} onReset={() => { void window.interviewAPI.cancelAnswer(); setSpeech([]); setCandidate(null); setSessionId(previous => previous + 1) }} onFinal={(source, text) => { setSpeech(previous => appendSpeechTurn(previous, source, text)); if (source === 'system') setCandidate(previous => ({ id: (previous?.id ?? 0) + 1, text })) }} />
      {speech.length > 0 && <section className="card"><div className="section-heading"><h2>本次会话转写</h2><button type="button" onClick={() => setSpeech([])}>清空转写</button></div><p className="muted">按识别返回顺序显示；标签代表音源，回声和其他系统声音可能造成混入。内容仅在本次会话内存中，生成回答时会发送给所选模型。</p><div className="transcript">{speech.map((turn, index) => <p key={index}><strong>{turn.source === 'microphone' ? '我的麦克风' : '系统声音'}：</strong>{turn.text}</p>)}</div></section>}

      <section className="card secondary-card" id="step-window">
        <div className="section-heading"><div><span className="number">WINDOW / OPTIONAL</span><h2>悬浮窗快捷键</h2></div><span className="badge">始终置顶</span></div>
        <p className="muted">面试中可用快捷键隐藏或恢复悬浮窗；默认组合键为 Alt + Shift + H。如需让鼠标穿过悬浮窗，可在系统托盘右键菜单中开启或关闭“鼠标穿透悬浮窗”。</p>
        <div className="form-grid"><label>隐藏 / 恢复快捷键<input value={shortcut} onChange={event => setShortcut(event.target.value)} placeholder="Alt+Shift+H" /></label></div>
        {windowState?.shortcutError && <p className="warning">{windowState.shortcutError}</p>}
        <div className="action-line"><button type="button" onClick={() => void saveShortcut()}>保存快捷键</button><span>若要共享整个屏幕，请先隐藏悬浮窗；部分会议软件仍可能采集到置顶窗口。</span></div>
      </section>
      <footer>ENGINEERING TOMORROW’S PRECISION <span>TAC / INTERVIEW AGENT</span></footer>
    </main>
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
