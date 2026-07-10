import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const MAIN_ROOT = path.resolve('src/main')

const listTypeScriptFiles = async (directory: string): Promise<string[]> => {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        return await listTypeScriptFiles(entryPath)
      }
      return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : []
    })
  )
  return nested.flat()
}

describe('session resolution source contract', () => {
  it('keeps only the floating button on a production legacy session adapter', async () => {
    const files = await listTypeScriptFiles(MAIN_ROOT)
    const callPattern = /agentSessionPresenter\??\.(getSession|getSessionList|getActiveSession)\b/g
    const callers: string[] = []

    for (const file of files) {
      const source = await fs.readFile(file, 'utf8')
      for (const match of source.matchAll(callPattern)) {
        callers.push(`${path.relative(process.cwd(), file)}:${match[1]}`)
      }
    }

    expect([...new Set(callers)]).toEqual([
      'src/main/presenter/floatingButtonPresenter/index.ts:getSessionList'
    ])
  })

  it('does not fake a nullable session into SessionWithState', async () => {
    const files = await listTypeScriptFiles(MAIN_ROOT)
    const violations: string[] = []

    for (const file of files) {
      const source = await fs.readFile(file, 'utf8')
      if (/null\s+as\s+unknown\s+as\s+SessionWithState/.test(source)) {
        violations.push(path.relative(process.cwd(), file))
      }
    }

    expect(violations).toEqual([])
  })
})
