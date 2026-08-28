import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { isUserEdited, languageLabel } from '@tt/contracts'
import { Badge } from '../../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { api, describeError } from '../../lib/api'

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

export function RecordPage() {
  const { id } = useParams<{ id: string }>()
  const recordQuery = useQuery({
    queryKey: ['record', id],
    queryFn: () => api.history.get({ id: id ?? '' }),
    enabled: Boolean(id),
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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{record.id}</h1>
        <Link to="/" className="text-muted-foreground text-sm hover:underline">
          ← Back
        </Link>
      </div>

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

      {record.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {record.tags.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
        </div>
      )}

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
          <p className="whitespace-pre-wrap text-sm">{edited ? record.userTranslation : record.aiTranslation}</p>
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
