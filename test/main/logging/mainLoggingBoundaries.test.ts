import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

async function readTypeScriptFiles(root: string): Promise<Array<{ path: string; source: string }>> {
  const { readFileSync, readdirSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
  const files: Array<{ path: string; source: string }> = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(entryPath)
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        files.push({ path: entryPath, source: readFileSync(entryPath, 'utf8') })
      }
    }
  }
  visit(root)
  return files
}

describe('Main logging boundaries', () => {
  it('keeps electron-log inside the dedicated JSONL persistence adapter', async () => {
    const sourceRoot = path.resolve(process.cwd(), 'src')
    const files = [
      ...(await readTypeScriptFiles(path.join(sourceRoot, 'main'))),
      ...(await readTypeScriptFiles(path.join(sourceRoot, 'shared')))
    ]
    const importers = files
      .filter(({ source }) =>
        /from ['"]electron-log['"]|require\(['"]electron-log['"]\)/.test(source)
      )
      .map(({ path: filePath }) => path.relative(sourceRoot, filePath))

    expect(importers).toEqual(['main/logging/electronMainLogPersistence.ts'])
  })

  it('does not intercept global console methods or retain the legacy Main log path', async () => {
    const sourceRoot = path.resolve(process.cwd(), 'src')
    const files = [
      ...(await readTypeScriptFiles(path.join(sourceRoot, 'main'))),
      ...(await readTypeScriptFiles(path.join(sourceRoot, 'shared')))
    ]

    for (const { source } of files) {
      expect(source).not.toMatch(/console\.(?:log|error|warn|info|debug|trace)\s*=/)
      expect(source).not.toContain('logs/main.log')
    }
  })
})
