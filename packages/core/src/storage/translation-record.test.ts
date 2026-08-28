import { describe, expect, it } from 'vitest'
import { finalTranslation, isUserEdited } from '@tt/contracts'
import { parseTranslationRecord, serializeTranslationRecord } from './translation-record'

const base = {
  id: 'tr_20260829_001',
  createdAt: '2026-08-29T10:30:00.000Z',
  sourceLanguage: 'en' as const,
  targetLanguage: 'zh-CN' as const,
  mode: 'natural' as const,
  provider: 'openai-compatible',
  model: 'example-model',
  tags: ['software'],
  notes: 'remember this phrase',
  sourceText: 'The application should remain maintainable over time.',
  aiTranslation: '这个应用应该能够长期保持可维护性。',
  userTranslation: null,
  analyzedAt: null,
  deletedAt: null,
}

describe('serializeTranslationRecord / parseTranslationRecord', () => {
  it('round-trips an unedited record', () => {
    const markdown = serializeTranslationRecord(base)
    expect(markdown).toContain('id: tr_20260829_001')
    expect(markdown).toContain('# Translation')
    expect(markdown).toContain('## Source')
    expect(markdown).toContain('## Translation')
    expect(markdown).not.toContain('## AI Translation')
    expect(parseTranslationRecord(markdown)).toEqual(base)
  })

  it('stores the final text in ## Translation and keeps the AI original when edited', () => {
    const edited = { ...base, userTranslation: '这个应用应能长期保持可维护性。' }
    const markdown = serializeTranslationRecord(edited)
    expect(markdown).toContain('edited: true')
    expect(markdown).toContain('## AI Translation')
    expect(markdown.indexOf('这个应用应能长期保持可维护性。')).toBeGreaterThan(
      markdown.indexOf('## Translation'),
    )
    expect(markdown).toContain('这个应用应该能够长期保持可维护性。')

    const parsed = parseTranslationRecord(markdown)
    expect(parsed.aiTranslation).toBe(base.aiTranslation)
    expect(parsed.userTranslation).toBe('这个应用应能长期保持可维护性。')
    expect(isUserEdited(parsed)).toBe(true)
    expect(finalTranslation(parsed)).toBe('这个应用应能长期保持可维护性。')
  })

  it('round-trips multi-line content', () => {
    const multiline = { ...base, sourceText: 'line one\n\nline two', aiTranslation: '第一行\n\n第二行' }
    const parsed = parseTranslationRecord(serializeTranslationRecord(multiline))
    expect(parsed.sourceText).toBe('line one\n\nline two')
    expect(parsed.aiTranslation).toBe('第一行\n\n第二行')
  })

  it('omits the Notes section when notes are empty', () => {
    const markdown = serializeTranslationRecord({ ...base, notes: '' })
    expect(markdown).not.toContain('## Notes')
    expect(parseTranslationRecord(markdown).notes).toBe('')
  })

  it('serializes tags as a YAML list', () => {
    const markdown = serializeTranslationRecord(base)
    expect(markdown).toContain('tags:')
    expect(markdown).toContain('  - software')
  })

  it('throws when required sections are missing', () => {
    const broken = serializeTranslationRecord(base).replace('## Translation', '## Missing')
    expect(() => parseTranslationRecord(broken)).toThrow()
  })
})
