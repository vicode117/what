import { z } from 'zod'
import { AUTO_DETECT, LANGUAGE_CODES } from './languages'

export const LanguageCodeSchema = z.enum(LANGUAGE_CODES)
export const SourceLanguageSchema = z.union([LanguageCodeSchema, z.literal(AUTO_DETECT)])

/** Translation intent. Modes primarily affect which prompt is used. */
export const TRANSLATION_MODES = ['natural', 'literal', 'professional', 'concise'] as const
export type TranslationMode = (typeof TRANSLATION_MODES)[number]
export const TranslationModeSchema = z.enum(TRANSLATION_MODES)

/**
 * A saved translation record, as persisted in the Vault markdown file.
 *
 * `aiTranslation` always keeps the original AI output.
 * `userTranslation` is set only when the user changed it; the difference
 * between the two is valuable training data and must never be lost.
 */
export const TranslationRecordSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  sourceLanguage: SourceLanguageSchema,
  targetLanguage: LanguageCodeSchema,
  mode: TranslationModeSchema,
  provider: z.string().min(1),
  model: z.string().min(1),
  tags: z.array(z.string()).default([]),
  notes: z.string().default(''),
  sourceText: z.string().min(1),
  aiTranslation: z.string().min(1),
  userTranslation: z.string().min(1).nullable().default(null),
})

export type TranslationRecord = z.infer<typeof TranslationRecordSchema>

/** Record plus the on-disk path it was loaded from. */
export type StoredTranslationRecord = TranslationRecord & { filePath: string }

/** The translation the user actually ended up with (final text). */
export function finalTranslation(record: Pick<TranslationRecord, 'aiTranslation' | 'userTranslation'>): string {
  return record.userTranslation ?? record.aiTranslation
}

export function isUserEdited(record: Pick<TranslationRecord, 'aiTranslation' | 'userTranslation'>): boolean {
  return record.userTranslation !== null && record.userTranslation !== record.aiTranslation
}
