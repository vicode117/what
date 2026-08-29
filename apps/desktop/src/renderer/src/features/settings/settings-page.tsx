import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AUTO_DETECT, LANGUAGES, TRANSLATION_MODES } from '@tt/contracts'
import type {
  LanguageCode,
  ProviderProfile,
  SourceLanguage,
  TestProviderResult,
  TranslationMode,
} from '@tt/contracts'
import { Badge } from '../../components/ui/badge'
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

type ProviderDraft = {
  id: string
  label: string
  baseUrl: string
  models: string[]
  modelInput: string
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
    models: [...profile.models],
    modelInput: '',
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
    models: [],
    modelInput: '',
    timeoutMs: '60000',
    temperature: '0.3',
    maxRetries: '2',
    apiKeyDraft: '',
    hasKey: false,
  }
}

/**
 * Drafts survive page navigation (route changes unmount the page).
 * Cleared only when settings are saved to the vault.
 */
let providerDraftCache: ProviderDraft[] | null = null

function signatureOf(
  drafts: ProviderDraft[],
  values: { sourceLanguage: string; targetLanguage: string; mode: string; autoSave: boolean; dailySessionSize: string },
): string {
  return JSON.stringify({
    providers: drafts.map(({ apiKeyDraft: _apiKey, hasKey: _hasKey, modelInput: _modelInput, ...rest }) => rest),
    values,
  })
}

