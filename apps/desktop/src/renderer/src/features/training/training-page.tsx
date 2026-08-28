import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Exercise, SubmitResult } from '@tt/contracts'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import { api, describeError } from '../../lib/api'

const RESULT_LABELS: Record<string, string> = {
  correct: 'Correct',
  partiallyCorrect: 'Partially correct',
  incorrect: 'Incorrect',
}

export function TrainingPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <DailyTrainingCard />
    </div>
  )
}

function DailyTrainingCard() {
  const queryClient = useQueryClient()
  const sessionQuery = useQuery({ queryKey: ['training'], queryFn: api.training.getToday })

  const [answered, setAnswered] = useState<SubmitResult | null>(null)
  const [answer, setAnswer] = useState('')
  const [startedAt, setStartedAt] = useState<number>(Date.now())

  const submitMutation = useMutation({
    mutationFn: (input: { exercise: Exercise }) =>
      api.training.submit({
        sessionId: sessionQuery.data!.sessionId,
        exerciseId: input.exercise.exerciseId,
        answer,
        durationMs: Math.max(0, Date.now() - startedAt),
      }),
    onSuccess: (result) => {
      setAnswered(result)
      void queryClient.invalidateQueries({ queryKey: ['training'] })
    },
  })

  const session = sessionQuery.data

  const remaining = useMemo(() => {
    if (!session) return [] as Exercise[]
    return session.exercises.filter((exercise) => session.results[exercise.exerciseId] === undefined)
  }, [session])

  const current = answered === null ? (remaining[0] ?? null) : null
  const completedCount = session ? session.exercises.length - remaining.length : 0
  const allDone = session !== undefined && session.exercises.length > 0 && remaining.length === 0 && answered === null

  if (sessionQuery.isPending) {
    return <p className="text-muted-foreground text-sm">Loading…</p>
  }
  if (sessionQuery.error) {
    return (
      <div role="alert" className="text-destructive text-sm">
        {describeError(sessionQuery.error)}
      </div>
    )
  }
  if (!session) return null

  function next(): void {
    setAnswered(null)
    setAnswer('')
    setStartedAt(Date.now())
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Daily Training</CardTitle>
        <Badge variant="secondary">
          {Math.min(completedCount + (answered ? 1 : 0), session.exercises.length)} / {session.exercises.length}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {session.exercises.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No exercises available yet. Translate something, then run “Extract learning points” —
            training is built from your own history.
          </p>
        )}

        {allDone && (
          <div className="flex flex-col gap-2">
            <p className="text-sm">Session complete. Nice work.</p>
            <div className="text-muted-foreground flex gap-4 text-sm">
              <span>{session.exercises.filter((e) => session.results[e.exerciseId]?.result === 'correct').length} correct</span>
              <span>
                {session.exercises.filter((e) => session.results[e.exerciseId]?.result === 'partiallyCorrect').length} partial
              </span>
              <span>
                {session.exercises.filter((e) => session.results[e.exerciseId]?.result === 'incorrect').length} missed
              </span>
            </div>
          </div>
        )}

        {current && !answered && (
          <ExerciseForm
            exercise={current}
            answer={answer}
            onAnswer={setAnswer}
            onSubmit={() => submitMutation.mutate({ exercise: current })}
            submitting={submitMutation.isPending}
          />
        )}

        {answered && (
          <ResultPanel result={answered} hasNext={remaining.length > 0} onNext={next} />
        )}

        {submitMutation.error && (
          <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {describeError(submitMutation.error)}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ExerciseForm({
  exercise,
  answer,
  onAnswer,
  onSubmit,
  submitting,
}: {
  exercise: Exercise
  answer: string
  onAnswer: (value: string) => void
  onSubmit: () => void
  submitting: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{exercise.type === 'cloze' ? 'Cloze' : 'Reverse translation'}</Badge>
        <Badge variant="outline">{exercise.difficulty}</Badge>
      </div>
      <p className="text-muted-foreground text-sm">{exercise.instruction}</p>
      <p className="whitespace-pre-wrap text-base">{exercise.prompt}</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="answer" className="sr-only">
          Your answer
        </Label>
        <Textarea
          id="answer"
          value={answer}
          onChange={(event) => onAnswer(event.target.value)}
          placeholder="Your answer…"
          className="min-h-20"
          autoFocus
        />
      </div>
      <div>
        <Button onClick={onSubmit} disabled={answer.trim().length === 0 || submitting}>
          {submitting ? 'Checking…' : 'Submit'}
        </Button>
      </div>
    </div>
  )
}

function ResultPanel({
  result,
  hasNext,
  onNext,
}: {
  result: SubmitResult
  hasNext: boolean
  onNext: () => void
}) {
  const tone =
    result.result === 'correct'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
      : result.result === 'partiallyCorrect'
        ? 'border-amber-300 bg-amber-50 text-amber-900'
        : 'border-destructive/40 bg-destructive/10 text-destructive'

  return (
    <div className="flex flex-col gap-3">
      <div className={`rounded-md border px-4 py-3 text-sm ${tone}`}>
        <span className="font-semibold">{RESULT_LABELS[result.result]}</span>
        {result.feedback && <span> — {result.feedback}</span>}
      </div>
      <div className="flex flex-col gap-2 text-sm">
        <div>
          <span className="text-muted-foreground block text-xs">Reference answer</span>
          <p className="whitespace-pre-wrap">{result.referenceAnswer}</p>
        </div>
        {result.importantDifferences.length > 0 && (
          <div>
            <span className="text-muted-foreground block text-xs">Differences to note</span>
            <ul className="list-disc pl-5">
              {result.importantDifferences.map((difference, index) => (
                <li key={index}>{difference}</li>
              ))}
            </ul>
          </div>
        )}
        {result.explanation && (
          <div>
            <span className="text-muted-foreground block text-xs">Related learning point</span>
            <p>{result.explanation}</p>
          </div>
        )}
      </div>
      <div>
        <Button onClick={onNext}>{hasNext ? 'Next' : 'Finish'}</Button>
      </div>
    </div>
  )
}
