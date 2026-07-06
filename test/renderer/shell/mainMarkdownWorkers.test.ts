import { describe, expect, it, vi } from 'vitest'
import type { readFileSync as readFileSyncType } from 'node:fs'
import { resolve } from 'node:path'

describe('renderer main markdown workers', () => {
  it('does not eagerly initialize markdown workers during renderer startup', async () => {
    const { readFileSync } = await vi.importActual<{ readFileSync: typeof readFileSyncType }>(
      'node:fs'
    )
    const source = readFileSync(resolve('src/renderer/src/main.ts'), 'utf8')

    expect(source).not.toContain('ensureMarkdownWorkers')
  })
})
