// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { AppApi, SettingsView, TranslateResult } from '@tt/contracts'
import { TranslatePage } from './translate-page'

const settingsView: SettingsView = {
  vaultPath: 'C:/Users/tester/TranslationVault',
  hasApiKey: true,
  provider: {
    name: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    model: 'example-model',
    timeoutMs: 60000,
    temperature: 0.3,
    maxRetries: 2,
  },
  translation: { sourceLanguage: 'auto', targetLanguage: 'zh-CN', mode: 'natural', autoSave: true },
  training: { dailySessionSize: 12 },
}

const streamResult: TranslateResult = {
  translatedText: '你好，世界',
  provider: 'openai-compatible',
  model: 'example-model',
  durationMs: 12,
}

function makeApi(): AppApi {
  return {
    translation: {
      translate: vi.fn(async () => streamResult),
      translateStream: vi.fn(async (request, onChunk) => {
        void request
        onChunk('你好，')
        onChunk('世界')
        return streamResult
      }),
      cancelTranslate: vi.fn(),
      save: vi.fn(async () => ({ id: 'tr_20260829_001', filePath: 'C:/vault/tr_20260829_001.md' })),
    },
    history: {
      get: vi.fn(async () => null),
      list: vi.fn(async () => ({ items: [], total: 0 })),
      update: vi.fn(async () => null),
      delete: vi.fn(async () => null),
      restore: vi.fn(async () => null),
      analyze: vi.fn(async () => ({ learningPointIds: [] })),
    },
    memory: {
      list: vi.fn(async () => ({ items: [], total: 0 })),
      update: vi.fn(async () => null),
      delete: vi.fn(async () => false),
    },
    glossary: {
      list: vi.fn(async () => []),
      add: vi.fn(async () => []),
      remove: vi.fn(async () => []),
    },
    training: {
      getToday: vi.fn(async () => ({
        sessionId: 'sess_2026-08-29',
        date: '2026-08-29',
        createdAt: '2026-08-29T00:00:00.000Z',
        exercises: [],
        results: {},
      })),
      submit: vi.fn(async () => ({
        exerciseId: 'ex1',
        result: 'correct' as const,
        feedback: '',
        importantDifferences: [],
        referenceAnswer: '',
        explanation: '',
        feedbackSource: 'heuristic' as const,
      })),
    },
    maintenance: {
      rebuildIndex: vi.fn(async () => ({ count: 0 })),
    },
    settings: {
      get: vi.fn(async () => settingsView),
      update: vi.fn(async () => settingsView),
      chooseVault: vi.fn(async () => null),
    },
  }
}

function renderPage(app: AppApi) {
  Object.defineProperty(window, 'app', { configurable: true, value: app })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <TranslatePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
})

describe('TranslatePage', () => {
  it('renders the form with translate disabled while the source is empty', () => {
    renderPage(makeApi())
    expect(screen.getByLabelText('Source text')).toBeTruthy()
    const translateButton = screen.getByRole('button', { name: 'Translate' })
    expect(translateButton.hasAttribute('disabled')).toBe(true)
  })

  it('warns when no API key is configured', async () => {
    const app = makeApi()
    app.settings.get = vi.fn(async () => ({ ...settingsView, hasApiKey: false }))
    renderPage(app)
    expect(await screen.findByText(/No API key configured/)).toBeTruthy()
  })

  it('streams deltas, then auto-saves the translation', async () => {
    const app = makeApi()
    renderPage(app)

    fireEvent.change(screen.getByLabelText('Source text'), { target: { value: 'Hello world' } })
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))

    // Deltas accumulate live while streaming.
    expect(await screen.findByLabelText('Translation result (editable)')).toBeTruthy()
    expect((screen.getByLabelText('Translation result (editable)') as HTMLTextAreaElement).value).toBe(
      '你好，世界',
    )

    await waitFor(() => expect(app.translation.translateStream).toHaveBeenCalledTimes(1))
    const request = (app.translation.translateStream as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(request).toMatchObject({
      text: 'Hello world',
      sourceLanguage: 'auto',
      targetLanguage: 'zh-CN',
      mode: 'natural',
    })
    expect(request.requestId).toBeTruthy()

    await waitFor(() => expect(app.translation.save).toHaveBeenCalledTimes(1))
    expect(app.translation.save).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceText: 'Hello world',
        aiTranslation: '你好，世界',
        provider: 'openai-compatible',
        model: 'example-model',
      }),
    )
    expect(screen.getByText(/Saved ·/)).toBeTruthy()
  })

  it('does not auto-save when autoSave is disabled and keeps the Save button', async () => {
    const app = makeApi()
    app.settings.get = vi.fn(async () => ({
      ...settingsView,
      translation: { ...settingsView.translation, autoSave: false },
    }))
    renderPage(app)

    // Wait for settings to load so autoSave=false is in effect.
    await waitFor(() => expect(app.settings.get).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByLabelText('Source text'), { target: { value: 'Hello world' } })
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))

    await waitFor(() => expect(app.translation.translateStream).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy())
    expect(app.translation.save).not.toHaveBeenCalled()
  })
})
