import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { isUserEdited, languageLabel } from '@tt/contracts'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import { api, describeError } from '../../lib/api'

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

function parseTagsInput(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
}

export function RecordPage() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()

  const recordQuery = useQuery({
    queryKey: ['record', id],
    queryFn: () => api.history.get({ id: id ?? '' }),
    enabled: Boolean(id),
  })

  const [editing, setEditing] = useState(false)
  const [tagsDraft, setTagsDraft] = useState('')
  const [notesDraft, setNotesDraft] = useState('')

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['record', id] })
    void queryClient.invalidateQueries({ queryKey: ['history'] })
  }

  const updateMutation = useMutation({
    mutationFn: () =>
      api.history.update({
        id: id ?? '',
        tags: parseTagsInput(tagsDraft),
        notes: notesDraft,
      }),
    onSuccess: () => {
      setEditing(false)
      invalidate()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.history.delete({ id: id ?? '' }),
    onSuccess: invalidate,
  })

  const restoreMutation = useMutation({
    mutationFn: () => api.history.restore({ id: id ?? '' }),
    onSuccess: invalidate,
  })

  if (recordQuery.isPending) {
    return <div className="text-muted-foreground p-6 text-sm">Loading…</div>
  }

  if (recordQuery.error) {
    return (
      <div role="alert" className="p-6 text-sm text-destructive">
        {describeError(recordQuery.error)}
      </div>
    )
  }

  const record = recordQuery.data
  if (!record) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground text-sm">No saved translation with id “{id}”.</p>
        <Link to="/" className="text-primary text-sm underline-offset-4 hover:underline">
          Back to Translate
        </Link>
      </div>
    )
  }

  const edited = isUserEdited(record)
  const deleted = record.deletedAt !== null

  function startEditing(): void {
    setTagsDraft(record!.tags.join(', '))
    setNotesDraft(record!.notes)
    setEditing(true)
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{record.id}</h1>
        <div className="flex items-center gap-3">
          <Link
            to={`/?retranslate=${record.id}`}
            className="text-muted-foreground text-sm hover:underline"
          >
            Re-translate
          </Link>
          <Link to="/history" className="text-muted-foreground text-sm hover:underline">
            ← History
          </Link>
        </div>
      </div>

      {deleted && (
        <div className="flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>This record is deleted (kept in the vault until you delete the file).</span>
          <Button variant="outline" size="sm" onClick={() => restoreMutation.mutate()}>
            Restore
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        <Meta label="Created" value={formatDateTime(record.createdAt)} />
        <Meta
          label="Languages"
          value={`${languageLabel(record.sourceLanguage)} → ${languageLabel(record.targetLanguage)}`}
        />
        <Meta label="Mode" value={record.mode} />
        <Meta label="Provider" value={record.provider} />
        <Meta label="Model" value={record.model} />
        <Meta label="File" value={record.filePath} mono />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {record.tags.map((tag) => (
          <Badge key={tag} variant="secondary">
            {tag}
          </Badge>
        ))}
        {!editing && (
          <Button variant="ghost" size="sm" onClick={startEditing}>
            Edit tags & notes
          </Button>
        )}
      </div>

      {editing ? (
        <Card>
          <CardHeader>
            <CardTitle>Edit tags & notes</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tags-edit">Tags (comma separated)</Label>
              <Textarea
                id="tags-edit"
                className="min-h-10"
                value={tagsDraft}
                onChange={(event) => setTagsDraft(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="notes-edit">Notes</Label>
              <Textarea
                id="notes-edit"
                className="min-h-24"
                value={notesDraft}
                onChange={(event) => setNotesDraft(event.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              {(updateMutation.error ?? deleteMutation.error ?? restoreMutation.error) && (
                <span className="text-sm text-destructive">
                  {describeError(
                    updateMutation.error ?? deleteMutation.error ?? restoreMutation.error,
                  )}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Source</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm">{record.sourceText}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center gap-2">
          <CardTitle>Translation</CardTitle>
          {edited && <Badge variant="secondary">user final</Badge>}
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm">
            {edited ? record.userTranslation : record.aiTranslation}
          </p>
        </CardContent>
      </Card>

      {edited && (
        <Card>
          <CardHeader>
            <CardTitle className="text-muted-foreground">AI Translation (original)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground whitespace-pre-wrap text-sm">{record.aiTranslation}</p>
          </CardContent>
        </Card>
      )}

      {record.notes.trim().length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{record.notes}</p>
          </CardContent>
        </Card>
      )}

      <LearningPointsCard recordId={record.id} analyzedAt={record.analyzedAt} onAnalyzed={invalidate} />

      {!deleted && (
        <div>
          <Button variant="outline" size="sm" onClick={() => deleteMutation.mutate()}>
            Delete
          </Button>
          <span className="text-muted-foreground ml-3 text-xs">
            Deletes softly — the Markdown file stays in the vault and can be restored.
          </span>
        </div>
      )}
    </div>
  )
}

function Meta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={`truncate ${mono ? 'font-mono text-xs' : ''}`} title={value}>
        {value}
      </span>
    </div>
  )
}

function LearningPointsCard({
  recordId,
  analyzedAt,
  onAnalyzed,
}: {
  recordId: string
  analyzedAt: string | null
  onAnalyzed: () => void
}) {
  const queryClient = useQueryClient()
  const pointsQuery = useQuery({
    queryKey: ['memory', { sourceTranslationId: recordId }],
    queryFn: () => api.memory.list({ sourceTranslationId: recordId, limit: 50 }),
  })

  const analyzeMutation = useMutation({
    mutationFn: () => api.history.analyze({ id: recordId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['memory'] })
      onAnalyzed()
    },
  })
  const points = pointsQuery.data?.items ?? []

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>Learning Points</CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={() => analyzeMutation.mutate()}
          disabled={analyzeMutation.isPending}
        >
          {analyzeMutation.isPending ? 'Analyzing…' : analyzedAt ? 'Re-analyze' : 'Extract learning points'}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {analyzeMutation.error && (
          <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {describeError(analyzeMutation.error)}
          </div>
        )}
        {points.length === 0 && !analyzeMutation.isPending && (
          <p className="text-muted-foreground text-sm">
            {analyzedAt ? 'No learning points were extracted.' : 'Not analyzed yet — extraction uses your configured AI provider.'}
          </p>
        )}
        <ul className="flex flex-col gap-1.5">
          {points.map((point) => (
            <li key={point.id} className="rounded-md border px-3 py-1.5 text-sm">
              <span className="font-medium">{point.term}</span>
              {point.meaning && <span className="text-muted-foreground"> — {point.meaning}</span>}
              {point.explanation && <p className="text-muted-foreground text-xs">{point.explanation}</p>}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
