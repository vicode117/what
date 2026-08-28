import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PromptManager } from '../prompts/prompt-manager'
import type { Exercise } from '@tt/contracts'
import { AnswerEvaluator } from './answer-evaluator'

const repoPromptsDir = path.resolve(__dirname, '..', '..', '..', '..', 'prompts')

const cloze: Exercise = {
  exerciseId: 'ex1',
  type: 'cloze',
  instruction: 'Fill in the blank.',
  prompt: 'We need to take ____ into account.',
  referenceAnswer: 'traceability',
  explanation: '',
  difficulty: 'normal',
  sourceTranslationIds: ['tr_1'],
  learningPointId: null,
}

const reverse: Exercise = {
  exerciseId: 'ex2',
  type: 'reverse-translation',
  instruction: 'Translate into English.',
  prompt: '我们需要考虑可追溯性。',
  referenceAnswer: 'We need to take traceability into account.',
  explanation: '',
  difficulty: 'normal',
  sourceTranslationIds: ['tr_1'],
  learningPointId: null,
}

async function evaluatorWith(client: unknown): Promise<AnswerEvaluator> {
  const prompts = new PromptManager([repoPromptsDir])
  await prompts.load()
  return new AnswerEvaluator({
    prompts,
    clientProvider:
      client === null ? async () => null : async () => client as never,
  })
}

describe('AnswerEvaluator', () => {
  it('accepts exact answers regardless of case and punctuation', async () => {
    const evaluator = await evaluatorWith(null)
    const outcome = await evaluator.evaluate(cloze, '  Traceability! ')
    expect(outcome.result).toBe('correct')
  })

  it('grades close cloze answers as partially correct', async () => {
    const evaluator = await evaluatorWith(null)
    const outcome = await evaluator.evaluate(cloze, 'traceabilit')
    expect(outcome.result).toBe('partiallyCorrect')
  })

  it('grades wrong cloze answers as incorrect with the reference', async () => {
    const evaluator = await evaluatorWith(null)
    const outcome = await evaluator.evaluate(cloze, 'completely')
    expect(outcome.result).toBe('incorrect')
    expect(outcome.feedback).toContain('traceability')
  })

  it('uses AI evaluation for free-text answers and trusts its verdict', async () => {
    const generate = vi.fn(async () => ({
      text: JSON.stringify({
        verdict: 'correct',
        feedback: 'Same meaning, different wording.',
        importantDifferences: [],
      }),
      provider: 'openai-compatible',
      model: 'example-model',
    }))
    const evaluator = await evaluatorWith({ provider: 'openai-compatible', generate })

    const outcome = await evaluator.evaluate(reverse, 'Traceability must be considered.')
    expect(outcome.result).toBe('correct')
    expect(outcome.feedbackSource).toBe('ai')
    expect(outcome.feedback).toContain('Same meaning')
  })

  it('falls back to the heuristic verdict when the AI fails', async () => {
    const generate = vi.fn(async () => {
      throw new Error('provider down')
    })
    const evaluator = await evaluatorWith({ provider: 'openai-compatible', generate })

    const outcome = await evaluator.evaluate(reverse, 'The weather is nice today.')
    expect(outcome.result).toBe('incorrect')
    expect(outcome.feedbackSource).toBe('heuristic')
  })

  it('stays heuristic when no API key is configured', async () => {
    const evaluator = await evaluatorWith(null)
    const outcome = await evaluator.evaluate(reverse, 'We need to take traceability into account.')
    expect(outcome.result).toBe('correct')
    expect(outcome.feedbackSource).toBe('heuristic')
  })
})
