import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { LEARNING_KINDS, LEARNING_STATUSES } from '@tt/contracts'
import type { GlossaryEntry, LearningPoint, LearningStatus } from '@tt/contracts'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Select } from '../../components/ui/select'
import { api, describeError } from '../../lib/api'
import { useDebouncedValue } from '../../hooks/use-debounced-value'

const KIND_LABELS: Record<string, string> = {
  vocabulary: 'Vocabulary',
  expression: 'Expression',
  grammar: 'Grammar',
}

const STATUS_LABELS: Record<LearningStatus, string> = {
  active: 'Active',
  mastered: 'Mastered',
  excluded: 'Excluded',
}

export function MemoryPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
      <LearningPointsSection />
      <GlossarySection />
    </div>
  )
}

function LearningPointsSection() {
  const queryClient = useQueryClient()
  const [textInput, setTextInput] = useState('')
  const text = useDebouncedValue(textInput)
  const [kind, setKind] = useState('')
  const [status, setStatus] = useState('active')

  const memoryQuery = useQuery({
    queryKey: ['memory', { text, kind, status }],
    queryFn: () =>
      api.memory.list({
        text: text.trim() || undefined,
        kind: kind === '' ? undefined : (kind as 'vocabulary' | 'expression' | 'grammar'),
        status: status === '' ? undefined : (status as LearningStatus),
        limit: 200,
      }),
  })

  const updateMutation = useMutation({
    mutationFn: (input: { id: string; status: LearningStatus }) =>
      api.memory.update({ id: input.id, status: input.status }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['memory'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.memory.delete({ id }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['memory'] }),
  })

  const error = memoryQuery.error ?? updateMutation.error ?? deleteMutation.error

  return (
    <Card>
      <CardHeader>
        <CardTitle>Learning Points</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="memory-search" className="text-xs text-muted-foreground">Search</Label>
            <Input
              id="memory-search"
              className="w-48"
              value={textInput}
              onChange={(event) => setTextInput(event.target.value)}
              placeholder="term or meaning"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="memory-kind" className="text-xs text-muted-foreground">Kind</Label>
            <Select id="memory-kind" className="w-36" value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="">Any</option>
              {LEARNING_KINDS.map((learningKind) => (
                <option key={learningKind} value={learningKind}>
                  {KIND_LABELS[learningKind]}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="memory-status" className="text-xs text-muted-foreground">Status</Label>
            <Select id="memory-status" className="w-32" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Any</option>
              {LEARNING_STATUSES.map((learningStatus) => (
                <option key={learningStatus} value={learningStatus}>
                  {STATUS_LABELS[learningStatus]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {error && (
          <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {describeError(error)}
          </div>
        )}

        {memoryQuery.data && memoryQuery.data.items.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No learning points yet. Save translations and run “Extract learning points” on a record.
          </p>
        )}

        <ul className="flex flex-col gap-3">
          {(memoryQuery.data?.items ?? []).map((point) => (
            <LearningPointRow
              key={point.id}
              point={point}
              onSetStatus={(newStatus) => updateMutation.mutate({ id: point.id, status: newStatus })}
              onDelete={() => deleteMutation.mutate(point.id)}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function LearningPointRow({
  point,
  onSetStatus,
  onDelete,
}: {
  point: LearningPoint
  onSetStatus: (status: LearningStatus) => void
  onDelete: () => void
}) {
  return (
    <li className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{point.term}</span>
          <Badge variant="outline">{KIND_LABELS[point.kind]}</Badge>
          <Badge variant={point.status === 'active' ? 'secondary' : 'outline'}>
            {STATUS_LABELS[point.status]}
          </Badge>
          {point.failureCount > 0 && <Badge variant="destructive">{point.failureCount} misses</Badge>}
        </div>
        <div className="flex items-center gap-1">
          {point.status !== 'active' && (
            <Button variant="ghost" size="sm" onClick={() => onSetStatus('active')}>
              Activate
            </Button>
          )}
          {point.status !== 'mastered' && (
            <Button variant="ghost" size="sm" onClick={() => onSetStatus('mastered')}>
              Master
            </Button>
          )}
          {point.status !== 'excluded' && (
            <Button variant="ghost" size="sm" onClick={() => onSetStatus('excluded')}>
              Exclude
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>
      {point.meaning && <p className="text-muted-foreground mt-1 text-sm">{point.meaning}</p>}
      {point.explanation && <p className="text-muted-foreground text-sm">{point.explanation}</p>}
      <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-3 text-xs">
        <span>
          seen {point.occurrenceDates.length}× · ok {point.successCount} / miss {point.failureCount}
        </span>
        {point.nextReviewAt && <span>review due {new Date(point.nextReviewAt).toLocaleDateString()}</span>}
        <span className="flex items-center gap-1">
          sources:
          {point.sourceTranslationIds.map((sourceId) => (
            <Link key={sourceId} to={`/record/${sourceId}`} className="text-primary font-mono hover:underline">
              {sourceId}
            </Link>
          ))}
        </span>
      </div>
    </li>
  )
}

function GlossarySection() {
  const queryClient = useQueryClient()
  const glossaryQuery = useQuery({ queryKey: ['glossary'], queryFn: api.glossary.list })
  const [term, setTerm] = useState('')
  const [translation, setTranslation] = useState('')

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['glossary'] })

  const addMutation = useMutation({
    mutationFn: () => api.glossary.add({ term, translation }),
    onSuccess: () => {
      setTerm('')
      setTranslation('')
      invalidate()
    },
  })

  const removeMutation = useMutation({
    mutationFn: (entry: GlossaryEntry) => api.glossary.remove({ term: entry.term }),
    onSuccess: invalidate,
  })

  const error = glossaryQuery.error ?? addMutation.error ?? removeMutation.error

  return (
    <Card>
      <CardHeader>
        <CardTitle>Glossary</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          Explicit entries outrank every inferred preference and are injected into translation prompts
          whenever the term appears.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="glossary-term" className="text-xs text-muted-foreground">Term</Label>
            <Input id="glossary-term" className="w-52" value={term} onChange={(event) => setTerm(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="glossary-translation" className="text-xs text-muted-foreground">Translation</Label>
            <Input
              id="glossary-translation"
              className="w-52"
              value={translation}
              onChange={(event) => setTranslation(event.target.value)}
            />
          </div>
          <Button
            onClick={() => addMutation.mutate()}
            disabled={term.trim().length === 0 || translation.trim().length === 0 || addMutation.isPending}
          >
            Add
          </Button>
        </div>

        {error && (
          <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {describeError(error)}
          </div>
        )}

        {glossaryQuery.data && glossaryQuery.data.length === 0 && (
          <p className="text-muted-foreground text-sm">No glossary entries yet.</p>
        )}
        <ul className="flex flex-col gap-1.5">
          {(glossaryQuery.data ?? []).map((entry) => (
            <li key={entry.term} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
              <span>
                <span className="font-medium">{entry.term}</span>
                <span className="text-muted-foreground"> → {entry.translation}</span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => removeMutation.mutate(entry)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
