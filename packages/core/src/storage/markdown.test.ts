import { describe, expect, it } from 'vitest'
import { buildBody, parseBody, parseDocument, serializeDocument } from './markdown'

describe('frontmatter serialization', () => {
  it('round-trips a document', () => {
    const markdown = serializeDocument({ id: 'tr_20260829_001', tags: ['software', 'ai'] }, '# Title\n\nbody')
    expect(markdown.startsWith('---\n')).toBe(true)
    const parsed = parseDocument(markdown)
    expect(parsed.frontmatter).toEqual({ id: 'tr_20260829_001', tags: ['software', 'ai'] })
    expect(parsed.body).toContain('# Title')
    expect(parsed.body).toContain('body')
  })

  it('handles CRLF input', () => {
    const parsed = parseDocument('---\r\nid: tr_1\r\n---\r\n\r\nbody\r\n')
    expect(parsed.frontmatter).toEqual({ id: 'tr_1' })
    expect(parsed.body).toContain('body')
  })

  it('does not fold long single-line values', () => {
    const long = 'x'.repeat(500)
    const parsed = parseDocument(serializeDocument({ text: long }, ''))
    expect(parsed.frontmatter['text']).toBe(long)
  })

  it('preserves multi-line values', () => {
    const parsed = parseDocument(serializeDocument({ text: 'a\nb' }, 'body'))
    expect(parsed.frontmatter['text']).toBe('a\nb')
  })

  it('throws when frontmatter is missing', () => {
    expect(() => parseDocument('no frontmatter here')).toThrow()
  })

  it('throws when frontmatter is not a mapping', () => {
    expect(() => parseDocument('---\n- a\n- b\n---\n\nbody')).toThrow()
  })

  it('throws on invalid YAML', () => {
    expect(() => parseDocument('---\n[a, b\n---\n')).toThrow()
  })
})

describe('body sections', () => {
  it('builds and parses sections', () => {
    const body = buildBody('Translation', [
      { heading: 'Source', content: 'hello\nworld' },
      { heading: 'Translation', content: '你好，世界' },
    ])
    expect(body).toContain('# Translation')
    expect(body).toContain('## Source')
    const sections = parseBody(body, ['Source', 'Translation'])
    expect(sections['Source']).toBe('hello\nworld')
    expect(sections['Translation']).toBe('你好，世界')
  })

  it('keeps multi-paragraph content intact', () => {
    const body = buildBody('T', [{ heading: 'Notes', content: 'line one\n\nline two' }])
    expect(parseBody(body, ['Notes'])['Notes']).toBe('line one\n\nline two')
  })

  it('returns an empty record when no known headings exist', () => {
    expect(parseBody('# T\n\nnothing here', ['Source'])).toEqual({})
  })

  it('does not treat unknown ## lines as section boundaries', () => {
    const body = buildBody('T', [
      { heading: 'Source', content: 'intro\n\n## Something Else\n\ntext' },
      { heading: 'Translation', content: 'outro' },
    ])
    const sections = parseBody(body, ['Source', 'Translation'])
    expect(sections['Source']).toContain('## Something Else')
    expect(sections['Translation']).toBe('outro')
  })
})
