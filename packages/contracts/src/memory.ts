import { z } from 'zod'

export const LEARNING_KINDS = ['vocabulary', 'expression', 'grammar'] as const
export type LearningKind = (typeof LEARNING_KINDS)[number]

export const LEARNING_STATUSES = ['active', 'mastered', 'excluded'] as const
export type LearningStatus = (typeof LEARNING_STATUSES)[number]

/**
 * A reusable learning item extracted from translation history.
 * Every point keeps provenance via `sourceTranslationIds`; repeated
 * occurrences accumulate in `occurrenceDates` instead of duplicating.
 */
export const LearningPointSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(LEARNING_KINDS),
  term: z.string().min(1),
  meaning: z.string().default(''),
  explanation: z.string().default(''),
  status: z.enum(LEARNING_STATUSES).default('active'),
  sourceTranslationIds: z.array(z.string()).default([]),
  occurrenceDates: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastReviewedAt: z.string().nullable().default(null),
  nextReviewAt: z.string().nullable().default(null),
  successCount: z.number().int().min(0).default(0),
  failureCount: z.number().int().min(0).default(0),
  streak: z.number().int().min(0).default(0),
  notes: z.string().default(''),
})

export type LearningPoint = z.infer<typeof LearningPointSchema>

export const MemoryQuerySchema = z.object({
  text: z.string().max(200).optional(),
  kind: z.enum(LEARNING_KINDS).optional(),
  status: z.enum(LEARNING_STATUSES).optional(),
  sourceTranslationId: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
})

export type MemoryQuery = z.infer<typeof MemoryQuerySchema>

export const MemoryUpdateSchema = z.object({
  id: z.string().min(1).max(200),
  status: z.enum(LEARNING_STATUSES).optional(),
  notes: z.string().max(10000).optional(),
})

export type MemoryUpdate = z.infer<typeof MemoryUpdateSchema>

export const MemoryPageSchema = z.object({
  items: z.array(LearningPointSchema),
  total: z.number().int().min(0),
})

export type MemoryPage = z.infer<typeof MemoryPageSchema>

export const ExtractionCandidateSchema = z.object({
  term: z.string().min(1).max(120),
  meaning: z.string().max(500).default(''),
  explanation: z.string().max(1000).default(''),
})

export const LearningExtractionSchema = z.object({
  difficultWords: z.array(ExtractionCandidateSchema).max(8).default([]),
  expressions: z.array(ExtractionCandidateSchema).max(8).default([]),
  grammarPoints: z
    .array(
      z.object({
        pattern: z.string().min(1).max(200),
        explanation: z.string().max(1000).default(''),
      }),
    )
    .max(6)
    .default([]),
})

export type LearningExtraction = z.infer<typeof LearningExtractionSchema>

export const GlossaryEntrySchema = z.object({
  term: z.string().min(1).max(120),
  translation: z.string().min(1).max(500),
})

export type GlossaryEntry = z.infer<typeof GlossaryEntrySchema>

export const TermRequestSchema = z.object({
  term: z.string().min(1).max(120),
})

export type TermRequest = z.infer<typeof TermRequestSchema>
