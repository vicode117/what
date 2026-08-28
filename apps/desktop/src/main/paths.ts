import path from 'node:path'
import { app } from 'electron'

/**
 * Built-in prompts live at the repository root (`prompts/`) during
 * development and are copied next to the app bundle as an extra resource
 * in packaged builds (see electron-builder.yml).
 */
export function builtinPromptsDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'prompts')
  }
  // out/main/index.js -> apps/desktop/out/main -> repo root is four levels up.
  return path.resolve(__dirname, '..', '..', '..', '..', 'prompts')
}
