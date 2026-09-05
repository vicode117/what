import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LearningPointStore, normalizeTerm } from './learning-point-store'
import { MemoryService, GlossaryStore } from './memory-service'
import { LearningExtractor } from '../analysis/learning-extractor'
import { PromptManager } from '../prompts/prompt-manager'

let vault: string

beforeEach(async () => {
  vault = await mkdtemp(path.join(tmpdir(), 'tt-memory-'))
})

afterEach(async () => {
  await rm(vault, { recursive: true, force: true })
})

const repoPromptsDir = path.resolve(__dirname, '..', '..', '..', '..', 'prompts')

const record = (id: string, createdAt: string) => ({
  id,
  createdAt,
  sourceLanguage: 'en' as const,
  targetLanguage: 'zh-CN' as const,
  mode: 'natural' as const,
  provider: 'openai-compatible',
  model: 'example-model',
  tags: [],
  notes: '',
  sourceText: 'source',
  aiTranslation: 'ai',
  userTranslation: null,
  analyzedAt: null,
  deletedAt: null,
  filePath: path.join(vault, `${id}.md`),
})

describe('LearningPointStore (dedup + merge)', () => {
  it('merges duplicate vocabulary into one point with occurrences', async () => {
    const store = new LearningPointStore(vault, { now: () => new Date(2026, 7, 29) })
    const first = await store.upsertCandidate('tr_20260829_001', '2026-08-29', 'vocabulary', {
      term: 'Traceability',
      meaning: '可追溯性',
    })
    const second = await store.upsertCandidate('tr_20260829_002', '2026-08-29', 'vocabulary', {
      term: 'traceability',
      meaning: '',
    })

    expect(second.id).toBe(first.id)
    // Re-read: upsertCandidate returns fresh snapshots on merge.
    const merged = store.get(first.id)!
    expect(merged.sourceTranslationIds).toEqual(['tr_20260829_001', 'tr_20260829_002'])
    expect(merged.occurrenceDates).toEqual(['2026-08-29'])
    expect(merged.meaning).toBe('可追溯性')
  })

  it('persists to Markdown and reloads from disk', async () => {
    const store = new LearningPointStore(vault, { now: () => new Date(2026, 7, 29) })
    await store.upsertCandidate('tr_20260829_001', '2026-08-29', 'expression', {
      term: 'take into account',
      meaning: '考虑',
      explanation: 'common collocation',
    })

    const fresh = new LearningPointStore(vault)
    await fresh.load()
    const all = fresh.all()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({
      kind: 'expression',
      term: 'take into account',
      meaning: '考虑',
      explanation: 'common collocation',
      status: 'active',
      sourceTranslationIds: ['tr_20260829_001'],
    })
  })

  it('normalizes terms case-insensitively', () => {
    expect(normalizeTerm('  Wire Harness ')).toBe('wire harness')
  })

  it('updates status and notes', async () => {
    const store = new LearningPointStore(vault, { now: () => new Date(2026, 7, 29) })
    const point = await store.upsertCandidate('tr_20260829_001', '2026-08-29', 'vocabulary', { term: 'term' })
    const updated = await store.update(point.id, { status: 'mastered', notes: 'know it' })
    expect(updated?.status).toBe('mastered')
    expect(updated?.notes).toBe('know it')
  })

  it('deletes the underlying file', async () => {
    const store = new LearningPointStore(vault, { now: () => new Date(2026, 7, 29) })
    const point = await store.upsertCandidate('tr_20260829_001', '2026-08-29', 'vocabulary', { term: 'gone' })
    expect(await store.delete(point.id)).toBe(true)
    expect(await store.delete(point.id)).toBe(false)
    const fresh = new LearningPointStore(vault)
    await fresh.load()
    expect(fresh.all()).toHaveLength(0)
  })
})

describe('MemoryService.analyze', () => {
  it('persists extraction candidates with provenance', async () => {
    const store = new LearningPointStore(vault, { now: () => new Date(2026, 7, 29) })
    const prompts = new PromptManager([repoPromptsDir])
    await prompts.load()
    const memory = new MemoryService(store, new LearningExtractor(prompts))

    const extractionJson = {
      difficultWords: [{ term: 'traceability', meaning: '可追溯性', explanation: '' }],
      expressions: [{ term: 'take into account', meaning: '考虑', explanation: '' }],
      grammarPoints: [{ pattern: 'need to + verb', explanation: 'obligation' }],
    }
    const client = {
      provider: 'openai-compatible',
      generate: async () => ({
        text: JSON.stringify(extractionJson),
        provider: 'openai-compatible',
        model: 'example-model',
      }),
    }

    const result = await memory.analyze(record('tr_20260829_001', '2026-08-29T10:00:00.000Z'), client)
    expect(result.learningPointIds).toHaveLength(3)

    const all = store.all()
    expect(all.map((p) => p.kind).sort()).toEqual(['expression', 'grammar', 'vocabulary'])
    expect(all.every((p) => p.sourceTranslationIds.includes('tr_20260829_001'))).toBe(true)
  })
})

describe('GlossaryStore', () => {
  it('starts empty, adds and replaces entries, removes them', async () => {
    const glossary = new GlossaryStore(vault)
    expect(await glossary.list()).toEqual([])

    await glossary.add({ term: 'work order', translation: '工单' })
    await glossary.add({ term: 'traceability', translation: '可追溯性' })
    await glossary.add({ term: 'Work Order', translation: '工单（更新）' })

    const entries = await glossary.list()
    expect(entries).toHaveLength(2)
    expect(entries.find((entry) => entry.term === 'Work Order')?.translation).toBe('工单（更新）')

    await glossary.remove('traceability')
    expect((await glossary.list()).map((entry) => entry.term)).toEqual(['Work Order'])
  })

  it('refreshes cached entries when the glossary file changes externally', async () => {
    const file = path.join(vault, 'memory', 'glossary', 'glossary.md')
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, '# Glossary\n\n- term :: first\n', 'utf8')

    const glossary = new GlossaryStore(vault)
    expect(await glossary.list()).toEqual([{ term: 'term', translation: 'first' }])

    await writeFile(file, '# Glossary\n\n- term :: refreshed translation\n', 'utf8')
    expect(await glossary.list()).toEqual([{ term: 'term', translation: 'refreshed translation' }])
  })
})
