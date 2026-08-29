import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { AUTO_DETECT, LANGUAGES, TRANSLATION_MODES } from '@tt/contracts'
import type { LanguageCode, SourceLanguage, TranslateResult, TranslationMode } from '@tt/contracts'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Label } from '../../components/ui/label'
import { Select } from '../../components/ui/select'
import { Textarea } from '../../components/ui/textarea'
import { api, describeError, isCancelled } from '../../lib/api'
import { useCopy } from '../../hooks/use-copy'
import { readRecentPair, rememberPair } from './recent-pair'

const MODE_LABELS: Record<TranslationMode, string> = {
  natural: 'Natural',
  literal: 'Literal',
  professional: 'Professional',
  concise: 'Concise',
}

function createRequestId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid ?? `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function TranslatePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const retranslateId = searchParams.get('retranslate')

  const [sourceText, setSourceText] = useState('')
  const [sourceLanguage, setSourceLanguage] = useState<SourceLanguage>(AUTO_DETECT)
  const [targetLanguage, setTargetLanguage] = useState<LanguageCode>('zh-CN')
  const [mode, setMode] = useState<TranslationMode>('natural')
  const [result, setResult] = useState<TranslateResult | null>(null)
  const [finalText, setFinalText] = useState('')
  const [edited, setEdited] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)

  const { copied, copy } = useCopy()
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: api.settings.get })
  const autoSave = settingsQuery.data?.translation.autoSave ?? true

  // One-time initialization: remembered pair first, then configured defaults.
  const initialRef = useRef(false)
  useEffect(() => {
    if (initialRef.current) return
    const recent = readRecentPair()
    if (recent) {
      setSourceLanguage(recent.sourceLanguage)
      setTargetLanguage(recent.targetLanguage)
      setMode(recent.mode)
      initialRef.current = true
      return
    }
    const settings = settingsQuery.data
    if (settings) {
      setSourceLanguage(settings.translation.sourceLanguage)
      setTargetLanguage(settings.translation.targetLanguage)
      setMode(settings.translation.mode)
      initialRef.current = true
    }
  }, [settingsQuery.data])

  // Re-translate: prefill from a saved record (user asked for it explicitly).
  useEffect(() => {
    if (!retranslateId) return
    void api.history.get({ id: retranslateId }).then((record) => {
      if (record) {
        setSourceText(record.sourceText)
        setSourceLanguage(record.sourceLanguage)
        setTargetLanguage(record.targetLanguage)
        setMode(record.mode)
      }
      setSearchParams({}, { replace: true })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retranslateId])

  const streamMutation = useMutation({
    mutationFn: async () => {
      const id = createRequestId()
      setRequestId(id)
      setResult(null)
      setFinalText('')
      setEdited(false)
      setSavedId(null)
      lastSyncedRef.current = null
      const text = sourceText
      const result = await api.translation.translateStream(
        { text, sourceLanguage, targetLanguage, mode, requestId: id },
        (delta) => setFinalText((prev) => prev + delta),
      )
      return { result, text }
    },
    onSuccess: ({ result, text }) => {
      setResult(result)
      setFinalText(result.translatedText)
      setEdited(false)
      rememberPair({ sourceLanguage, targetLanguage, mode })
      if (autoSave) autoSaveMutation.mutate({ result, sourceText: text })
    },
  })

  const autoSaveMutation = useMutation({
    mutationFn: async (input: { result: TranslateResult; sourceText: string }) => ({
      saved: await api.translation.save({
        sourceText: input.sourceText,
        aiTranslation: input.result.translatedText,
        sourceLanguage,
        targetLanguage,
        mode,
        provider: input.result.provider,
        model: input.result.model,
      }),
      aiText: input.result.translatedText,
    }),
    onSuccess: ({ saved, aiText }) => {
      setSavedId(saved.id)
      lastSyncedRef.current = aiText.trim()
      void queryClient.invalidateQueries({ queryKey: ['history'] })
    },
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      api.translation.save({
        sourceText,
        aiTranslation: result!.translatedText,
        userTranslation: edited && finalText !== result!.translatedText ? finalText : undefined,
        sourceLanguage,
        targetLanguage,
        mode,
        provider: result!.provider,
        model: result!.model,
      }),
    onSuccess: (saved) => {
      void navigate(`/record/${saved.id}`)
    },
  })

  // Auto-save is on: sync edits to the already-saved record as the user
  // refines the translation (the AI original is never overwritten).
  const lastSyncedRef = useRef<string | null>(null)
  const streamPending = streamMutation.isPending
  useEffect(() => {
    if (!autoSave || !savedId || !result || streamPending) return
    const timer = setTimeout(() => {
      const trimmed = finalText.trim()
      if (trimmed === lastSyncedRef.current) return
      lastSyncedRef.current = trimmed
      const unchanged = trimmed.length === 0 || trimmed === result.translatedText.trim()
      void api.history
        .update({ id: savedId, userTranslation: unchanged ? null : finalText })
        .then(() => queryClient.invalidateQueries({ queryKey: ['history'] }))
        .catch(() => undefined)
    }, 800)
    return () => clearTimeout(timer)
  }, [autoSave, savedId, result, finalText, streamPending, queryClient])

  const canTranslate = sourceText.trim().length > 0 && !streamPending
  const hasApiKey = settingsQuery.data?.hasApiKey ?? true

  function handleTranslate(): void {
    if (!canTranslate) return
    streamMutation.mutate()
  }

  function handleSourceKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      handleTranslate()
    }
  }

  function handleSave(): void {
    if (!result || saveMutation.isPending) return
    saveMutation.mutate()
  }

  function handleCancel(): void {
    if (requestId) api.translation.cancelTranslate(requestId)
  }

  const error = streamMutation.error ?? saveMutation.error ?? autoSaveMutation.error
  const cancelled = streamMutation.error !== null && isCancelled(streamMutation.error) && !streamPending
  const showResultCard = result !== null || streamPending

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      {!hasApiKey && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No API key configured. Set one in <a className="underline" href="#/settings">Settings</a> before
          translating.
        </div>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <CardTitle>Source</CardTitle>
          <div className="flex items-center gap-2">
            <Label htmlFor="source-language" className="sr-only">
              Source language
            </Label>
            <Select
              id="source-language"
              className="w-44"
              value={sourceLanguage}
              disabled={streamPending}
              onChange={(event) => setSourceLanguage(event.target.value as SourceLanguage)}
            >
              <option value={AUTO_DETECT}>Auto Detect</option>
              {LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label}
                </option>
              ))}
            </Select>
            <span aria-hidden="true" className="text-muted-foreground">
              →
            </span>
            <Label htmlFor="target-language" className="sr-only">
              Target language
            </Label>
            <Select
              id="target-language"
              className="w-44"
              value={targetLanguage}
              disabled={streamPending}
              onChange={(event) => setTargetLanguage(event.target.value as LanguageCode)}
            >
              {LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label}
                </option>
              ))}
            </Select>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Textarea
            aria-label="Source text"
            placeholder="Enter text to translate…"
            value={sourceText}
            disabled={streamPending}
            onChange={(event) => setSourceText(event.target.value)}
            onKeyDown={handleSourceKeyDown}
            className="min-h-32"
            autoFocus
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="mode">Mode</Label>
              <Select
                id="mode"
                className="w-40"
                value={mode}
                disabled={streamPending}
                onChange={(event) => setMode(event.target.value as TranslationMode)}
              >
                {TRANSLATION_MODES.map((translationMode) => (
                  <option key={translationMode} value={translationMode}>
                    {MODE_LABELS[translationMode]}
                  </option>
                ))}
              </Select>
            </div>
            {streamPending ? (
              <Button variant="outline" onClick={handleCancel}>
                Stop
              </Button>
            ) : (
              <Button onClick={handleTranslate} disabled={!canTranslate}>
                Translate
              </Button>
            )}
          </div>
          <p className="text-muted-foreground text-xs">Ctrl+Enter to translate.</p>
        </CardContent>
      </Card>

      {error && !cancelled && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {describeError(error)}
        </div>
      )}
      {cancelled && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Cancelled — the partial text is kept on screen but was not saved.
        </div>
      )}
      {autoSaveMutation.error && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Auto-save failed: {describeError(autoSaveMutation.error)}
        </div>
      )}

      {showResultCard && (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2">
            <CardTitle>Translation</CardTitle>
            <div className="flex items-center gap-2">
              {streamPending && <Badge variant="secondary">streaming…</Badge>}
              {edited && <Badge variant="secondary">edited</Badge>}
              {result && (
                <span className="text-muted-foreground text-xs">
                  {result.model} · {result.durationMs} ms
                  {result.usage ? ` · ${result.usage.totalTokens} tokens` : ''}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Textarea
              aria-label="Translation result (editable)"
              value={finalText}
              readOnly={streamPending}
              onChange={(event) => {
                if (!result) return
                setFinalText(event.target.value)
                setEdited(event.target.value !== result.translatedText)
              }}
              className="min-h-28"
            />
            <div className="flex flex-wrap items-center gap-2">
              {!autoSave && result && (
                <Button onClick={handleSave} disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? 'Saving…' : 'Save'}
                </Button>
              )}
              <Button variant="outline" onClick={() => void copy(finalText)} disabled={finalText.length === 0}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
              {edited && result && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setFinalText(result.translatedText)
                    setEdited(false)
                  }}
                >
                  Reset to AI translation
                </Button>
              )}
              {autoSave && autoSaveMutation.isPending && (
                <span className="text-muted-foreground text-sm">Saving…</span>
              )}
              {autoSave && savedId && (
                <span className="text-muted-foreground text-sm">
                  Saved ·{' '}
                  <Link to={`/record/${savedId}`} className="underline">
                    {savedId}
                  </Link>
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
