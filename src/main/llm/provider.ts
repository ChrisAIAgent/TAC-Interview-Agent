export interface ChatRequest {
  system: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  temperature?: number
  maxTokens?: number
  disableThinking?: boolean
}

export interface ChatChunk {
  delta: string
  done: boolean
}

export interface LlmProvider {
  id: LlmProviderId
  label: string
  kind: 'cloud' | 'local'
  chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk>
  test(): Promise<TestResult>
}

export type FetchLike = typeof fetch

export class LlmError extends Error {
  readonly code: 'LLM_AUTH' | 'LLM_RATE_LIMIT' | 'LLM_HTTP' | 'LLM_PROTOCOL' | 'LLM_TIMEOUT'
  constructor(code: 'LLM_AUTH' | 'LLM_RATE_LIMIT' | 'LLM_HTTP' | 'LLM_PROTOCOL' | 'LLM_TIMEOUT', message: string) {
    super(message)
    this.code = code
    this.name = 'LlmError'
  }
}

export function checkResponse(response: Response): void {
  if (response.ok && response.body) return
  if (response.status === 401 || response.status === 403) throw new LlmError('LLM_AUTH', 'API Key 无效或已过期。')
  if (response.status === 429) throw new LlmError('LLM_RATE_LIMIT', '请求过于频繁，请稍后重试。')
  throw new LlmError('LLM_HTTP', `模型请求失败（HTTP ${response.status}）。`)
}

/** Decode arbitrary UTF-8 stream chunks into lines, including a final unterminated line. */
export async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let exhausted = false
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) { exhausted = true; break }
      pending += decoder.decode(value, { stream: true })
      let boundary = pending.indexOf('\n')
      while (boundary !== -1) {
        const line = pending.slice(0, boundary)
        yield line.endsWith('\r') ? line.slice(0, -1) : line
        pending = pending.slice(boundary + 1)
        boundary = pending.indexOf('\n')
      }
    }
    pending += decoder.decode()
    if (pending) yield pending.endsWith('\r') ? pending.slice(0, -1) : pending
  } finally {
    if (!exhausted) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export function parseJson(text: string): unknown {
  try { return JSON.parse(text) as unknown }
  catch { throw new LlmError('LLM_PROTOCOL', '模型返回了无效的流式数据。') }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type LlmProviderId = 'openai-compat' | 'ollama'
export interface TestResult { ok: boolean; latencyMs: number; model?: string; error?: string }

export class RequestLifetime {
  readonly controller = new AbortController()
  readonly signal: AbortSignal
  private overall: ReturnType<typeof setTimeout>
  private first?: ReturnType<typeof setTimeout>
  timedOut = false
  constructor(external: AbortSignal) {
    this.signal = AbortSignal.any([external, this.controller.signal])
    this.overall = setTimeout(() => this.timeout(), 60_000)
  }
  private timeout(): void { this.timedOut = true; this.controller.abort() }
  async fetch(request: FetchLike, url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const connect = setTimeout(() => this.timeout(), 10_000)
      let response: Response
      try { response = await request(url, { ...init, signal: this.signal }) }
      finally { clearTimeout(connect) }
      if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
        await response.body?.cancel()
        await new Promise<void>((resolve, reject) => {
          if (this.signal.aborted) { reject(this.signal.reason); return }
          const timer = setTimeout(() => { this.signal.removeEventListener('abort', abort); resolve() }, 800)
          const abort = (): void => { clearTimeout(timer); reject(this.signal.reason) }
          this.signal.addEventListener('abort', abort, { once: true })
        })
        continue
      }
      checkResponse(response)
      this.first = setTimeout(() => this.timeout(), 20_000)
      return response
    }
  }
  gotToken(): void { if (this.first) { clearTimeout(this.first); this.first = undefined } }
  translate(error: unknown): never {
    if (this.timedOut) throw new LlmError('LLM_TIMEOUT', '模型响应超时，已保留当前内容。')
    throw error
  }
  close(): void { clearTimeout(this.overall); if (this.first) clearTimeout(this.first) }
}

export async function testProvider(provider: LlmProvider, model: string, local: boolean): Promise<TestResult> {
  const start = Date.now()
  try {
    const controller = new AbortController()
    let text = ''
    for await (const chunk of provider.chat({ system: '请简短回复。', messages: [{ role: 'user', content: '回复 OK' }], maxTokens: 16 }, controller.signal)) {
      text += chunk.delta
    }
    if (!text.trim()) return { ok: false, latencyMs: Date.now() - start, error: '模型未返回文本。' }
    return { ok: true, latencyMs: Date.now() - start, model }
  } catch (error) {
    const message = local && error instanceof TypeError ? '未检测到本地 Ollama 服务，请先安装并 ollama pull qwen2.5:7b-instruct' : error instanceof LlmError ? error.message : '模型连接失败，请检查配置。'
    return { ok: false, latencyMs: Date.now() - start, error: message }
  }
}

