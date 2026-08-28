import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ContextRetriever, renderContext } from './context-retriever'
import { GlossaryStore } from '../memory/memory-service'
import { SearchIndexService } from '../storage/search-index'
import { TranslationStore } from '../storage/translation-store'

let vault: string

beforeEach(async () => {
  vault = await mkdtemp(path.join(tmpdir(), 'tt-context-'))
})

afterEach(async () => {
  await rm(vault, { recursive: true, force: true })
})

async function makeRetriever(): Promise<{ retriever: ContextRetriever; store: TranslationStore; glossary: GlossaryStore }> {
  const store = new TranslationStore(vault, { now: () => new Date(2026, 7, 29, 9, 0, 0) })
  const index = new SearchIndexService(vault)
  const glossary = new GlossaryStore(vault)
  return { retriever: new ContextRetriever({ glossary, index }), store, glossary }
}

const draft = (sourceText: string, aiTranslation: string, userTranslation?: string) => ({
  sourceText,
  aiTranslation,
  userTranslation,
  sourceLanguage: 'en' as const,
  targetLanguage: 'zh-CN' as const,
  mode: 'natural' as const,
  provider: 'openai-compatible',
  model: 'example-model',
})

describe('ContextRetriever', () => {
  it('injects matching glossary terms only', async () => {
    const { retriever, glossary } = await makeRetriever()
    await glossary.add({ term: 'work order', translation: '工单' })
    await glossary.add({ term: 'traceability', translation: '可追溯性' })

    const context = await retriever.retrieve({ text: 'Please create a work order for the pump.' })

    expect(context.glossary.map((entry) => entry.term)).toEqual(['work order'])
    expect(context.text).toContain('- work order → 工单')
    expect(context.text).not.toContain('traceability')
  })

  it('ranks similar previous translations and flags user corrections', async () => {
    const { retriever, store } = await makeRetriever()
    await store.save(draft('We need to take traceability into account.', '我们需要考虑可追溯性。'))
    await store.save(draft('Traceability of the wire harness matters.', '线束的可追溯性很重要。', '线束追溯很重要。'))
    await store.save(draft('Unrelated weather report today.', '今天天气无关报告。'))

    const context = await retriever.retrieve({ text: 'traceability of the new wire harness' })

    expect(context.similar.length).toBeGreaterThan(0)
    expect(context.similar.length).toBeLessThanOrEqual(3)
    const corrected = context.similar.find((item) => item.corrected)
    expect(corrected?.translation).toBe('线束追溯很重要。')
    expect(context.text).toContain('(user-corrected)')
    expect(context.text).not.toContain('weather')
  })

  it('renders "None." when there is no context', () => {
    expect(renderContext({ glossary: [], similar: [], text: '' })).toBe('None.')
  })

  it('truncates oversized context blocks', () => {
    const long = 'x'.repeat(3000)
    const text = renderContext({
      glossary: [{ term: long, translation: long }],
      similar: [],
      text: '',
    })
    expect(text.length).toBeLessThanOrEqual(1201)
  })
})
