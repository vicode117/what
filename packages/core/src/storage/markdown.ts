import { AppError } from '@tt/contracts'
import { parse, stringify } from 'yaml'

/**
 * Minimal, human-readable Markdown document helpers.
 *
 * User-visible records are plain Markdown with YAML frontmatter so they
 * can be browsed and edited outside the application (e.g. in Obsidian).
 */

export type MarkdownDocument = {
  frontmatter: Record<string, unknown>
  body: string
}

export function serializeDocument(frontmatter: Record<string, unknown>, body: string): string {
  const yaml = stringify(frontmatter, { lineWidth: 0 }).trimEnd()
  return `---\n${yaml}\n---\n\n${body.trimEnd()}\n`
}

export function parseDocument(raw: string): MarkdownDocument {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized)
  if (!match) {
    throw new AppError('STORAGE_ERROR', 'Markdown file is missing a YAML frontmatter block')
  }
  let frontmatter: unknown
  try {
    frontmatter = parse(match[1]!)
  } catch (error) {
    throw new AppError('STORAGE_ERROR', 'Markdown frontmatter is not valid YAML', {
      cause: error instanceof Error ? error.message : String(error),
    })
  }
  if (frontmatter === null || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    throw new AppError('STORAGE_ERROR', 'Markdown frontmatter must be a mapping')
  }
  return { frontmatter: frontmatter as Record<string, unknown>, body: normalized.slice(match[0].length) }
}

export type Section = {
  heading: string
  content: string
}

export function buildBody(title: string, sections: readonly Section[]): string {
  const parts: string[] = [`# ${title}\n`]
  for (const section of sections) {
    parts.push(`## ${section.heading}\n\n${section.content.trimEnd()}\n`)
  }
  return `${parts.join('\n').trimEnd()}\n`
}

/**
 * Extracts `## <heading>` sections by exact heading match.
 * A section's content is everything up to the next known heading, trimmed.
 */
export function parseBody(body: string, headings: readonly string[]): Record<string, string> {
  const escaped = headings.map((heading) => heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`^## (${escaped.join('|')})[ \\t]*$`, 'gm')
  const matches = [...body.matchAll(pattern)]
  const result: Record<string, string> = {}
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!
    const start = (match.index ?? 0) + match[0].length
    const end = i + 1 < matches.length ? (matches[i + 1]!.index ?? body.length) : body.length
    result[match[1]!] = body.slice(start, end).trim()
  }
  return result
}
