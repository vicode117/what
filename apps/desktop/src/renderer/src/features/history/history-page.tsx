import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { AUTO_DETECT, LANGUAGES, finalTranslation } from '@tt/contracts'
import type { HistoryQuery, LanguageCode, SourceLanguage, StoredTranslationRecord } from '@tt/contracts'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Select } from '../../components/ui/select'
import { api, describeError } from '../../lib/api'
import { useDebouncedValue } from '../../hooks/use-debounced-value'

const PAGE_SIZE = 30

function snippet(text: string, max = 90): string {
  const firstLine = text.split('\n')[0] ?? ''
  return firstLine.length > max ? `${firstLine.slice(0, max)}…` : firstLine
}

function anySource(value: string): SourceLanguage | undefined {
  return value === '' ? undefined : (value as SourceLanguage)
}

function anyTarget(value: string): LanguageCode | undefined {
  return value === '' ? undefined : (value as LanguageCode)
}

export function HistoryPage() {
  const navigate = useNavigate()

  const [textInput, setTextInput] = useState('')
  const text = useDebouncedValue(textInput)
  const [sourceLanguage, setSourceLanguage] = useState('')
  const [targetLanguage, setTargetLanguage] = useState('')
  const [tag, setTag] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [offset, setOffset] = useState(0)

  const query: HistoryQuery = {
    text: text.trim() || undefined,
    sourceLanguage: anySource(sourceLanguage),
    targetLanguage: anyTarget(targetLanguage),
    tag: tag.trim() || undefined,
    from: from || undefined,
    to: to || undefined,
    includeDeleted,
    limit: PAGE_SIZE,
    offset,
  }

  const historyQuery = useQuery({
    queryKey: ['history', query],
    queryFn: () => api.history.list(query),
    placeholderData: keepPreviousData,
  })

  const page = historyQuery.data
  const hasFilters =
    query.text !== undefined ||
    query.sourceLanguage !== undefined ||
    query.targetLanguage !== undefined ||
    query.tag !== undefined ||
    query.from !== undefined ||
    query.to !== undefined ||
    includeDeleted

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
      <Card>
        <CardContent className="flex flex-col gap-3 pt-0">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="history-search">Search</Label>
            <Input
              id="history-search"
              value={textInput}
              onChange={(event) => {
                setTextInput(event.target.value)
                setOffset(0)
              }}
              placeholder="Search source, translation, corrections, notes, tags…"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="filter-source" className="text-xs text-muted-foreground">Source</Label>
              <Select
                id="filter-source"
                value={sourceLanguage}
                onChange={(event) => {
                  setSourceLanguage(event.target.value)
                  setOffset(0)
                }}
              >
                <option value="">Any</option>
                <option value={AUTO_DETECT}>Auto Detect</option>
                {LANGUAGES.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="filter-target" className="text-xs text-muted-foreground">Target</Label>
              <Select
                id="filter-target"
                value={targetLanguage}
                onChange={(event) => {
                  setTargetLanguage(event.target.value)
                  setOffset(0)
                }}
              >
                <option value="">Any</option>
                {LANGUAGES.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="filter-from" className="text-xs text-muted-foreground">From</Label>
              <Input
                id="filter-from"
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value)
                  setOffset(0)
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="filter-to" className="text-xs text-muted-foreground">To</Label>
              <Input
                id="filter-to"
                type="date"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value)
                  setOffset(0)
                }}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex flex-1 items-center gap-2">
              <Label htmlFor="filter-tag" className="text-xs text-muted-foreground">Tag</Label>
              <Input
                id="filter-tag"
                className="w-40"
                value={tag}
                onChange={(event) => {
                  setTag(event.target.value)
                  setOffset(0)
                }}
                placeholder="software"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={includeDeleted}
                onChange={(event) => {
                  setIncludeDeleted(event.target.checked)
                  setOffset(0)
                }}
              />
              Show deleted
            </label>
          </div>
        </CardContent>
      </Card>

      {historyQuery.error && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {describeError(historyQuery.error)}
        </div>
      )}

      {page && page.items.length === 0 && (
        <p className="text-muted-foreground text-sm">
          {hasFilters ? 'No translations match the current filters.' : 'Nothing saved yet — translate something first.'}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {(page?.items ?? []).map((record) => (
          <HistoryRow key={record.id} record={record} onOpen={() => navigate(`/record/${record.id}`)} />
        ))}
      </ul>

      {page && page.total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm">
          <Button
            variant="outline"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            ← Previous
          </Button>
          <span className="text-muted-foreground">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, page.total)} of {page.total}
          </span>
          <Button
            variant="outline"
            disabled={offset + PAGE_SIZE >= page.total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next →
          </Button>
        </div>
      )}
    </div>
  )
}

function HistoryRow({ record, onOpen }: { record: StoredTranslationRecord; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="bg-card w-full rounded-xl border p-4 text-left shadow-sm transition-colors hover:bg-accent/40"
      >
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{record.id}</span>
          <span>{new Date(record.createdAt).toLocaleString()}</span>
        </div>
        <p className="mt-1 truncate text-sm">{snippet(record.sourceText)}</p>
        <p className="text-muted-foreground mt-0.5 truncate text-sm">
          {snippet(finalTranslation(record))}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">
            {record.sourceLanguage} → {record.targetLanguage}
          </Badge>
          {record.userTranslation !== null && <Badge variant="secondary">corrected</Badge>}
          {record.deletedAt !== null && <Badge variant="destructive">deleted</Badge>}
          {record.tags.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
        </div>
      </button>
    </li>
  )
}
