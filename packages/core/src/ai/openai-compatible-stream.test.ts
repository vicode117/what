import { describe, expect, it, vi } from 'vitest'
import { OpenAiCompatibleClient } from './openai-compatible-client'

const baseOptions = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test' as string | null,
  model: 'example-model',
  maxRetries: 0,
  sleepImpl: () => Promise.resolve(),
  jitterImpl: () => 0,
}

function makeClient(overrides?: Partial<typeof baseOptions> & { fetchImpl?: typeof fetch }): OpenAiCompatibleClient {
  return new OpenAiCompatibleClient({ ...baseOptions, ...overrides })
}

function sseChunk(content: string, model?: string): string {
  const delta: Record<string, unknown> = content.length > 0 ? { content } : {}
  return `data: ${JSON.stringify({ model: model ?? 'example-model', choices: [{ delta }] })}\n\n`
}

function sseResponse(parts: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

async function collect(iterable: AsyncIterable<{ textDelta: string }>): Promise<string> {
  let text = ''
  for await (const chunk of iterable) text += chunk.textDelta
  return text
}

describe('OpenAiCompatibleClient.stream', () => {
  it('yields deltas, sends stream:true, and stops at [DONE]', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([sseChunk('你好，'), sseChunk('世界', undefined), 'data: [DONE]\n\n', sseChunk('ignored')]),
    )
    const client = makeClient({ fetchImpl })

    const text = await collect(client.stream({ messages: [{ role: 'user', content: 'hi' }] }))

    expect(text).toBe('你好，世界')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect(JSON.parse(String(init.body)).stream).toBe(true)
  })

  it('reports the model from the first chunk', async () => {
    const client = makeClient({ fetchImpl: async () => sseResponse([sseChunk('hi', 'stream-model')]) })
    for await (const chunk of client.stream({ messages: [{ role: 'user', content: 'hi' }] })) {
      expect(chunk.model).toBe('stream-model')
      break
    }
  })

  it('falls back to a plain JSON body when the server ignores stream:true', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ model: 'example-model', choices: [{ message: { role: 'assistant', content: '整段译文' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const client = makeClient({ fetchImpl })

    const text = await collect(client.stream({ messages: [{ role: 'user', content: 'hi' }] }))
    expect(text).toBe('整段译文')
  })

  it('skips malformed lines and keep-alive comments', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([': keep-alive\n\n', 'not a data line\n\n', sseChunk('ok'), 'data: {broken\n\n']),
    )
    const client = makeClient({ fetchImpl })

    const text = await collect(client.stream({ messages: [{ role: 'user', content: 'hi' }] }))
    expect(text).toBe('ok')
  })

  it('maps the overall timeout to TIMEOUT', async () => {
    const fetchImpl = vi.fn(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const client = makeClient({ fetchImpl })

    await expect(
      collect(client.stream({ messages: [{ role: 'user', content: 'hi' }], timeoutMs: 20 })),
    ).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('maps caller cancellation to CANCELLED', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const client = makeClient({ fetchImpl })

    const pending = collect(client.stream({ messages: [{ role: 'user', content: 'hi' }], signal: controller.signal }))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
  })

  it('maps HTTP failures to typed errors', async () => {
    const fetchImpl = vi.fn(async () => new Response('unauthorized', { status: 401 }))
    const client = makeClient({ fetchImpl })

    await expect(
      collect(client.stream({ messages: [{ role: 'user', content: 'hi' }] })),
    ).rejects.toMatchObject({ code: 'AUTH_ERROR' })
  })
})
