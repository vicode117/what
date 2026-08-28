import { promises as fs } from 'node:fs'
import path from 'node:path'
import { AppError } from '@tt/contracts'

export type PromptVars = Record<string, string>

/**
 * Loads version-controlled Markdown prompts from a list of directories.
 *
 * Earlier search paths take precedence, which lets the Vault's
 * `prompts/` folder override built-in prompts without touching the
 * application bundle. Prompt keys are slash-separated relative paths
 * without the `.md` extension, e.g. `translation/natural`.
 */
export class PromptManager {
  private templates = new Map<string, string>()

  constructor(private readonly searchPaths: readonly string[]) {}

  async load(): Promise<void> {
    this.templates.clear()
    for (const dir of this.searchPaths) {
      let files: string[]
      try {
        files = await walkMarkdownFiles(dir)
      } catch {
        continue // missing or unreadable directory — skip
      }
      for (const file of files) {
        const key = toPromptKey(dir, file)
        if (!this.templates.has(key)) {
          this.templates.set(key, await fs.readFile(file, 'utf8'))
        }
      }
    }
  }

  list(): string[] {
    return [...this.templates.keys()].sort()
  }

  has(key: string): boolean {
    return this.templates.has(key)
  }

  get(key: string): string {
    const template = this.templates.get(key)
    if (template === undefined) {
      throw new AppError('PROMPT_ERROR', `Prompt not found: ${key}`)
    }
    return template
  }

  render(key: string, vars: PromptVars = {}): string {
    const template = this.get(key)
    return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, name: string) => {
      const value = vars[name]
      if (value === undefined) {
        throw new AppError('PROMPT_ERROR', `Prompt "${key}" is missing variable "${name}"`)
      }
      return value
    })
  }
}

async function walkMarkdownFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(full)
      }
    }
  }
  await walk(dir)
  return files
}

function toPromptKey(rootDir: string, file: string): string {
  const relative = path.relative(rootDir, file).replace(/\.md$/, '')
  return relative.split(path.sep).join('/')
}
