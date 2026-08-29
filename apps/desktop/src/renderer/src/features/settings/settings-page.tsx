import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AUTO_DETECT, LANGUAGES, TRANSLATION_MODES } from '@tt/contracts'
import type { LanguageCode, ProviderProfile, SourceLanguage, TranslationMode } from '@tt/contracts'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
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

type ProviderDraft = {
  id: string
  label: string
  baseUrl: string
  model: string
  timeoutMs: string
  temperature: string
  maxRetries: string
  apiKeyDraft: string
  hasKey: boolean
}

function toDraft(profile: ProviderProfile, hasKey: boolean): ProviderDraft {
  return {
    id: profile.id,
    label: profile.label,
    baseUrl: profile.baseUrl,
    model: profile.model,
    timeoutMs: String(profile.timeoutMs),
    temperature: String(profile.temperature),
    maxRetries: String(profile.maxRetries),
    apiKeyDraft: '',
    hasKey,
  }
}

function newProviderDraft(index: number): ProviderDraft {
  return {
    id: `prov_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`,
    label: `Provider ${index + 1}`,
    baseUrl: 'https://api.openai.com/v1',
    model: '',
    timeoutMs: '60000',
    temperature: '0.3',
    maxRetries: '2',
    apiKeyDraft: '',
    hasKey: false,
  }
}

export function SettingsPage() {
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: api.settings.get })

  const [providers, setProviders] = useState<ProviderDraft[] | null>(null)
  const [sourceLanguage, setSourceLanguage] = useState<SourceLanguage>(AUTO_DETECT)
  const [targetLanguage, setTargetLanguage] = useState<LanguageCode>('zh-CN')
  const [mode, setMode] = useState<TranslationMode>('natural')
  const [autoSave, setAutoSave] = useState(true)
  const [dailySessionSize, setDailySessionSize] = useState('12')
  const [saved, setSaved] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Seed local form state once settings have loaded.
  const seededRef = useRef(false)
  useEffect(() => {
    const settings = settingsQuery.data
    if (!settings || seededRef.current) return
    seededRef.current = true
    setProviders(settings.providers.map((profile) => toDraft(profile, settings.hasApiKeys[profile.id] === true)))
    setSourceLanguage(settings.translation.sourceLanguage)
    setTargetLanguage(settings.translation.targetLanguage)
    setMode(settings.translation.mode)
    setAutoSave(settings.translation.autoSave)
    setDailySessionSize(String(settings.training.dailySessionSize))
  }, [settingsQuery.data])

  const saveMutation = useMutation({
    mutationFn: (drafts: ProviderDraft[]) => {
      const sessionSize = Number(dailySessionSize)
      if (!Number.isFinite(sessionSize)) throw new Error('Daily session size must be a number.')
      const profiles: ProviderProfile[] = drafts.map((draft, index) => {
        const timeoutMs = Number(draft.timeoutMs)
        const temperature = Number(draft.temperature)
        const maxRetries = Number(draft.maxRetries)
        if (!draft.label.trim()) throw new Error(`Provider ${index + 1}: label is required.`)
        if (!Number.isFinite(timeoutMs) || !Number.isFinite(temperature) || !Number.isFinite(maxRetries)) {
          throw new Error(`Provider "${draft.label}": timeout, temperature and retries must be numbers.`)
        }
        if (!draft.baseUrl.trim() || !draft.model.trim()) {
          throw new Error(`Provider "${draft.label}": base URL and model are required.`)
        }
        return {
          id: draft.id,
          label: draft.label.trim(),
          baseUrl: draft.baseUrl.trim(),
          model: draft.model.trim(),
          timeoutMs: Math.round(timeoutMs),
          temperature,
          maxRetries: Math.round(maxRetries),
        }
      })
      return api.settings.update({
        providers: profiles,
        providerKeys: drafts
          .filter((draft) => draft.apiKeyDraft.trim().length > 0)
          .map((draft) => ({ providerId: draft.id, apiKey: draft.apiKeyDraft.trim() })),
        translation: { sourceLanguage, targetLanguage, mode, autoSave },
        training: { dailySessionSize: Math.round(sessionSize) },
      })
    },
    onSuccess: () => {
      setSaved(true)
      setProviders((current) =>
        current ? current.map((draft) => ({ ...draft, apiKeyDraft: '', hasKey: draft.hasKey || draft.apiKeyDraft.trim().length > 0 })) : current,
      )
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

  if (settingsQuery.isPending || !settings || providers === null) {
    return <div className="text-muted-foreground p-6 text-sm">Loading…</div>
  }

  if (settingsQuery.error) {
    return (
      <div role="alert" className="p-6 text-sm text-destructive">
        {describeError(settingsQuery.error)}
      </div>
    )
  }

  function updateProvider(id: string, patch: Partial<ProviderDraft>): void {
    setProviders((current) =>
      current ? current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)) : current,
    )
  }

  function reorder(from: number, to: number): void {
    setProviders((current) => {
      if (!current || from === to) return current
      const next = [...current]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved!)
      return next
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>AI Providers (OpenAI-compatible)</CardTitle>
          <CardDescription>
            Tried in order — drag ⋮⋮ to change priority; if one fails (timeout, rate limit, bad
            key…), the next is used automatically. Keys are stored encrypted in the app&apos;s
            private data directory and never leave the Main process.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {(providers ?? []).map((draft, index) => (
            <ProviderRow
              key={draft.id}
              draft={draft}
              index={index}
              total={providers.length}
              expanded={expandedId === draft.id}
              onToggle={() => setExpandedId(expandedId === draft.id ? null : draft.id)}
              onChange={(patch) => updateProvider(draft.id, patch)}
              onDragTo={(to) => reorder(index, to)}
              onDelete={() =>
                setProviders((current) => (current ? current.filter((p) => p.id !== draft.id) : current))
              }
            />
          ))}
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const draft = newProviderDraft((providers ?? []).length)
                setProviders((current) => [...(current ?? []), draft])
                setExpandedId(draft.id)
              }}
            >
              + Add provider
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Translation Defaults</CardTitle>
          <CardDescription>Used to preselect languages and mode on the Translate page.</CardDescription>
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
          <div className="grid grid-cols-3 gap-3">
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
        <Button
          onClick={() => providers && saveMutation.mutate(providers)}
          disabled={saveMutation.isPending || providers.length === 0}
        >
          {saveMutation.isPending ? 'Saving…' : 'Save Settings'}
        </Button>
        {saved && <span className="text-sm text-emerald-600">Saved</span>}
      </div>
    </div>
  )
}

