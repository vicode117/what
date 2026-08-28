import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TRANSLATION_MODES } from '@tt/contracts'
import { PromptManager } from './prompt-manager'

const repoPromptsDir = path.resolve(__dirname, '..', '..', '..', '..', 'prompts')

let overrideDir: string | null = null

afterEach(async () => {
  if (overrideDir) {
    await rm(overrideDir, { recursive: true, force: true })
    overrideDir = null
  }
})

async function makeOverrideDir(): Promise<string> {
  overrideDir = await mkdtemp(path.join(tmpdir(), 'tt-prompts-'))
  await mkdir(path.join(overrideDir, 'translation'), { recursive: true })
  await writeFile(
    path.join(overrideDir, 'translation', 'natural.md'),
    'OVERRIDE {{sourceLanguage}} {{targetLanguage}}',
    'utf8',
  )
  return overrideDir
}

describe('PromptManager', () => {
  it('ships a prompt for every translation mode', async () => {
    const manager = new PromptManager([repoPromptsDir])
    await manager.load()
    for (const mode of TRANSLATION_MODES) {
      const prompt = manager.get(`translation/${mode}`)
      expect(prompt).toContain('{{sourceLanguage}}')
      expect(prompt).toContain('{{targetLanguage}}')
    }
  })

  it('renders variables', async () => {
    const manager = new PromptManager([repoPromptsDir])
    await manager.load()
    const rendered = manager.render('translation/natural', {
      sourceLanguage: 'English',
      targetLanguage: 'Chinese (Simplified)',
    })
    expect(rendered).not.toContain('{{sourceLanguage}}')
    expect(rendered).toContain('from English into Chinese (Simplified)')
  })

  it('throws a typed error for a missing variable', async () => {
    const manager = new PromptManager([repoPromptsDir])
    await manager.load()
    expect(() => manager.render('translation/natural', { sourceLanguage: 'English' })).toThrow(
      /missing variable "targetLanguage"/,
    )
  })

  it('throws a typed error for an unknown prompt key', async () => {
    const manager = new PromptManager([repoPromptsDir])
    await manager.load()
    expect(() => manager.get('translation/does-not-exist')).toThrow(/Prompt not found/)
  })

  it('lets earlier search paths override built-in prompts', async () => {
    const dir = await makeOverrideDir()
    const manager = new PromptManager([dir, repoPromptsDir])
    await manager.load()
    const rendered = manager.render('translation/natural', {
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
    })
    expect(rendered).toBe('OVERRIDE EN ZH')
    // Other modes still resolve from the built-in directory.
    expect(manager.get('translation/literal')).toContain('{{sourceLanguage}}')
  })

  it('tolerates missing directories', async () => {
    const manager = new PromptManager([path.join(tmpdir(), 'tt-nope-missing'), repoPromptsDir])
    await manager.load()
    expect(manager.has('translation/natural')).toBe(true)
  })
})
