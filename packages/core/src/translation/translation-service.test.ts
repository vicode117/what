import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AppError } from '@tt/contracts'
import type {
  GenerationRequest,
  GenerationResult,
  LlmClient,
} from '../ai/llm-client'
import type { ProviderRuntime } from './translation-service'
import { PromptManager } from '../prompts/prompt-manager'
import { TranslationService } from './translation-service'

const repoPromptsDir = path.resolve(__dirname, '..', '..', '..', '..', 'prompts')

type GenerateFn = (request: GenerationRequest) => Promise<GenerationResult>

function stubClient(overrides: {
  generate?: GenerateFn
  stream?: LlmClient['stream']
} = {}): LlmClient & { generate: GenerateFn } {
  const generate: GenerateFn =
    overrides.generate ??
    (async () => ({
      text: '  译文  ',
      provider: 'openai-compatible',
      model: 'example-model',
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    }))
  const client: LlmClient & { generate: GenerateFn } = { provider: 'openai-compatible', generate }
  if (overrides.stream) client.stream = overrides.stream
  return client
}

function provider(label: string, client: LlmClient, models: string[] = ['example-model']): ProviderRuntime {
  return { id: `id-${label}`, label, models, client }
}

async function makeService(): Promise<TranslationService> {
  const prompts = new PromptManager([repoPromptsDir])
  await prompts.load()
  return new TranslationService(prompts)
}

const request = {
  text: 'hello',
  sourceLanguage: 'en' as const,
  targetLanguage: 'zh-CN' as const,
  mode: 'natural' as const,
}

