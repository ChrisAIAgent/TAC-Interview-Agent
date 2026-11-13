import { isRecord, LlmError, parseJson, readLines, RequestLifetime, testProvider } from './provider'
import type { ChatChunk, ChatRequest, FetchLike, LlmProvider, TestResult } from './provider'

export class OpenAICompatProvider implements LlmProvider {
  readonly id = 'openai-compat' as const
  readonly label = 'OpenAI 兼容接口'
  readonly kind = 'cloud' as const
  constructor(private readonly model: string, private readonly apiKey: string, private readonly baseUrl = 'https://api.openai.com/v1', private readonly request: FetchLike = fetch) {}
  test(): Promise<TestResult> { return testProvider(this, this.model, false) }
  async *chat(req: ChatRequest, signal: AbortSignal): AsyncGenerator<ChatChunk> {
    const life = new RequestLifetime(signal)
    try {
      const response = await life.fetch(this.request, `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, stream: true, messages: [{ role: 'system', content: req.system }, ...req.messages], temperature: req.temperature ?? 0.4, max_tokens: req.maxTokens ?? 400, top_p: 0.9, ...(req.disableThinking ? { enable_thinking: false } : {}) })
      })
      let fields: string[] = []
      for await (const line of readLines(response.body!)) {
        if (line !== '') { if (line.startsWith('data:')) fields.push(line.slice(5).replace(/^ /, '')); continue }
        if (!fields.length) continue
        const data = fields.join('\n'); fields = []
        if (data === '[DONE]') { yield { delta: '', done: true }; return }
        const event = parseJson(data)
        if (!isRecord(event) || !Array.isArray(event.choices)) throw new LlmError('LLM_PROTOCOL', '模型返回了无效的流式数据。')
        const choice: unknown = event.choices[0]
        if (isRecord(choice) && isRecord(choice.delta) && typeof choice.delta.content === 'string' && choice.delta.content) {
          life.gotToken(); yield { delta: choice.delta.content, done: false }
        }
      }
      throw new LlmError('LLM_PROTOCOL', '模型连接提前结束，请重试。')
    } catch (error) { life.translate(error) } finally { life.close() }
  }
}
