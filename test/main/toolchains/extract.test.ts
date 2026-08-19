import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

import { extractArchive } from '../../../src/main/toolchains/extract'

describe('toolchain extract', () => {
  it('rejects an already-aborted extract as cancelled', async () => {
    const destDir = path.join(mkdtempSync(path.join(os.tmpdir(), 'dc-ex-')), 'out')
    const controller = new AbortController()
    controller.abort()
    await expect(
      extractArchive(path.join(destDir, 'missing.tar.gz'), destDir, controller.signal)
    ).rejects.toMatchObject({ reason: 'cancelled' })
  })
})
