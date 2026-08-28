import { z } from 'zod'
import { LanguageCodeSchema, SourceLanguageSchema, TranslationRecordSchema } from './translation'

export const StoredTranslationRecordSchema = TranslationRecordSchema.extend({
  filePath: z.string().min(1),
})

export type StoredTranslationRecord = z.infer<typeof StoredTranslationRecordSchema>

export const IdRequestSchema = z.object({
  id: z.string().min(1).max(200),
})

export type IdRequest = z.infer<typeof IdRequestSchema>

export const HistoryQuerySchema = z.object({
  text: z.string().max(200).optional(),
  sourceLanguage: SourceLanguageSchema.optional(),
  targetLanguage: LanguageCodeSchema.optional(),
  tag: z.string().max(64).optional(),
  /** Inclusive local date, `YYYY-MM-DD`. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Inclusive local date, `YYYY-MM-DD`. */
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  includeDeleted: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
})

export type HistoryQuery = z.infer<typeof HistoryQuerySchema>

export const HistoryPageSchema = z.object({
  items: z.array(StoredTranslationRecordSchema),
  total: z.number().int().min(0),
})

export type HistoryPage = z.infer<typeof HistoryPageSchema>

export const HistoryUpdateSchema = z.object({
  id: z.string().min(1).max(200),
  tags: z.array(z.string().min(1).max(64)).max(20).optional(),
  notes: z.string().max(20000).optional(),
})

export type HistoryUpdate = z.infer<typeof HistoryUpdateSchema>
