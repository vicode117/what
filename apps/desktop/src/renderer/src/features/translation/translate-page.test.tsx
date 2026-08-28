// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { AppApi, SettingsView } from '@tt/contracts'
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
  translation: { sourceLanguage: 'auto', targetLanguage: 'zh-CN', mode: 'natural' },
}

function makeApi(overrides: Partial<AppApi> = {}): AppApi {
  return {
    translation: {
      translate: vi.fn(async () => ({
        translatedText: '你好，世界',
        provider: 'openai-compatible',
        model: 'example-model',
        durationMs: 12,
      })),
      save: vi.fn(async () => ({ id: 'tr_20260829_001', filePath: 'C:/vault/tr_20260829_001.md' })),
    },
    history: {
      get: vi.fn(async () => null),
      list: vi.fn(async () => ({ items: [], total: 0 })),
      update: vi.fn(async () => null),
      delete: vi.fn(async () => null),
      restore: vi.fn(async () => null),
    },
    maintenance: {
      rebuildIndex: vi.fn(async () => ({ count: 0 })),
    },
    settings: {
      get: vi.fn(async () => settingsView),
      update: vi.fn(async () => settingsView),
      chooseVault: vi.fn(async () => null),
    },
    ...overrides,
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

  it('translates and saves through the typed bridge', async () => {
    const app = makeApi()
    renderPage(app)

    fireEvent.change(screen.getByLabelText('Source text'), { target: { value: 'Hello world' } })
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))

    expect(await screen.findByLabelText('Translation result (editable)')).toBeTruthy()
    expect(app.translation.translate).toHaveBeenCalledWith({
      text: 'Hello world',
      sourceLanguage: 'auto',
      targetLanguage: 'zh-CN',
      mode: 'natural',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(app.translation.save).toHaveBeenCalledTimes(1))
    expect(app.translation.save).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceText: 'Hello world',
        aiTranslation: '你好，世界',
        provider: 'openai-compatible',
        model: 'example-model',
      }),
    )
  })
})
