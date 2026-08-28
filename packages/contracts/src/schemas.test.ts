import { describe, expect, it } from 'vitest'
import { SaveRequestSchema, TranslateRequestSchema } from './ipc'
import { ProviderConfigSchema } from './settings'

describe('TranslateRequestSchema', () => {
  it('accepts a valid request', () => {
    expect(
      TranslateRequestSchema.parse({
        text: 'hello',
        sourceLanguage: 'auto',
        targetLanguage: 'zh-CN',
        mode: 'natural',
      }),
    ).toEqual({ text: 'hello', sourceLanguage: 'auto', targetLanguage: 'zh-CN', mode: 'natural' })
  })

  it('rejects empty text', () => {
    expect(() =>
      TranslateRequestSchema.parse({ text: '', sourceLanguage: 'auto', targetLanguage: 'zh-CN', mode: 'natural' }),
    ).toThrow()
  })

  it('rejects unknown languages', () => {
    expect(() =>
      TranslateRequestSchema.parse({ text: 'x', sourceLanguage: 'klingon', targetLanguage: 'zh-CN', mode: 'natural' }),
    ).toThrow()
  })

  it('rejects an unknown target language used as target', () => {
    expect(() =>
      TranslateRequestSchema.parse({ text: 'x', sourceLanguage: 'en', targetLanguage: 'auto', mode: 'natural' }),
    ).toThrow()
  })
})

describe('ProviderConfigSchema', () => {
  it('fills defaults from an empty object', () => {
    const parsed = ProviderConfigSchema.parse({})
    expect(parsed).toMatchObject({
      name: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      timeoutMs: 60000,
      temperature: 0.3,
      maxRetries: 2,
    })
  })

  it('rejects out-of-range temperature', () => {
    expect(() => ProviderConfigSchema.parse({ temperature: 5 })).toThrow()
  })

  it('rejects an invalid base URL', () => {
    expect(() => ProviderConfigSchema.parse({ baseUrl: 'not a url' })).toThrow()
  })
})

describe('SaveRequestSchema', () => {
  it('accepts a save without user translation', () => {
    const parsed = SaveRequestSchema.parse({
      sourceText: 'hello',
      aiTranslation: '你好',
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      mode: 'natural',
      provider: 'openai-compatible',
      model: 'example-model',
    })
    expect(parsed.userTranslation).toBeUndefined()
    expect(parsed.tags).toBeUndefined()
  })

  it('rejects an empty AI translation', () => {
    expect(() =>
      SaveRequestSchema.parse({
        sourceText: 'hello',
        aiTranslation: '',
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        mode: 'natural',
        provider: 'openai-compatible',
        model: 'example-model',
      }),
    ).toThrow()
  })
})
