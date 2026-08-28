import type { GlossaryEntry } from '@tt/contracts'
import { tokenize } from '../storage/search-index'
import type { SearchIndexService } from '../storage/search-index'
import type { GlossaryStore } from '../memory/memory-service'

export type SimilarTranslation = {
  source: string
  translation: string
  corrected: boolean
  translationId: string
}

export type TranslationContext = {
  glossary: GlossaryEntry[]
  similar: SimilarTranslation[]
  /** Compact rendered block injected into the translation prompt. */
  text: string
}

const MAX_GLOSSARY_ITEMS = 8
const MAX_SIMILAR_ITEMS = 3
const MAX_CONTEXT_CHARS = 1200

/**
 * Translation-memory context (spec section 25): retrieve only what is
 * relevant — explicit glossary terms present in the input plus a few
 * similar previous translations — and render a compact prompt block.
 * Full-text retrieval only; embeddings stay out until they are needed.
 */
export class ContextRetriever {
  constructor(
    private readonly deps: {
      glossary: GlossaryStore
      index: SearchIndexService
    },
  ) {}

  async retrieve(input: { text: string }): Promise<TranslationContext> {
    const [glossary, similarRecords] = await Promise.all([
      this.deps.glossary.list(),
      this.deps.index.similar(input.text, 8),
    ])

    const lowerInput = input.text.toLowerCase()
    const matchedGlossary = glossary
      .filter((entry) => lowerInput.includes(entry.term.toLowerCase()))
      .slice(0, MAX_GLOSSARY_ITEMS)

    const tokens = tokenize(input.text)
    const similar = similarRecords
      .map((record) => {
        const source = record.sourceText.toLowerCase()
        const hits = tokens.filter((token) => source.includes(token)).length
        return { record, coverage: tokens.length === 0 ? 0 : hits / tokens.length }
      })
      .filter(({ coverage }) => coverage > 0)
      .sort((a, b) => b.coverage - a.coverage)
      .slice(0, MAX_SIMILAR_ITEMS)
      .map(({ record }) => ({
        translationId: record.id,
        source: oneLine(record.sourceText),
        translation: oneLine(record.userTranslation ?? record.aiTranslation),
        corrected: record.userTranslation !== null,
      }))

    const context: TranslationContext = { glossary: matchedGlossary, similar, text: '' }
    context.text = renderContext(context)
    return context
  }
}

function oneLine(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

export function renderContext(context: TranslationContext): string {
  const parts: string[] = []
  if (context.glossary.length > 0) {
    parts.push(
      [
        'Glossary (use exactly these translations):',
        ...context.glossary.map((entry) => `- ${entry.term} → ${entry.translation}`),
      ].join('\n'),
    )
  }
  if (context.similar.length > 0) {
    parts.push(
      [
        'Similar previous translations by this user (style reference):',
        ...context.similar.map(
          (item) => `- ${item.source}\n  → ${item.translation}${item.corrected ? ' (user-corrected)' : ''}`,
        ),
      ].join('\n'),
    )
  }
  const text = parts.join('\n\n')
  if (text.length > MAX_CONTEXT_CHARS) return `${text.slice(0, MAX_CONTEXT_CHARS)}…`
  return text.length > 0 ? text : 'None.'
}
