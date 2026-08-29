import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AUTO_DETECT, LANGUAGES, TRANSLATION_MODES } from '@tt/contracts'
import type { LanguageCode, SourceLanguage, TranslationMode } from '@tt/contracts'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Select } from '../../components/ui/select'
import { api, describeError } from '../../lib/api'

const MODE_LABELS: Record<TranslationMode, string> = {
  natural: 'Natural',
  literal: 'Literal',
  professional: 'Professional',
  concise: 'Concise',
}

type ProviderForm = {
  baseUrl: string
  model: string
  timeoutMs: string
  temperature: string
  maxRetries: string
  apiKey: string
}

export function SettingsPage() {
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: api.settings.get })

  const [provider, setProvider] = useState<ProviderForm | null>(null)
  const [sourceLanguage, setSourceLanguage] = useState<SourceLanguage>(AUTO_DETECT)
  const [targetLanguage, setTargetLanguage] = useState<LanguageCode>('zh-CN')
  const [mode, setMode] = useState<TranslationMode>('natural')
  const [autoSave, setAutoSave] = useState(true)
  const [dailySessionSize, setDailySessionSize] = useState('12')
  const [saved, setSaved] = useState(false)

  // Seed local form state once settings have loaded.
  const seededRef = useRef(false)
  useEffect(() => {
    const settings = settingsQuery.data
    if (!settings || seededRef.current) return
    seededRef.current = true
    setProvider({
      baseUrl: settings.provider.baseUrl,
      model: settings.provider.model,
      timeoutMs: String(settings.provider.timeoutMs),
      temperature: String(settings.provider.temperature),
      maxRetries: String(settings.provider.maxRetries),
      apiKey: '',
    })
    setSourceLanguage(settings.translation.sourceLanguage)
    setTargetLanguage(settings.translation.targetLanguage)
    setMode(settings.translation.mode)
    setAutoSave(settings.translation.autoSave)
    setDailySessionSize(String(settings.training.dailySessionSize))
  }, [settingsQuery.data])

  const saveMutation = useMutation({
    mutationFn: (form: ProviderForm) => {
      const timeoutMs = Number(form.timeoutMs)
      const temperature = Number(form.temperature)
      const maxRetries = Number(form.maxRetries)
      if (!Number.isFinite(timeoutMs) || !Number.isFinite(temperature) || !Number.isFinite(maxRetries)) {
        throw new Error('Timeout, temperature and retries must be numbers.')
      }
      const sessionSize = Number(dailySessionSize)
      if (!Number.isFinite(sessionSize)) {
        throw new Error('Daily session size must be a number.')
      }
      return api.settings.update({
        provider: {
          baseUrl: form.baseUrl,
          model: form.model,
          timeoutMs,
          temperature,
          maxRetries,
        },
        apiKey: form.apiKey.length > 0 ? form.apiKey : undefined,
        translation: { sourceLanguage, targetLanguage, mode, autoSave },
        training: { dailySessionSize: Math.round(sessionSize) },
      })
    },
    onSuccess: () => {
      setSaved(true)
      setProvider((current) => (current ? { ...current, apiKey: '' } : current))
      void queryClient.invalidateQueries({ queryKey: ['settings'] })
      setTimeout(() => setSaved(false), 2000)
    },
  })

  const chooseVaultMutation = useMutation({
    mutationFn: api.settings.chooseVault,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  })

  const rebuildIndexMutation = useMutation({
    mutationFn: api.maintenance.rebuildIndex,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['history'] }),
  })

  const settings = settingsQuery.data

  if (settingsQuery.isPending || !settings || !provider) {
    return <div className="text-muted-foreground p-6 text-sm">Loading…</div>
  }

  if (settingsQuery.error) {
    return (
      <div role="alert" className="p-6 text-sm text-destructive">
        {describeError(settingsQuery.error)}
      </div>
    )
  }

  const updateProvider = (patch: Partial<ProviderForm>) =>
    setProvider((current) => (current ? { ...current, ...patch } : current))

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>AI Provider (OpenAI-compatible)</CardTitle>
          <CardDescription>
            Works with OpenAI-compatible cloud APIs and local servers (e.g. Ollama, LM Studio, vLLM).
            The API key is stored encrypted in the app&apos;s private data directory and never leaves the
            Main process.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoSave}
              onChange={(event) => setAutoSave(event.target.checked)}
            />
            Auto-save every successful translation to the Vault (edits update the saved record)
          </label>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="base-url">Base URL</Label>
            <Input
              id="base-url"
              value={provider.baseUrl}
              onChange={(event) => updateProvider({ baseUrl: event.target.value })}
              placeholder="https://api.openai.com/v1"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="model">Model</Label>
            <Input
              id="model"
              value={provider.model}
              onChange={(event) => updateProvider({ model: event.target.value })}
              placeholder="model name"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="api-key">API Key</Label>
            <Input
              id="api-key"
              type="password"
              value={provider.apiKey}
              onChange={(event) => updateProvider({ apiKey: event.target.value })}
              placeholder={settings.hasApiKey ? 'Stored — leave blank to keep' : 'Paste your API key'}
              autoComplete="off"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="timeout">Timeout (ms)</Label>
              <Input
                id="timeout"
                type="number"
                min={1000}
                max={300000}
                value={provider.timeoutMs}
                onChange={(event) => updateProvider({ timeoutMs: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="temperature">Temperature</Label>
              <Input
                id="temperature"
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={provider.temperature}
                onChange={(event) => updateProvider({ temperature: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="retries">Max retries</Label>
              <Input
                id="retries"
                type="number"
                min={0}
                max={10}
                value={provider.maxRetries}
                onChange={(event) => updateProvider({ maxRetries: event.target.value })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Translation Defaults</CardTitle>
          <CardDescription>Used to preselect languages and mode on the Translate page.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="default-source">Source language</Label>
            <Select
              id="default-source"
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
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="default-target">Target language</Label>
            <Select
              id="default-target"
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="default-mode">Mode</Label>
            <Select id="default-mode" value={mode} onChange={(event) => setMode(event.target.value as TranslationMode)}>
              {TRANSLATION_MODES.map((translationMode) => (
                <option key={translationMode} value={translationMode}>
                  {MODE_LABELS[translationMode]}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vault</CardTitle>
          <CardDescription>
            All translations are saved as Markdown files in this folder. It can live in OneDrive, iCloud
            Drive, Dropbox, a git repository, or any local folder.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="font-mono text-xs break-all">{settings.vaultPath}</p>
          <div>
            <Button
              variant="outline"
              onClick={() => chooseVaultMutation.mutate()}
              disabled={chooseVaultMutation.isPending}
            >
              {chooseVaultMutation.isPending ? 'Opening…' : 'Change folder…'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Training</CardTitle>
          <CardDescription>Daily sessions mix due reviews, weak items, and new material.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          <Label htmlFor="session-size">Exercises per day (6–30)</Label>
          <Input
            id="session-size"
            type="number"
            min={6}
            max={30}
            className="w-32"
            value={dailySessionSize}
            onChange={(event) => setDailySessionSize(event.target.value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Maintenance</CardTitle>
          <CardDescription>
            The search index under <code>.app/</code> is derived data — rebuilding it never touches
            your Markdown files.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => rebuildIndexMutation.mutate()}
            disabled={rebuildIndexMutation.isPending}
          >
            {rebuildIndexMutation.isPending ? 'Rebuilding…' : 'Rebuild search index'}
          </Button>
          {rebuildIndexMutation.data && (
            <span className="text-muted-foreground text-sm">{rebuildIndexMutation.data.count} records indexed</span>
          )}
          {rebuildIndexMutation.error && (
            <span className="text-sm text-destructive">{describeError(rebuildIndexMutation.error)}</span>
          )}
        </CardContent>
      </Card>

      {(saveMutation.error || chooseVaultMutation.error) && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {describeError(saveMutation.error ?? chooseVaultMutation.error)}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={() => saveMutation.mutate(provider)} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving…' : 'Save Settings'}
        </Button>
        {saved && <span className="text-sm text-emerald-600">Saved</span>}
      </div>
    </div>
  )
}
