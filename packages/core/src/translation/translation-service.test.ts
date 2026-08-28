import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { AppError } from '@tt/contracts'
import type { GenerationRequest, GenerationResult, LlmClient } from '../ai/llm-client'
import { PromptManager } from '../prompts/prompt-manager'
import { TranslationService } from './translation-service'

const repoPromptsDir = path.resolve(__dirname, '..', '..', '..', '..', 'prompts')

type GenerateFn = (request: GenerationRequest) => Promise<GenerationResult>

function stubClient(): { client: LlmClient; generate: Mock<GenerateFn> } {
  const generate = vi.fn<GenerateFn>(async () => ({
    text: '  译文  ',
    provider: 'openai-compatible',
    model: 'example-model',
    usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
  }))
  return { client: { provider: 'openai-compatible', generate }, generate }
}

async function makeService(): Promise<TranslationService> {
  const prompts = new PromptManager([repoPromptsDir])
  await prompts.load()
  return new TranslationService(prompts)
}

describe('TranslationService', () => {
  it('builds the mode prompt, sends the source text, and trims the result', async () => {
    const service = await makeService()
    const { client, generate } = stubClient()

    const result = await service.translate(
      { text: 'hello', sourceLanguage: 'en', targetLanguage: 'zh-CN', mode: 'natural' },
      client,
    )

    expect(result).toMatchObject({
      translatedText: '译文',
      provider: 'openai-compatible',
      model: 'example-model',
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    })
    expect(result.durationMs).toBeGreaterThanOrEqual(0)

    const request = generate.mock.calls[0]![0]
    expect(request.messages).toHaveLength(2)
    expect(request.messages[0]!.role).toBe('system')
    expect(request.messages[0]!.content).toContain('English')
    expect(request.messages[0]!.content).toContain('Chinese (Simplified)')
    expect(request.messages[1]!.content).toBe('hello')
  })

  it('asks for auto-detection when the source language is auto', async () => {
    const service = await makeService()
    const { client, generate } = stubClient()

    await service.translate(
      { text: 'hello', sourceLanguage: 'auto', targetLanguage: 'zh-CN', mode: 'literal' },
      client,
    )

    expect(generate.mock.calls[0]![0].messages[0]!.content).toContain('auto-detect')
  })

  it('uses a different prompt per mode', async () => {
    const service = await makeService()
    const first = stubClient()
    const second = stubClient()

    await service.translate(
      { text: 'hello', sourceLanguage: 'en', targetLanguage: 'zh-CN', mode: 'natural' },
      first.client,
    )
    await service.translate(
      { text: 'hello', sourceLanguage: 'en', targetLanguage: 'zh-CN', mode: 'literal' },
      second.client,
    )

    const naturalPrompt = first.generate.mock.calls[0]![0].messages[0]!.content
    const literalPrompt = second.generate.mock.calls[0]![0].messages[0]!.content
    expect(naturalPrompt).not.toBe(literalPrompt)
  })

  it('propagates typed errors from the client', async () => {
    const service = await makeService()
    const { client, generate } = stubClient()
    generate.mockRejectedValueOnce(new AppError('TIMEOUT', 'timed out'))

    await expect(
      service.translate(
        { text: 'hello', sourceLanguage: 'en', targetLanguage: 'zh-CN', mode: 'natural' },
        client,
      ),
    ).rejects.toMatchObject({ code: 'TIMEOUT' })
  })
})
