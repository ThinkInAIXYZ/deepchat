import { describe, expect, it } from 'vitest'
import {
  getMarkstreamLanguageFromFilename,
  normalizeMarkstreamCodeFenceLanguages
} from '@/lib/markstreamLanguage'

describe('Markstream language normalization', () => {
  it.each([
    ['/tmp/example.ts', 'typescript'],
    ['/tmp/example.sh', 'shell'],
    ['/tmp/example.conf', 'ini'],
    ['/tmp/example.f90', 'fortran-free-form'],
    ['/tmp/.htaccess', 'apache'],
    ['/tmp/.gitignore', 'plaintext'],
    ['/tmp/unknown', 'plain']
  ])('maps %s to a stream-diffs language', (filename, expected) => {
    expect(getMarkstreamLanguageFromFilename(filename)).toBe(expected)
  })

  it('rewrites known unsupported fence languages without dropping metadata', () => {
    expect(
      normalizeMarkstreamCodeFenceLanguages(
        '```configuration:app.conf title=config\nkey=value\n```\n\n```typescript\nconst value = 1\n```'
      )
    ).toBe('```ini:app.conf title=config\nkey=value\n```\n\n```typescript\nconst value = 1\n```')
  })

  it.each([
    ['zsh', 'shell'],
    ['plaintext', 'plain']
  ])('rewrites the %s fence alias to %s', (language, expected) => {
    expect(normalizeMarkstreamCodeFenceLanguages(`\`\`\`${language}\nvalue\n\`\`\``)).toBe(
      `\`\`\`${expected}\nvalue\n\`\`\``
    )
  })
})
