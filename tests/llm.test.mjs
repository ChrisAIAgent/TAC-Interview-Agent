import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

async function load(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`)
}
const { OllamaProvider } = await load('src/main/llm/ollama.ts')
const { OpenAICompatProvider } = await load('src/main/llm/openai-compat.ts')
const encode = (text) => new TextEncoder().encode(text)
function responseWithChunks(text, positions = []) {
  const bytes = encode(text)
  const chunks = []
  let previous = 0
  for (const position of [...positions, bytes.length]) { chunks.push(bytes.slice(previous, position)); previous = position }
  return new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close() } }), { status: 200 })
}
async function collect(iterable) { const result = []; for await (const item of iterable) result.push(item); return result }
const request = { system: 'system', messages: [{ role: 'user', content: 'question' }] }

test('Ollama streams chunked UTF-8 NDJSON and sends fixed generation parameters', async () => {
  let sent
  const fakeFetch = async (url, options) => {
    sent = { url, options }
    return responseWithChunks('{"message":{"content":"你好"},"done":false}\n{"message":{"content":"！"},"done":true}\n', [1, 23, 24, 25, 40])
  }
  const provider = new OllamaProvider('local-model', 'http://localhost:11434/api/chat', fakeFetch)
  assert.deepEqual(await collect(provider.chat(request, new AbortController().signal)), [{ delta: '你好', done: false }, { delta: '！', done: false }, { delta: '', done: true }])
  const body = JSON.parse(sent.options.body)
  assert.equal(body.stream, true)
  assert.deepEqual(body.options, { temperature: 0.4, num_predict: 400, top_p: 0.9 })
  assert.deepEqual(body.messages, [{ role: 'system', content: 'system' }, ...request.messages])
})

test('OpenAI SSE handles CRLF, comments, role-only events and split multibyte characters', async () => {
  let sent
  const fakeFetch = async (url, options) => {
    sent = { url, options }
    return responseWithChunks(': ping\r\ndata: {"choices":[{"delta":{"role":"assistant"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: [DONE]\r\n\r\n', [2, 48, 93, 94, 95, 99])
  }
  const controller = new AbortController()
  const provider = new OpenAICompatProvider('remote-model', 'secret', 'https://example.invalid/chat', fakeFetch)
  assert.deepEqual(await collect(provider.chat(request, controller.signal)), [{ delta: '你好', done: false }, { delta: '', done: true }])
  assert.equal(sent.options.signal.aborted, false)
  assert.equal(sent.options.headers.Authorization, 'Bearer secret')
  const body = JSON.parse(sent.options.body)
  assert.deepEqual([body.stream, body.temperature, body.max_tokens, body.top_p], [true, 0.4, 400, 0.9])
  assert.equal(JSON.stringify(body).includes('secret'), false)
})

test('HTTP failures and incomplete or malformed streams surface errors without response body leaks', async () => {
  const unauthorized = new OpenAICompatProvider('m', 'secret', 'https://example.invalid', async () => new Response('secret', { status: 401 }))
  await assert.rejects(() => collect(unauthorized.chat(request, new AbortController().signal)), (error) => error.code === 'LLM_AUTH' && !error.message.includes('secret'))
  const truncated = new OllamaProvider('m', 'http://localhost', async () => responseWithChunks('{"message":{"content":"partial"},"done":false}\n'))
  await assert.rejects(() => collect(truncated.chat(request, new AbortController().signal)), (error) => error.code === 'LLM_PROTOCOL')
  const invalid = new OpenAICompatProvider('m', '', 'https://example.invalid', async () => responseWithChunks('data: {invalid}\n\n'))
  await assert.rejects(() => collect(invalid.chat(request, new AbortController().signal)), (error) => error.code === 'LLM_PROTOCOL')
})

test('aborting a request propagates cancellation to fetch', async () => {
  const controller = new AbortController()
  const provider = new OllamaProvider('m', 'http://localhost', async (_url, options) => {
    assert.equal(options.signal.aborted, true)
    throw new DOMException('Aborted', 'AbortError')
  })
  controller.abort()
  await assert.rejects(() => collect(provider.chat(request, controller.signal)), (error) => error.name === 'AbortError')
})


test('429 retries once before any content and keeps the configured endpoint', async () => {
  let calls = 0
  const urls = []
  const provider = new OpenAICompatProvider('m', 'secret', 'https://example.invalid/v1/', async (url) => {
    urls.push(url); calls++
    return calls === 1 ? new Response('rate limited', { status: 429 }) : responseWithChunks('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n')
  })
  assert.deepEqual(await collect(provider.chat(request, new AbortController().signal)), [{ delta: 'ok', done: false }, { delta: '', done: true }])
  assert.equal(calls, 2)
  assert.deepEqual(urls, ['https://example.invalid/v1/chat/completions', 'https://example.invalid/v1/chat/completions'])
})

test('connect deadline aborts and reports LLM_TIMEOUT', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const provider = new OpenAICompatProvider('m', '', 'https://example.invalid/v1', async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  }))
  const running = collect(provider.chat(request, new AbortController().signal))
  const assertion = assert.rejects(running, error => error.code === 'LLM_TIMEOUT')
  t.mock.timers.tick(10_000)
  await assertion
})

test('local connection test reports a missing Ollama service', async () => {
  const provider = new OllamaProvider('qwen2.5:7b-instruct', 'http://localhost', async () => { throw new TypeError('fetch failed') })
  const result = await provider.test()
  assert.equal(result.ok, false)
  assert.match(result.error, /ollama pull qwen2\.5:7b-instruct/)
})

test('first-token timeout interrupts a connected stream', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let accepted
  const connected = new Promise(resolve => { accepted = resolve })
  const provider = new OpenAICompatProvider('m', '', 'https://example.invalid/v1', async (_url, options) => {
    const body = new ReadableStream({ start(controller) { options.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true }) } })
    accepted()
    return new Response(body)
  })
  const running = collect(provider.chat(request, new AbortController().signal))
  const assertion = assert.rejects(running, error => error.code === 'LLM_TIMEOUT')
  await connected
  await new Promise(resolve => setImmediate(resolve))
  t.mock.timers.tick(20_000)
  await assertion
})

test('overall timeout preserves already-yielded content', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const provider = new OpenAICompatProvider('m', '', 'https://example.invalid/v1', async (_url, options) => {
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'))
      options.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true })
    } })
    return new Response(body)
  })
  const iterator = provider.chat(request, new AbortController().signal)[Symbol.asyncIterator]()
  assert.deepEqual((await iterator.next()).value, { delta: 'partial', done: false })
  const assertion = assert.rejects(iterator.next(), error => error.code === 'LLM_TIMEOUT')
  t.mock.timers.tick(60_000)
  await assertion
})
