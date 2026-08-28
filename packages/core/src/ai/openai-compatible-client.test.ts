import { describe, expect, it, vi } from 'vitest'
import { AppError } from '@tt/contracts'
import { OpenAiCompatibleClient } from './openai-compatible-client'

const completion = (text: string) => ({
  model: 'example-model',
  choices: [{ message: { role: 'assistant', content: text } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
})

const okResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

const baseOptions: {
  baseUrl: string
  apiKey: string | null
  model: string
  maxRetries: number
  sleepImpl: () => Promise<void>
  jitterImpl: () => number
} = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'example-model',
  maxRetries: 2,
  sleepImpl: () => Promise.resolve(),
  jitterImpl: () => 0,
}

function makeClient(overrides?: Partial<typeof baseOptions> & { fetchImpl?: typeof fetch }): OpenAiCompatibleClient {
  return new OpenAiCompatibleClient({ ...baseOptions, ...overrides })
}

describe('OpenAiCompatibleClient', () => {
  it('sends model, messages and authorization header, and maps the response', async () => {
    const fetchImpl = vi.fn(async () => okResponse(completion('你好，世界')))
    const client = makeClient({ fetchImpl })

    const result = await client.generate({ messages: [{ role: 'user', content: 'hello' }] })

    expect(result.text).toBe('你好，世界')
    expect(result.provider).toBe('openai-compatible')
    expect(result.model).toBe('example-model')
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 })

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer sk-test')
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('example-model')
    expect(body.stream).toBe(false)
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('never sends an Authorization header without an API key', async () => {
    const fetchImpl = vi.fn(async () => okResponse(completion('x')))
    const client = makeClient({ fetchImpl, apiKey: null })
    await client.generate({ messages: [{ role: 'user', content: 'hi' }] })
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(new Headers(init.headers).get('Authorization')).toBeNull()
  })

  it('retries rate limits and succeeds', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls += 1
      if (calls === 1) return new Response('rate limited', { status: 429 })
      return okResponse(completion('ok'))
    })

    const result = await makeClient({ fetchImpl }).generate({
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(result.text).toBe('ok')
    expect(calls).toBe(2)
  })

  it('does not retry auth errors', async () => {
    const fetchImpl = vi.fn(async () => new Response('unauthorized', { status: 401 }))
    const client = makeClient({ fetchImpl })

    await expect(client.generate({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({
      code: 'AUTH_ERROR',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('gives up after maxRetries on provider errors', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 }))
    const client = makeClient({ fetchImpl, maxRetries: 2 })

    await expect(client.generate({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(3) // 1 initial + 2 retries
  })

  it('retries network failures', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new TypeError('fetch failed')
      return okResponse(completion('ok'))
    })

    const result = await makeClient({ fetchImpl, maxRetries: 1 }).generate({
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(result.text).toBe('ok')
    expect(calls).toBe(2)
  })

  it('maps invalid JSON to INVALID_RESPONSE', async () => {
    const fetchImpl = vi.fn(async () => new Response('not json', { status: 200 }))
    const client = makeClient({ fetchImpl, maxRetries: 0 })

    await expect(client.generate({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    })
  })

  it('maps missing message content to INVALID_RESPONSE', async () => {
    const fetchImpl = vi.fn(async () => okResponse({ choices: [] }))
    const client = makeClient({ fetchImpl, maxRetries: 0 })

    await expect(client.generate({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    })
  })

  it('maps per-attempt timeout to TIMEOUT', async () => {
    const fetchImpl = vi.fn(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const client = makeClient({ fetchImpl, maxRetries: 0 })

    await expect(
      client.generate({ messages: [{ role: 'user', content: 'hi' }], timeoutMs: 20 }),
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
    const client = makeClient({ fetchImpl, maxRetries: 0 })

    const pending = client.generate({
      messages: [{ role: 'user', content: 'hi' }],
      signal: controller.signal,
      timeoutMs: 5000,
    })
    controller.abort()

    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
  })

  it('exposes AppError instances with code and details', async () => {
    const fetchImpl = vi.fn(async () => new Response('forbidden', { status: 403 }))
    const client = makeClient({ fetchImpl, maxRetries: 0 })

    const error = await client
      .generate({ messages: [{ role: 'user', content: 'hi' }] })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe('AUTH_ERROR')
  })
})