describe('TranslationService', () => {
  it('builds the mode prompt, sends the source text, and trims the result', async () => {
    const service = await makeService()
    const generate = vi.fn<GenerateFn>(async () => ({
      text: '  译文  ',
      provider: 'openai-compatible',
      model: 'example-model',
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    }))
    const providers = [provider('Main', stubClient({ generate }))]

    const result = await service.translate(request, providers)

    expect(result).toMatchObject({
      translatedText: '译文',
      provider: 'Main',
      model: 'example-model',
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    })
    expect(result.durationMs).toBeGreaterThanOrEqual(0)

    const sent = generate.mock.calls[0]![0]
    expect(sent.messages).toHaveLength(2)
    expect(sent.messages[0]!.role).toBe('system')
    expect(sent.messages[0]!.content).toContain('English')
    expect(sent.messages[0]!.content).toContain('Chinese (Simplified)')
    expect(sent.messages[1]!.content).toBe('hello')
  })

  it('asks for auto-detection when the source language is auto', async () => {
    const service = await makeService()
    const generate = vi.fn<GenerateFn>(async () => ({
      text: 'x',
      provider: 'openai-compatible',
      model: 'm',
    }))
    await service.translate(
      { ...request, sourceLanguage: 'auto', mode: 'literal' },
      [provider('P', stubClient({ generate }))],
    )
    expect(generate.mock.calls[0]![0].messages[0]!.content).toContain('auto-detect')
  })

  it('uses a different prompt per mode', async () => {
    const service = await makeService()
    const first = vi.fn<GenerateFn>(async () => ({ text: 'a', provider: 'p', model: 'm' }))
    const second = vi.fn<GenerateFn>(async () => ({ text: 'b', provider: 'p', model: 'm' }))

    await service.translate(request, [provider('P', stubClient({ generate: first }))])
    await service.translate({ ...request, mode: 'literal' }, [provider('P', stubClient({ generate: second }))])

    expect(first.mock.calls[0]![0].messages[0]!.content).not.toBe(
      second.mock.calls[0]![0].messages[0]!.content,
    )
  })

  it('injects translation-memory context into the prompt when a retriever is provided', async () => {
    const prompts = new PromptManager([repoPromptsDir])
    await prompts.load()
    const service = new TranslationService(prompts, {
      retrieve: async () => ({
        glossary: [],
        similar: [],
        text: 'Glossary (use exactly these translations):\n- work order → 工单',
      }),
    } as unknown as ConstructorParameters<typeof TranslationService>[1])
    const generate = vi.fn<GenerateFn>(async () => ({ text: 'x', provider: 'p', model: 'm' }))

    await service.translate(
      { text: 'Please create a work order.', sourceLanguage: 'en', targetLanguage: 'zh-CN', mode: 'natural' },
      [provider('P', stubClient({ generate }))],
    )

    expect(generate.mock.calls[0]![0].messages[0]!.content).toContain('- work order → 工单')
  })

  describe('provider failover', () => {
    it('falls through to the next provider when one fails with a retryable error', async () => {
      const service = await makeService()
      const failing = vi.fn<GenerateFn>(async () => {
        throw new AppError('RATE_LIMIT', '429')
      })
      const succeeding = vi.fn<GenerateFn>(async () => ({
        text: 'from backup',
        provider: 'openai-compatible',
        model: 'backup-model',
      }))

      const result = await service.translate(request, [
        provider('Primary', stubClient({ generate: failing })),
        provider('Backup', stubClient({ generate: succeeding })),
      ])

      expect(result).toMatchObject({ translatedText: 'from backup', provider: 'Backup', model: 'backup-model' })
      expect(failing).toHaveBeenCalledTimes(1)
      expect(succeeding).toHaveBeenCalledTimes(1)
    })

    it('does not fail over request-side errors', async () => {
      const service = await makeService()
      const failing = vi.fn<GenerateFn>(async () => {
        throw new AppError('PROMPT_ERROR', 'missing prompt variable')
      })
      const never = vi.fn<GenerateFn>(async () => ({ text: 'x', provider: 'p', model: 'm' }))

      await expect(
        service.translate(request, [provider('A', stubClient({ generate: failing })), provider('B', stubClient({ generate: never }))]),
      ).rejects.toMatchObject({ code: 'PROMPT_ERROR' })
      expect(never).not.toHaveBeenCalled()
    })

    it('reports all attempts when every provider fails', async () => {
      const service = await makeService()
      const providers = [
        provider('A', stubClient({ generate: async () => { throw new AppError('TIMEOUT', 'slow') } })),
        provider('B', stubClient({ generate: async () => { throw new AppError('AUTH_ERROR', 'bad key') } })),
      ]

      const error = await service.translate(request, providers).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('AUTH_ERROR')
      expect((error as AppError).message).toContain('All 2 provider/model combo(s) failed')
    })

    it('throws CONFIG_ERROR when no provider is configured', async () => {
      const service = await makeService()
      await expect(service.translate(request, [])).rejects.toMatchObject({ code: 'CONFIG_ERROR' })
    })

    it('streams deltas and resolves with the trimmed result', async () => {
      const service = await makeService()
      const deltas: string[] = []
      const client = stubClient({
        stream: async function* () {
          yield { textDelta: '  你好，' }
          yield { textDelta: '世界' }
          yield { textDelta: '', model: 'stream-model' }
        },
      })

      const result = await service.translateStream(request, [provider('Main', client)], (delta) =>
        deltas.push(delta),
      )

      expect(result).toMatchObject({ translatedText: '你好，世界', model: 'stream-model' })
      // Deltas are forwarded raw; only the final result is trimmed.
      expect(deltas).toEqual(['  你好，', '世界'])
    })

    it('fails over before the first delta when a streaming provider fails', async () => {
      const service = await makeService()
      const failingStream = stubClient({
        stream: async function* () {
          yield { textDelta: '' }
          throw new AppError('NETWORK_ERROR', 'dropped')
        },
      })
      const backup = stubClient({
        stream: async function* () {
          yield { textDelta: '备用译文' }
        },
      })

      const result = await service.translateStream(request, [
        provider('Primary', failingStream),
        provider('Backup', backup),
      ])

      expect(result).toMatchObject({ translatedText: '备用译文', provider: 'Backup' })
    })

    it('does NOT fail over after the first delta has been emitted', async () => {
      const service = await makeService()
      const partial = stubClient({
        stream: async function* () {
          yield { textDelta: '部分' }
          throw new AppError('NETWORK_ERROR', 'dropped mid-stream')
        },
      })
      const never = stubClient({
        stream: async function* () {
          yield { textDelta: 'should not happen' }
        },
      })

      await expect(
        service.translateStream(request, [provider('Primary', partial), provider('Backup', never)]),
      ).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    })

    it('falls back to generate() when the client has no stream support', async () => {
      const service = await makeService()
      const generate = vi.fn<GenerateFn>(async () => ({
        text: '  译文  ',
        provider: 'openai-compatible',
        model: 'example-model',
      }))
      const client = stubClient({ generate })

      const result = await service.translateStream(request, [provider('Main', client)])

      expect(result.translatedText).toBe('译文')
      expect(generate).toHaveBeenCalledTimes(1)
    })
  })

  it('propagates typed errors from the client', async () => {
    const service = await makeService()
    const generate = vi.fn<GenerateFn>(async () => {
      throw new AppError('PROMPT_ERROR', 'missing')
    })
    await expect(
      service.translate(request, [provider('P', stubClient({ generate }))]),
    ).rejects.toMatchObject({ code: 'PROMPT_ERROR' })
  })
})
