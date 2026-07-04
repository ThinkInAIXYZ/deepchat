import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('renderer main markdown workers', () => {
  it('does not eagerly initialize markdown workers during renderer startup', () => {
    const source = readFileSync(resolve('src/renderer/src/main.ts'), 'utf8')

    expect(source).not.toContain('ensureMarkdownWorkers')
  })
})
