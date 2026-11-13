/** Source identifies the input channel, not the speaker's verified identity. */
export interface SpeechTurn { source: 'system' | 'microphone'; text: string }

/** Keep a bounded, in-memory transcript for the current session only. */
export function appendSpeechTurn(turns: readonly SpeechTurn[], source: SpeechTurn['source'], text: string): SpeechTurn[] {
  const cleaned = text.trim()
  if (!cleaned) return [...turns]
  return [...turns, { source, text: Array.from(cleaned).slice(0, 1000).join('') }].slice(-24)
}

export function formatSpeechContext(turns: readonly SpeechTurn[]): string {
  return turns.slice(-24).map(turn => `${turn.source === 'microphone' ? '我的麦克风' : '系统播放声音'}：${turn.text}`).join('\n').slice(-8000)
}
