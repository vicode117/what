import { z } from 'zod'

export const EXERCISE_TYPES = ['reverse-translation', 'cloze'] as const
export type ExerciseType = (typeof EXERCISE_TYPES)[number]

export const DIFFICULTIES = ['easy', 'normal', 'hard'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

export const REVIEW_RESULTS = ['correct', 'partiallyCorrect', 'incorrect'] as const
export type ReviewResultValue = (typeof REVIEW_RESULTS)[number]

/**
 * A training exercise. Every exercise MUST reference the translation
 * record(s) it was derived from — source-less exercises are forbidden.
 */
export const ExerciseSchema = z.object({
  exerciseId: z.string().min(1),
  type: z.enum(EXERCISE_TYPES),
  instruction: z.string().min(1),
  prompt: z.string().min(1),
  referenceAnswer: z.string().min(1),
  explanation: z.string().default(''),
  difficulty: z.enum(DIFFICULTIES),
  sourceTranslationIds: z.array(z.string().min(1)).min(1),
  learningPointId: z.string().nullable().default(null),
})

export type Exercise = z.infer<typeof ExerciseSchema>

export const ReviewOutcomeSchema = z.object({
  result: z.enum(REVIEW_RESULTS),
  feedback: z.string().default(''),
  importantDifferences: z.array(z.string()).default([]),
  feedbackSource: z.enum(['heuristic', 'ai']).default('heuristic'),
})

export type ReviewOutcome = z.infer<typeof ReviewOutcomeSchema>

export const TrainingSessionSchema = z.object({
  sessionId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  createdAt: z.string(),
  exercises: z.array(ExerciseSchema),
  results: z
    .record(z.string(), z.object({ result: z.enum(REVIEW_RESULTS), at: z.string() }))
    .default({}),
})

export type TrainingSession = z.infer<typeof TrainingSessionSchema>

export const SubmitAnswerSchema = z.object({
  sessionId: z.string().min(1).max(100),
  exerciseId: z.string().min(1).max(200),
  answer: z.string().min(1).max(10000),
  durationMs: z.number().int().min(0).max(3_600_000).default(0),
})

export type SubmitAnswer = z.infer<typeof SubmitAnswerSchema>

export const SubmitResultSchema = z.object({
  exerciseId: z.string().min(1),
  result: z.enum(REVIEW_RESULTS),
  feedback: z.string(),
  importantDifferences: z.array(z.string()),
  referenceAnswer: z.string(),
  explanation: z.string(),
  feedbackSource: z.enum(['heuristic', 'ai']),
})

export type SubmitResult = z.infer<typeof SubmitResultSchema>

/** Structured AI evaluation of a free-text answer. */
export const AiEvaluationSchema = z.object({
  verdict: z.enum(REVIEW_RESULTS),
  feedback: z.string().max(2000).default(''),
  importantDifferences: z.array(z.string().max(500)).max(5).default([]),
})
