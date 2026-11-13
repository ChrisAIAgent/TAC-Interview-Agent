import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

function App(): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const [guard, setGuard] = useState<GuardState | null>(null)
  useEffect(() => {
    void window.interviewAPI.getGuardState().then(setGuard)
    return window.interviewAPI.onGuardState(setGuard)
  }, [])

  useEffect(() => {
    if (guard?.mode === 'full-screen' && guard.presentation === 'revealed') {
      window.interviewAPI.overlayRendered(guard.revealTicket)
    }
  }, [guard?.mode, guard?.presentation, guard?.revealTicket])

  useEffect(() => {
    let ignored = true
    const handleMove = (event: MouseEvent): void => {
      const interactive = Boolean(document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-interactive]'))
      if (ignored === !interactive) return
      ignored = !interactive
      window.interviewAPI.setIgnoreMouse(ignored)
    }
    const handleLeave = (): void => {
      if (!ignored) {
        ignored = true
        window.interviewAPI.setIgnoreMouse(true)
      }
    }
    window.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseleave', handleLeave)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseleave', handleLeave)
    }
  }, [])

  const toggleCollapsed = (): void => {
    const next = !collapsed
    setCollapsed(next)
    window.interviewAPI.setCollapsed(next)
  }

  if (guard?.mode === 'full-screen' && guard.presentation !== 'revealed') return <div className="edge-bar" aria-hidden="true" />
  const tier = guard?.mode === 'tab-or-window' ? 'A' : guard?.mode === 'full-screen' ? 'B' : guard?.mode === 'unknown' ? 'C' : '待确认'
  return (
    <main className={`panel${collapsed ? ' collapsed' : ''}`}>
      <header className="titlebar" data-interactive>
        <div className="identity"><span className="mark">TAC</span><span className="divider" /><span className="product">INTERVIEW AGENT</span></div>
        <div className="controls">
          <button data-interactive onClick={() => window.interviewAPI.openSettings()} aria-label="打开设置" title="打开设置">⚙</button>
          <button data-interactive onClick={toggleCollapsed} aria-label={collapsed ? '展开窗口' : '折叠窗口'} title={collapsed ? '展开窗口' : '折叠窗口'}>{collapsed ? '□' : '⌃'}</button>
          <button data-interactive className="close" onClick={() => window.interviewAPI.quit()} aria-label="退出应用" title="退出应用">×</button>
        </div>
      </header>
      {!collapsed && <section className="content">
        <div className="eyebrow"><span className="status-dot" /> SYSTEM READY <span className="stage">{tier} 档 · {tier === '待确认' ? '请确认共享范围' : '共享范围已声明'}</span></div>
        <div className="headline"><span className="accent-line" /><div><h1>面试辅助工作台</h1><p>INTERVIEW ASSISTANT</p></div></div>
        {guard?.mode === 'full-screen' && <p className="share-warning">按住显示期间，画面可能被对方看到。松开即收起。</p>}
        <div className="notice"><span className="notice-index">01</span><div><strong>悬浮窗口已就绪</strong><p>拖动顶部移动窗口。音频采集和智能回答将在后续阶段接入。</p></div></div>
        <div className="footer"><span>计划：音频 → 腾讯云 <i /> 模型 → 所选服务商</span><span>TAC / 01</span></div>
      </section>}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<App />)


