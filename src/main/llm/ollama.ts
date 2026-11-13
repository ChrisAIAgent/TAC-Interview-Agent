import { isRecord, LlmError, parseJson, readLines, RequestLifetime, testProvider } from './provider'
import type { ChatChunk, ChatRequest, FetchLike, LlmProvider, TestResult } from './provider'

export class OllamaProvider implements LlmProvider {
  readonly id = 'ollama' as const
  readonly label = 'Ollama'
  readonly kind = 'local' as const
  constructor(private readonly model: string, private readonly endpoint = 'http://127.0.0.1:11434/api/chat', private readonly request: FetchLike = fetch) {}
  test(): Promise<TestResult> { return testProvider(this, this.model, true) }
  async *chat(req: ChatRequest, signal: AbortSignal): AsyncGenerator<ChatChunk> {
    const life = new RequestLifetime(signal)
    try {
      const response = await life.fetch(this.request, this.endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, stream: true, messages: [{ role: 'system', content: req.system }, ...req.messages], options: { temperature: req.temperature ?? 0.4, num_predict: req.maxTokens ?? 400, top_p: 0.9 } })
      })
      for await (const line of readLines(response.body!)) {
        if (!line.trim()) continue
        const event = parseJson(line)
        if (!isRecord(event)) throw new LlmError('LLM_PROTOCOL', '模型返回了无效的流式数据。')
        if (typeof event.error === 'string') throw new LlmError('LLM_PROTOCOL', '模型返回错误，请检查模型配置。')
        const content = isRecord(event.message) && typeof event.message.content === 'string' ? event.message.content : ''
        if (content) { life.gotToken(); yield { delta: content, done: false } }
        if (event.done === true) { yield { delta: '', done: true }; return }
      }
      throw new LlmError('LLM_PROTOCOL', '模型连接提前结束，请重试。')
    } catch (error) { life.translate(error) } finally { life.close() }
  }
}
