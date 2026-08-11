import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

async function readSourceFiles(root: string): Promise<Array<{ path: string; source: string }>> {
  const { readFileSync, readdirSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
  const files: Array<{ path: string; source: string }> = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(entryPath)
      } else if (entry.isFile() && /\.(?:ts|js|vue)$/.test(entry.name)) {
        files.push({ path: entryPath, source: readFileSync(entryPath, 'utf8') })
      }
    }
  }
  visit(root)
  return files
}

describe('Main logging boundaries', () => {
  it('keeps electron-log out of runtime source code', async () => {
    const sourceRoot = path.resolve(process.cwd(), 'src')
    const files = await readSourceFiles(sourceRoot)
    const importers = files
      .filter(({ source }) =>
        /from ['"]electron-log(?:\/[^'"]+)?['"]|require\(['"]electron-log(?:\/[^'"]+)?['"]\)/.test(
          source
        )
      )
      .map(({ path: filePath }) => path.relative(sourceRoot, filePath))

    expect(importers).toEqual([])
  })

  it('does not expose another file transport or retain the legacy Main log path', async () => {
    const sourceRoot = path.resolve(process.cwd(), 'src')
    const files = [
      ...(await readSourceFiles(path.join(sourceRoot, 'main'))),
      ...(await readSourceFiles(path.join(sourceRoot, 'shared')))
    ]

    for (const { path: filePath, source } of files) {
      expect(source).not.toMatch(/console\.(?:log|error|warn|info|debug|trace)\s*=/)
      expect(source).not.toContain('logs/main.log')
      if (!filePath.endsWith(path.join('main', 'logging', 'mainJsonlPersistence.ts'))) {
        expect(source).not.toContain('transports.file')
        expect(source).not.toContain('resolvePathFn')
      }
    }
  })
})
