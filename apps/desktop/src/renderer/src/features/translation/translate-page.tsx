import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { AUTO_DETECT, LANGUAGES, TRANSLATION_MODES } from '@tt/contracts'
import type { LanguageCode, SourceLanguage, TranslateResult, TranslationMode } from '@tt/contracts'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Label } from '../../components/ui/label'
import { Select } from '../../components/ui/select'
import { Textarea } from '../../components/ui/textarea'
import { api, describeError } from '../../lib/api'
import { useCopy } from '../../hooks/use-copy'
import { readRecentPair, rememberPair } from './recent-pair'

const MODE_LABELS: Record<TranslationMode, string> = {
  natural: 'Natural',
  literal: 'Literal',
  professional: 'Professional',
  concise: 'Concise',
}

export function TranslatePage() {
  const navigate = useNavigate()

  const [sourceText, setSourceText] = useState('')
  const [sourceLanguage, setSourceLanguage] = useState<SourceLanguage>(AUTO_DETECT)
  const [targetLanguage, setTargetLanguage] = useState<LanguageCode>('zh-CN')
  const [mode, setMode] = useState<TranslationMode>('natural')
  const [result, setResult] = useState<TranslateResult | null>(null)
  const [finalText, setFinalText] = useState('')
  const [edited, setEdited] = useState(false)

  const { copied, copy } = useCopy()
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: api.settings.get })

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

  const translateMutation = useMutation({
    mutationFn: () => api.translation.translate({ text: sourceText, sourceLanguage, targetLanguage, mode }),
    onSuccess: (data) => {
      setResult(data)
      setFinalText(data.translatedText)
      setEdited(false)
      rememberPair({ sourceLanguage, targetLanguage, mode })
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

  const canTranslate = sourceText.trim().length > 0 && !translateMutation.isPending
  const hasApiKey = settingsQuery.data?.hasApiKey ?? true

  function handleTranslate(): void {
    if (!canTranslate) return
    translateMutation.mutate()
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

  const error = translateMutation.error ?? saveMutation.error

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
                onChange={(event) => setMode(event.target.value as TranslationMode)}
              >
                {TRANSLATION_MODES.map((translationMode) => (
                  <option key={translationMode} value={translationMode}>
                    {MODE_LABELS[translationMode]}
                  </option>
                ))}
              </Select>
            </div>
            <Button onClick={handleTranslate} disabled={!canTranslate}>
              {translateMutation.isPending ? 'Translating…' : 'Translate'}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">Ctrl+Enter to translate.</p>
        </CardContent>
      </Card>

      {error && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {describeError(error)}
        </div>
      )}

      {result && (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2">
            <CardTitle>Translation</CardTitle>
            <div className="flex items-center gap-2">
              {edited && <Badge variant="secondary">edited</Badge>}
              <span className="text-muted-foreground text-xs">
                {result.model} · {result.durationMs} ms
                {result.usage ? ` · ${result.usage.totalTokens} tokens` : ''}
              </span>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Textarea
              aria-label="Translation result (editable)"
              value={finalText}
              onChange={(event) => {
                setFinalText(event.target.value)
                setEdited(event.target.value !== result.translatedText)
              }}
              className="min-h-28"
            />
            <div className="flex items-center gap-2">
              <Button onClick={handleSave} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="outline" onClick={() => void copy(finalText)}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
              {edited && (
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
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