function isAutoSaveable(drafts: ProviderDraft[]): boolean {
  return (
    drafts.length > 0 &&
    drafts.every(
      (draft) =>
        draft.label.trim().length > 0 &&
        draft.baseUrl.trim().length > 0 &&
        URL.canParse(draft.baseUrl.trim()) &&
        draft.models.length > 0 &&
        Number.isFinite(Number(draft.timeoutMs)) &&
        Number.isFinite(Number(draft.temperature)) &&
        Number.isFinite(Number(draft.maxRetries)),
    )
  )
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
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, TestProviderResult | 'loading'>>({})

  // Seed local form state once settings have loaded; drafts from a
  // previous visit take precedence so nothing is lost mid-editing.
  const seededRef = useRef(false)
  useEffect(() => {
    const settings = settingsQuery.data
    if (!settings || seededRef.current) return
    seededRef.current = true
    const drafts = providerDraftCache
      ? providerDraftCache.map((draft) => ({
          ...draft,
          hasKey: draft.hasKey || settings.hasApiKeys[draft.id] === true,
        }))
      : settings.providers.map((profile) => toDraft(profile, settings.hasApiKeys[profile.id] === true))
    setProviders(drafts)
    lastSavedSignatureRef.current = signatureOf(drafts, {
      sourceLanguage: settings.translation.sourceLanguage,
      targetLanguage: settings.translation.targetLanguage,
      mode: settings.translation.mode,
      autoSave: settings.translation.autoSave,
      dailySessionSize: String(settings.training.dailySessionSize),
    })
    setSourceLanguage(settings.translation.sourceLanguage)
    setTargetLanguage(settings.translation.targetLanguage)
    setMode(settings.translation.mode)
    setAutoSave(settings.translation.autoSave)
    setDailySessionSize(String(settings.training.dailySessionSize))
  }, [settingsQuery.data])

  const saveMutation = useMutation({
    mutationFn: async (input: { drafts: ProviderDraft[]; signature: string }) => {
      const sessionSize = Number(dailySessionSize)
      if (!Number.isFinite(sessionSize)) throw new Error('Daily session size must be a number.')
      const profiles: ProviderProfile[] = input.drafts.map((draft, index) => {
        const timeoutMs = Number(draft.timeoutMs)
        const temperature = Number(draft.temperature)
        const maxRetries = Number(draft.maxRetries)
        if (!draft.label.trim()) throw new Error(`Provider ${index + 1}: label is required.`)
        if (!Number.isFinite(timeoutMs) || !Number.isFinite(temperature) || !Number.isFinite(maxRetries)) {
          throw new Error(`Provider "${draft.label}": timeout, temperature and retries must be numbers.`)
        }
        if (!draft.baseUrl.trim()) throw new Error(`Provider "${draft.label}": base URL is required.`)
        if (draft.models.length === 0) throw new Error(`Provider "${draft.label}": add at least one model.`)
        return {
          id: draft.id,
          label: draft.label.trim(),
          baseUrl: draft.baseUrl.trim(),
          models: draft.models.map((model) => model.trim()).filter((model) => model.length > 0),
          timeoutMs: Math.round(timeoutMs),
          temperature,
          maxRetries: Math.round(maxRetries),
        }
      })
      const settingsView = await api.settings.update({
        providers: profiles,
        providerKeys: input.drafts
          .filter((draft) => draft.apiKeyDraft.trim().length > 0)
          .map((draft) => ({ providerId: draft.id, apiKey: draft.apiKeyDraft.trim() })),
        translation: { sourceLanguage, targetLanguage, mode, autoSave },
        training: { dailySessionSize: Math.round(sessionSize) },
      })
      return { signature: input.signature, settingsView }
    },
    onSuccess: ({ signature, settingsView }) => {
      lastSavedSignatureRef.current = signature
      providerDraftCache = settingsView.providers.map((profile) =>
        toDraft(profile, settingsView.hasApiKeys[profile.id] === true),
      )
      setProviders((current) =>
        current
          ? current.map((draft) => ({
              ...draft,
              apiKeyDraft: '',
              hasKey: draft.hasKey || draft.apiKeyDraft.trim().length > 0,
            }))
          : current,
      )
      void queryClient.invalidateQueries({ queryKey: ['settings'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  // Auto-save: persist shortly after any form change once every row is
  // complete enough to be valid. Incomplete rows stay as drafts and
  // survive page navigation via the module-level cache.
  const lastSavedSignatureRef = useRef<string | null>(null)
  const formValues = { sourceLanguage, targetLanguage, mode, autoSave, dailySessionSize }
  const formSignature = providers === null ? '' : signatureOf(providers, formValues)
  useEffect(() => {
    if (providers === null || !seededRef.current) return
    if (formSignature === lastSavedSignatureRef.current) return
    if (!isAutoSaveable(providers)) return
    const timer = setTimeout(() => {
      saveMutation.mutate({ drafts: providers, signature: formSignature })
    }, 1200)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formSignature])

  const chooseVaultMutation = useMutation({
    mutationFn: api.settings.chooseVault,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  })

  const rebuildIndexMutation = useMutation({
    mutationFn: api.maintenance.rebuildIndex,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['history'] }),
  })

  const settings = settingsQuery.data

  // Pointer-based drag reorder (HTML5 DnD is unreliable inside Electron).
  const listRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!draggingId) return
    const onMove = (event: PointerEvent): void => {
      const list = listRef.current
      if (!list) return
      const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-provider-id]'))
      const target = rows.find((row) => {
        const rect = row.getBoundingClientRect()
        return event.clientY >= rect.top && event.clientY <= rect.bottom
      })
      const targetId = target?.dataset['providerId']
      if (!targetId || targetId === draggingId) return
      setProviders((current) => {
        if (!current) return current
        const from = current.findIndex((draft) => draft.id === draggingId)
        const to = current.findIndex((draft) => draft.id === targetId)
        if (from === -1 || to === -1 || from === to) return current
        const next = [...current]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved!)
        return next
      })
    }
    const onUp = (): void => setDraggingId(null)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [draggingId])

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

  function moveProvider(id: string, direction: -1 | 1): void {
    setProviders((current) => {
      if (!current) return current
      const from = current.findIndex((draft) => draft.id === id)
      const to = from + direction
      if (from === -1 || to < 0 || to >= current.length) return current
      const next = [...current]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved!)
      return next
    })
  }

  function saveNow(): void {
    if (providers && providers.length > 0) {
      saveMutation.mutate({ drafts: providers, signature: formSignature })
    }
  }

  const saveButton = (
    <Button
      onClick={saveNow}
      disabled={saveMutation.isPending || providers.length === 0}
      size="sm"
      className={saved ? 'border-emerald-400 bg-emerald-50 text-emerald-800 hover:bg-emerald-50' : ''}
    >
      {saveMutation.isPending ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
    </Button>
  )

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <div className="flex flex-col gap-1.5">
            <CardTitle>AI Providers (OpenAI-compatible)</CardTitle>
            <CardDescription>
              Tried in order — drag ⋮⋮ to reorder. If a provider/model fails or hangs, the next one
              takes over immediately. Multiple models per provider are also tried in order.
            </CardDescription>
          </div>
          {saveButton}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {saveMutation.error && (
            <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {describeError(saveMutation.error)}
            </div>
          )}
          <div ref={listRef} className="flex flex-col gap-3">
            {(providers ?? []).map((draft, index) => (
              <div key={draft.id} data-provider-id={draft.id} className={draggingId === draft.id ? 'opacity-40' : ''}>
                <ProviderCard
                  draft={draft}
                  index={index}
                  total={providers.length}
                  expanded={expandedId === draft.id}
                  dragging={draggingId === draft.id}
                  testResult={testResults[draft.id]}
                  onBeginDrag={() => setDraggingId(draft.id)}
                  onMoveUp={() => moveProvider(draft.id, -1)}
                  onMoveDown={() => moveProvider(draft.id, 1)}
                  onToggle={() => setExpandedId(expandedId === draft.id ? null : draft.id)}
                  onChange={(patch) => updateProvider(draft.id, patch)}
                  onDelete={() =>
                    setProviders((current) => (current ? current.filter((p) => p.id !== draft.id) : current))
                  }
                  onTest={() => {
                    if (!draft.baseUrl.trim() || draft.models.length === 0) return
                    setTestResults((current) => ({ ...current, [draft.id]: 'loading' }))
                    void api.providers
                      .test({
                        providerId: draft.id,
                        baseUrl: draft.baseUrl.trim(),
                        models: draft.models,
                        apiKey: draft.apiKeyDraft.trim() || undefined,
                        timeoutMs: Math.min(120000, Math.max(1000, Number(draft.timeoutMs) || 15000)),
                      })
                      .then((result) =>
                        setTestResults((current) => ({ ...current, [draft.id]: result })),
                      )
                      .catch((error) =>
                        setTestResults((current) => ({
                          ...current,
                          [draft.id]: {
                            ok: false,
                            latencyMs: 0,
                            attempts: [{ model: draft.models[0] ?? '', ok: false, message: describeError(error) }],
                          },
                        })),
                      )
                  }}
                />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
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
            {saveButton}
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
          onClick={saveNow}
          disabled={saveMutation.isPending || providers.length === 0}
          className={saved ? 'border-emerald-400 bg-emerald-50 text-emerald-800 hover:bg-emerald-50' : ''}
        >
          {saveMutation.isPending ? 'Saving…' : saved ? '✓ Saved' : 'Save Settings'}
        </Button>
        {saved && <span className="text-sm text-emerald-600">Settings saved to the vault</span>}
      </div>
    </div>
  )
}

function ProviderCard({
  draft,
  index,
  total,
  expanded,
  dragging,
  testResult,
  onBeginDrag,
  onMoveUp,
  onMoveDown,
  onToggle,
  onChange,
  onDelete,
  onTest,
}: {
  draft: ProviderDraft
  index: number
  total: number
  expanded: boolean
  dragging: boolean
  testResult: TestProviderResult | 'loading' | undefined
  onBeginDrag: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onToggle: () => void
  onChange: (patch: Partial<ProviderDraft>) => void
  onDelete: () => void
  onTest: () => void
}) {
  const hasKey = draft.hasKey || draft.apiKeyDraft.trim().length > 0

  const header = (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <span
        aria-label="Drag to reorder"
        title="Drag to reorder"
        onPointerDown={(event) => {
          event.preventDefault()
          onBeginDrag()
        }}
        className={`select-none px-1 text-muted-foreground ${dragging ? 'cursor-grabbing' : 'cursor-grab'} touch-none`}
      >
        ⋮⋮
      </span>
      <Badge variant="secondary">#{index + 1}</Badge>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{draft.label}</p>
        <p className="text-muted-foreground truncate text-xs">
          {(draft.models.length > 0 ? draft.models : ['no model']).join(' → ')} · {draft.baseUrl}
        </p>
      </div>
    </div>
  )

  if (!expanded) {
    return (
      <div className={`flex items-center justify-between gap-2 rounded-lg border bg-card p-3 ${dragging ? 'ring-2 ring-ring/40' : ''}`}>
        {header}
        <div className="flex shrink-0 items-center gap-1">
          {hasKey ? <Badge variant="secondary">key ✓</Badge> : <Badge variant="destructive">no key</Badge>}
          <Button variant="ghost" size="sm" onClick={onMoveUp} disabled={index === 0} aria-label={`Move ${draft.label} up`}>
            ↑
          </Button>
          <Button variant="ghost" size="sm" onClick={onMoveDown} disabled={index === total - 1} aria-label={`Move ${draft.label} down`}>
            ↓
          </Button>
          <Button variant="ghost" size="sm" onClick={onToggle}>
            Edit
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={`rounded-lg border bg-card p-4 ${dragging ? 'ring-2 ring-ring/40' : ''}`}>
      <div className="mb-3 flex items-center justify-between">
        <Badge variant="secondary">
          #{index + 1} of {total}
        </Badge>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onToggle}>
            Collapse
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <span
          aria-label="Drag to reorder"
          onPointerDown={(event) => {
            event.preventDefault()
            onBeginDrag()
          }}
          className={`select-none px-1 text-muted-foreground ${dragging ? 'cursor-grabbing' : 'cursor-grab'} touch-none`}
        >
          ⋮⋮
        </span>
        <span className="text-muted-foreground text-xs">Drag the handle to change priority</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Label</Label>
          <Input value={draft.label} onChange={(event) => onChange({ label: event.target.value })} />
        </div>
        <div className="flex flex-col gap-1.5">
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
      </div>

      <div className="mt-3 flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Models (tried in order)</Label>
        <div className="flex flex-col gap-1">
          {draft.models.map((model, modelIndex) => (
            <div key={model} className="flex items-center justify-between rounded-md border px-2 py-1">
              <span className="text-sm">
                <span className="text-muted-foreground mr-2 text-xs">{modelIndex + 1}.</span>
                {model}
                {modelIndex === 0 && <Badge variant="outline" className="ml-2">default</Badge>}
              </span>
              <span className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Move model ${model} up`}
                  disabled={modelIndex === 0}
                  onClick={() => {
                    const next = [...draft.models]
                    ;[next[modelIndex - 1], next[modelIndex]] = [next[modelIndex]!, next[modelIndex - 1]!]
                    onChange({ models: next })
                  }}
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Move model ${model} down`}
                  disabled={modelIndex === draft.models.length - 1}
                  onClick={() => {
                    const next = [...draft.models]
                    ;[next[modelIndex + 1], next[modelIndex]] = [next[modelIndex]!, next[modelIndex + 1]!]
                    onChange({ models: next })
                  }}
                >
                  ↓
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove model ${model}`}
                  onClick={() => onChange({ models: draft.models.filter((m) => m !== model) })}
                >
                  ✕
                </Button>
              </span>
            </div>
          ))}
          {draft.models.length === 0 && <p className="text-muted-foreground text-xs">No models yet — add one below.</p>}
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={draft.modelInput}
            placeholder="model name, e.g. gpt-4o-mini"
            onChange={(event) => onChange({ modelInput: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                const model = draft.modelInput.trim()
                if (model && !draft.models.includes(model)) onChange({ models: [...draft.models, model], modelInput: '' })
              }
            }}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={draft.modelInput.trim().length === 0 || draft.models.includes(draft.modelInput.trim())}
            onClick={() => {
              const model = draft.modelInput.trim()
              if (model) onChange({ models: [...draft.models, model], modelInput: '' })
            }}
          >
            Add model
          </Button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3">
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
          <Label className="text-xs text-muted-foreground">Max retries (last combo only)</Label>
          <Input
            type="number"
            min={0}
            max={10}
            value={draft.maxRetries}
            onChange={(event) => onChange({ maxRetries: event.target.value })}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onTest} disabled={draft.models.length === 0}>
          Test
        </Button>
        <Button variant="ghost" size="sm" onClick={onToggle}>
          Collapse
        </Button>
        <Button variant="ghost" size="sm" onClick={onDelete}>
          Delete
        </Button>
      </div>

      {testResult === 'loading' && <p className="text-muted-foreground mt-2 text-sm">Testing…</p>}
      {testResult && testResult !== 'loading' && (
        <div
          className={`mt-2 rounded-md border px-3 py-2 text-sm ${
            testResult.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-destructive/30 bg-destructive/10 text-destructive'
          }`}
        >
          {testResult.ok ? (
            <span>
              ✓ OK via <span className="font-medium">{testResult.model}</span> ({testResult.latencyMs} ms)
            </span>
          ) : (
            <div>
              <span>✗ All models failed ({testResult.latencyMs} ms)</span>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {testResult.attempts.map((attempt) => (
                  <li key={attempt.model}>
                    {attempt.model}: {attempt.code ?? ''} {attempt.message ?? ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
