import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@tt/contracts'
import type { GenerationResult, LlmClient } from '../ai/llm-client'
import { parseJsonObject } from './learning-extractor'
import { LearningExtractor } from './learning-extractor'
import { PromptManager } from '../prompts/prompt-manager'

const repoPromptsDir = path.resolve(__dirname, '..', '..', '..', '..', 'prompts')

let vault: string

beforeEach(async () => {
  vault = await mkdtemp(path.join(tmpdir(), 'tt-extract-'))
})

afterEach(async () => {
  await rm(vault, { recursive: true, force: true })
})

const extractionJson = {
  difficultWords: [{ term: 'traceability', meaning: '可追溯性', explanation: 'domain term' }],
  expressions: [{ term: 'take into account', meaning: '考虑', explanation: '' }],
  grammarPoints: [],
}

function stubClient(text: string): { client: LlmClient; generate: ReturnType<typeof vi.fn> } {
  const generate = vi.fn(async (): Promise<GenerationResult> => ({
    text,
    provider: 'openai-compatible',
    model: 'example-model',
  }))
  return { client: { provider: 'openai-compatible', generate }, generate }
}

const input = {
  sourceText: 'We need to take traceability into account.',
  aiTranslation: '我们需要考虑可追溯性。',
  userTranslation: null,
  sourceLanguage: 'en',
  targetLanguage: 'zh-CN',
}

describe('parseJsonObject', () => {
  it('parses JSON wrapped in prose or fences', () => {
    expect(parseJsonObject('Sure!\n```json\n{"a": 1}\n```')).toEqual({ a: 1 })
  })

  it('throws typed errors without JSON', () => {
    expect(() => parseJsonObject('no json here')).toThrow(AppError)
  })
})

describe('LearningExtractor', () => {
  it('builds the analysis prompt and validates structured output', async () => {
    const prompts = new PromptManager([repoPromptsDir])
    await prompts.load()
    const extractor = new LearningExtractor(prompts)
    const { client, generate } = stubClient(JSON.stringify(extractionJson))

    const extraction = await extractor.extract(input, client)

    expect(extraction.difficultWords[0]).toMatchObject({ term: 'traceability', meaning: '可追溯性' })
    const request = generate.mock.calls[0]![0]
    expect(request.messages[0]!.content).toContain('We need to take traceability into account.')
    expect(request.messages[0]!.content).toContain('STRICT JSON')
  })

  it('uses the user final translation when present', async () => {
    const prompts = new PromptManager([repoPromptsDir])
    await prompts.load()
    const extractor = new LearningExtractor(prompts)
    const { client, generate } = stubClient(JSON.stringify(extractionJson))

    await extractor.extract({ ...input, userTranslation: '用户修正后的译文。' }, client)

    expect(generate.mock.calls[0]![0].messages[0]!.content).toContain('用户修正后的译文。')
  })

  it('rejects structurally invalid output', async () => {
    const prompts = new PromptManager([repoPromptsDir])
    await prompts.load()
    const extractor = new LearningExtractor(prompts)
    const { client } = stubClient(JSON.stringify({ difficultWords: [{ nope: true }] }))

    await expect(extractor.extract(input, client)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('rejects non-JSON output', async () => {
    const prompts = new PromptManager([repoPromptsDir])
    await prompts.load()
    const extractor = new LearningExtractor(prompts)
    const { client } = stubClient('I cannot do that.')

    await expect(extractor.extract(input, client)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
})
