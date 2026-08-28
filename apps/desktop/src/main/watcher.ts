import path from 'node:path'
import { watch, type FSWatcher } from 'chokidar'

/**
 * Watches the Vault's translations directory for external changes
 * (sync conflicts, Obsidian edits, files appearing/disappearing).
 * Events are debounced; the callback only receives changed paths and
 * NEVER rewrites Markdown — it refreshes the derived index.
 */
export class VaultWatcher {
  private watcher: FSWatcher | null = null
  private pending = new Set<string>()
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly onFilesChanged: (files: string[]) => void,
    private readonly debounceMs = 500,
  ) {}

  async watch(vaultPath: string): Promise<void> {
    await this.stop()
    this.watcher = watch(path.join(vaultPath, 'translations'), {
      ignoreInitial: true,
      depth: 6,
      ignored: (file: string) => path.basename(file).startsWith('~$'),
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    })
    this.watcher.on('add', (file: string) => this.enqueue(file))
    this.watcher.on('change', (file: string) => this.enqueue(file))
    this.watcher.on('unlink', (file: string) => this.enqueue(file))
    this.watcher.on('error', () => {
      // Watching is best-effort; the index can always be rebuilt manually.
    })
  }

  private enqueue(file: string): void {
    this.pending.add(file)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      const files = [...this.pending]
      this.pending.clear()
      this.timer = null
      if (files.length > 0) this.onFilesChanged(files)
    }, this.debounceMs)
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.pending.clear()
    if (this.watcher) {
      await this.watcher.close().catch(() => undefined)
      this.watcher = null
    }
  }
}
