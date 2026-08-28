import { AppError } from '@tt/contracts'
import type { TranslationRecord } from '@tt/contracts'
import { LanguageCodeSchema, SourceLanguageSchema, TranslationModeSchema, finalTranslation } from '@tt/contracts'
import { z } from 'zod'
import { buildBody, parseBody, parseDocument, serializeDocument } from './markdown'

const SECTION_HEADINGS = ['Source', 'Translation', 'AI Translation', 'Notes'] as const

const RecordMetaSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  sourceLanguage: SourceLanguageSchema,
  targetLanguage: LanguageCodeSchema,
  mode: TranslationModeSchema,
  provider: z.string().min(1),
  model: z.string().min(1),
  tags: z.array(z.string()).default([]),
  edited: z.boolean().default(false),
  analyzedAt: z.string().nullable().default(null),
  deletedAt: z.string().nullable().default(null),
})

/**
 * Serializes a record to Markdown.
 *
 * `## Translation` always holds the FINAL text (user version when edited).
 * When the user edited the translation, the original AI output is kept in
 * a separate `## AI Translation` section — the difference is training data
 * and must never be overwritten.
 */
export function serializeTranslationRecord(record: TranslationRecord): string {
  const edited = record.userTranslation !== null
  const frontmatter: Record<string, unknown> = {
    id: record.id,
    createdAt: record.createdAt,
    sourceLanguage: record.sourceLanguage,
    targetLanguage: record.targetLanguage,
    mode: record.mode,
    provider: record.provider,
    model: record.model,
    tags: record.tags,
    edited,
  }
  if (record.analyzedAt !== null) frontmatter['analyzedAt'] = record.analyzedAt
  if (record.deletedAt !== null) frontmatter['deletedAt'] = record.deletedAt

  const sections: { heading: string; content: string }[] = [
    { heading: 'Source', content: record.sourceText },
    { heading: 'Translation', content: finalTranslation(record) },
  ]
  if (record.userTranslation !== null) {
    sections.push({ heading: 'AI Translation', content: record.aiTranslation })
  }
  if (record.notes.trim().length > 0) {
    sections.push({ heading: 'Notes', content: record.notes })
  }

  return serializeDocument(frontmatter, buildBody('Translation', sections))
}

export function parseTranslationRecord(raw: string): TranslationRecord {
  const document = parseDocument(raw)

  const meta = RecordMetaSchema.safeParse(document.frontmatter)
  if (!meta.success) {
    throw new AppError('STORAGE_ERROR', 'Translation frontmatter is missing or invalid', {
      issues: meta.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    })
  }

  const sections = parseBody(document.body, SECTION_HEADINGS)
  const sourceText = sections['Source']
  const finalText = sections['Translation']
  if (!sourceText || !finalText) {
    throw new AppError('STORAGE_ERROR', 'Translation markdown is missing the Source or Translation section')
  }

  const aiSection = sections['AI Translation'] ?? null
  const aiTranslation = aiSection ?? finalText
  const userTranslation = meta.data.edited ? finalText : null

  // `edited` is an on-disk flag, not part of the in-memory record shape.
  const { edited: _edited, ...recordMeta } = meta.data

  return {
    ...recordMeta,
    sourceText,
    aiTranslation,
    userTranslation,
    notes: sections['Notes'] ?? '',
  }
}
