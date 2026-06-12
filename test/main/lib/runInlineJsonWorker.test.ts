import { afterEach, describe, expect, it, vi } from 'vitest'
import { runInlineJsonWorker } from '../../../src/main/lib/runInlineJsonWorker'

const originalCwd = process.cwd()
const tempDirs: string[] = []

afterEach(async () => {
  const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
  process.chdir(originalCwd)

  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop()
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  }
})

describe('runInlineJsonWorker', () => {
  it('resolves bundled dependencies independently of process.cwd()', async () => {
    const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
    const os = await vi.importActual<typeof import('node:os')>('node:os')
    const path = await vi.importActual<typeof import('node:path')>('node:path')
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inline-worker-'))
    tempDirs.push(tempDir)
    process.chdir(tempDir)

    const output = await runInlineJsonWorker<null, string>({
      name: 'inline-worker-resolution',
      source: `
const requireFromBundle = globalThis.__inlineWorkerRequire || require
const { parentPort } = requireFromBundle('node:worker_threads')
const matter = requireFromBundle('gray-matter')
const result = matter('---\\nname: demo\\ndescription: ok\\n---\\nbody')
parentPort.postMessage({
  ok: true,
  data: result.data.name
})
`,
      input: null
    })

    expect(output).toBe('demo')
  })
})
