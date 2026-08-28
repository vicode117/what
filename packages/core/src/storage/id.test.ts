import { describe, expect, it } from 'vitest'
import { nextTranslationId, parseTranslationId, translationIdFor } from './id'

describe('translationIdFor', () => {
  it('formats local date and zero-padded sequence', () => {
    expect(translationIdFor(new Date(2026, 7, 29), 1)).toBe('tr_20260829_001')
    expect(translationIdFor(new Date(2026, 11, 3), 12)).toBe('tr_20261203_012')
  })
})

describe('parseTranslationId', () => {
  it('parses valid ids', () => {
    expect(parseTranslationId('tr_20260829_001')).toEqual({ year: 2026, month: 8, day: 29, sequence: 1 })
  })

  it('rejects invalid ids', () => {
    expect(parseTranslationId('other')).toBeNull()
    expect(parseTranslationId('tr_20260829_')).toBeNull()
  })
})

describe('nextTranslationId', () => {
  const now = new Date(2026, 7, 29, 10, 30)

  it('starts at 001 for an empty day', () => {
    expect(nextTranslationId([], now)).toBe('tr_20260829_001')
  })

  it('continues the sequence within the same day', () => {
    expect(nextTranslationId(['tr_20260829_001', 'tr_20260829_004'], now)).toBe('tr_20260829_005')
  })

  it('ignores ids from other days', () => {
    expect(nextTranslationId(['tr_20260828_009', 'tr_20260830_002'], now)).toBe('tr_20260829_001')
  })
})
