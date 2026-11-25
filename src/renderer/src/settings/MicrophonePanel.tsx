import React, { useEffect, useRef, useState } from 'react'
import workletUrl from '../audio/worklet.js?url'
import { startMicrophoneAudio, type CaptureHandle } from '../audio/capture'
import { TencentAsr } from '../asr/tencent'

export function MicrophonePanel({ enabled, hotwords, asrModel, onFinal }: { enabled: boolean; hotwords: string[]; asrModel:string; onFinal: (text: string) => void }): React.JSX.Element {
  const [consent, setConsent] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'listening' | 'reconnecting' | 'stopping' | 'failed'>('idle')
  const [message, setMessage] = useState('')
  const [transcript, setTranscript] = useState('')
  const [level, setLevel] = useState(0)
  const capture = useRef<CaptureHandle | null>(null)
  const engine = useRef<TencentAsr | null>(null)
  const generation = useRef(0)
  const onFinalRef = useRef(onFinal)
  onFinalRef.current = onFinal

  const stop = async (): Promise<void> => {
    const current = generation.current
    const active = engine.current; engine.current = null
    const input = capture.current; capture.current = null
    setPhase('stopping')
    await input?.stop().catch(() => undefined)
    if (active) { try { await active.flush() } finally { active.dispose() } }
    if (current === generation.current) { ++generation.current; setLevel(0); setPhase('idle') }
  }
  useEffect(() => { if (!enabled && engine.current) void stop() }, [enabled])
  useEffect(() => () => { ++generation.current; engine.current?.dispose(); engine.current = null; void capture.current?.stop(); capture.current = null }, [])

  const begin = async (): Promise<void> => {
    if (!enabled || !consent || engine.current) return
    const current = ++generation.current
    setMessage(''); setTranscript(''); setPhase('connecting')
    const asr = new TencentAsr({
      sign: () => window.interviewAPI.signTencent(hotwords,asrModel),
      onResult: line => {
        if (current !== generation.current) return
        setTranscript(line.text)
        if (line.isFinal && line.text) onFinalRef.current(line.text)
      },
      onError: error => { if (current === generation.current) setMessage(error.message) },
      onState: value => {
        if (current !== generation.current) return
        if (value === 'failed') {
          void capture.current?.stop(); capture.current = null; engine.current = null
          setPhase('failed')
        } else if (value === 'connecting' || value === 'listening' || value === 'reconnecting') setPhase(value)
      },
    })
    engine.current = asr
    // Request access directly from the user's click.
    const inputPromise = startMicrophoneAudio({ workletUrl, onPacket: packet => {
      if (current !== generation.current) return
      setLevel(Math.min(1, packet.rms * 4)); asr.push(packet.pcm)
    }, onEnded: () => {
      if (current !== generation.current) return
      ++generation.current; capture.current = null; engine.current = null; asr.dispose(); setLevel(0)
      setMessage('麦克风已中断，请检查设备和权限后重新开启。'); setPhase('failed')
    } })
    try {
      const input = await inputPromise
      if (current !== generation.current) { await input.stop(); return }
      capture.current = input
      await asr.init()
    } catch (error) {
      if (current !== generation.current) return
      await capture.current?.stop(); capture.current = null; engine.current = null; asr.dispose()
      setMessage(error instanceof Error && error.message ? error.message : '麦克风转写启动失败，请检查麦克风权限、腾讯云凭证、并发额度和网络。'); setPhase('failed')
    }
  }
  const active = phase === 'connecting' || phase === 'listening' || phase === 'reconnecting' || phase === 'stopping'
  return <div className="microphone-panel">
    <h3>我的麦克风转写（可选）</h3>
    <p className="muted">开启后，你的麦克风音频会单独发送至腾讯云转写；实际转写可能随问题和简历片段发送至所选模型。两路转写分别消耗额度。建议佩戴耳机，减少对方声音漏入麦克风。</p>
    <label className="consent"><input type="checkbox" checked={consent} disabled={active} onChange={event => setConsent(event.target.checked)} /> 我同意开启麦克风并将音频发送至腾讯云转写</label>
    <div className="action-line">{active ? <button type="button" disabled={phase==='stopping'} onClick={() => void stop()}>{phase==='stopping'?'正在关闭…':'关闭麦克风转写'}</button> : <button type="button" disabled={!enabled || !consent} onClick={() => void begin()}>开启麦克风转写</button>}<span>{phase === 'listening' ? `已开启 · 电平 ${Math.round(level * 100)}%` : phase === 'connecting' ? '正在连接' : phase === 'reconnecting' ? '正在重连' : phase === 'stopping' ? '正在结束识别' : '未开启'}</span></div>
    {!enabled && <p className="muted">先启动系统音频实时转写，再按需开启麦克风。</p>}
    {message && <p className="warning" role="alert">{message}</p>}
    {transcript && <p className="muted">我的麦克风：{transcript}</p>}
  </div>
}