function ProviderRow({
  draft,
  index,
  total,
  expanded,
  onToggle,
  onChange,
  onDragTo,
  onDelete,
}: {
  draft: ProviderDraft
  index: number
  total: number
  expanded: boolean
  onToggle: () => void
  onChange: (patch: Partial<ProviderDraft>) => void
  onDragTo: (to: number) => void
  onDelete: () => void
}) {
  const dragIndexRef = useRef<number | null>(null)

  if (!expanded) {
    return (
      <div
        draggable
        onDragStart={() => {
          dragIndexRef.current = index
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          const from = dragIndexRef.current
          if (from !== null) onDragTo(from)
          dragIndexRef.current = null
        }}
        className="flex cursor-grab items-center justify-between gap-2 rounded-lg border p-3"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="text-muted-foreground select-none">
            ⋮⋮
          </span>
          <Badge variant="secondary">#{index + 1}</Badge>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{draft.label}</p>
            <p className="text-muted-foreground truncate text-xs">
              {draft.model || 'no model'} · {draft.baseUrl}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {draft.hasKey || draft.apiKeyDraft.length > 0 ? (
            <Badge variant="secondary">key ✓</Badge>
          ) : (
            <Badge variant="destructive">no key</Badge>
          )}
          <Button variant="ghost" size="sm" onClick={onToggle}>
            Edit
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <Badge variant="secondary">#{index + 1} of {total}</Badge>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onToggle}>
            Collapse
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Label</Label>
          <Input value={draft.label} onChange={(event) => onChange({ label: event.target.value })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Model</Label>
          <Input value={draft.model} onChange={(event) => onChange({ model: event.target.value })} />
        </div>
        <div className="col-span-2 flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Base URL</Label>
          <Input value={draft.baseUrl} onChange={(event) => onChange({ baseUrl: event.target.value })} />
        </div>
        <div className="col-span-2 flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">
            API Key {draft.hasKey ? '(stored — leave blank to keep)' : ''}
          </Label>
          <Input
            type="password"
            value={draft.apiKeyDraft}
            autoComplete="off"
            placeholder={draft.hasKey ? '•••• stored' : 'Paste your API key'}
            onChange={(event) => onChange({ apiKeyDraft: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Timeout (ms)</Label>
          <Input
            type="number"
            min={1000}
            max={300000}
            value={draft.timeoutMs}
            onChange={(event) => onChange({ timeoutMs: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Temperature</Label>
          <Input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={draft.temperature}
            onChange={(event) => onChange({ temperature: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Max retries</Label>
          <Input
            type="number"
            min={0}
            max={10}
            value={draft.maxRetries}
            onChange={(event) => onChange({ maxRetries: event.target.value })}
          />
        </div>
      </div>
    </div>
  )
}
