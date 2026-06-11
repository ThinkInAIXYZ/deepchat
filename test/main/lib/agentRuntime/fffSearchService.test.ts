import { describe, expect, it, vi } from 'vitest'
import { existsSync } from 'fs'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { FffSearchService, FffSearchUnavailableError } from '@/lib/agentRuntime/fffSearchService'

function createMockModule(overrides: Record<string, unknown> = {}) {
  const finder = {
    isDestroyed: false,
    destroy: vi.fn(),
    waitForScan: vi.fn().mockResolvedValue({ ok: true, value: true }),
    fileSearch: vi.fn().mockReturnValue({
      ok: true,
      value: {
        items: [
          {
            relativePath: 'src/main/example.ts',
            fileName: 'example.ts',
            size: 10,
            modified: 1,
            accessFrecencyScore: 0,
            modificationFrecencyScore: 0,
            totalFrecencyScore: 12,
            gitStatus: 'clean'
          }
        ],
        scores: [{ total: 321 }],
        totalMatched: 1,
        totalFiles: 1
      }
    }),
    glob: vi.fn().mockReturnValue({
      ok: true,
      value: {
        items: [
          {
            relativePath: 'src/main/example.ts',
            fileName: 'example.ts',
            size: 10,
            modified: 1,
            accessFrecencyScore: 0,
            modificationFrecencyScore: 0,
            totalFrecencyScore: 12,
            gitStatus: 'clean'
          }
        ],
        scores: [{ total: 111 }],
        totalMatched: 1,
        totalFiles: 1
      }
    }),
    grep: vi.fn().mockReturnValue({
      ok: true,
      value: {
        items: [
          {
            relativePath: 'src/main/example.ts',
            fileName: 'example.ts',
            gitStatus: 'clean',
            size: 10,
            modified: 1,
            isBinary: false,
            totalFrecencyScore: 7,
            accessFrecencyScore: 0,
            modificationFrecencyScore: 0,
            lineNumber: 5,
            col: 0,
            byteOffset: 10,
            lineContent: 'export function example() {}',
            matchRanges: [[0, 6]],
            contextBefore: ['before'],
            contextAfter: ['after'],
            isDefinition: true
          }
        ],
        totalMatched: 1,
        totalFilesSearched: 1,
        totalFiles: 1,
        filteredFileCount: 1,
        nextCursor: null
      }
    }),
    ...overrides
  }
  const FileFinder = {
    isAvailable: vi.fn().mockReturnValue(true),
    create: vi.fn().mockReturnValue({ ok: true, value: finder })
  }
  return { FileFinder, finder }
}

describe('FffSearchService', () => {
  it('loads the packaged FFF module from app.asar.unpacked when available', async () => {
    const resourcesPath = await fs.mkdtemp(path.join(os.tmpdir(), 'fff-packaged-resources-'))
    const moduleRoot = path.join(
      resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      '@ff-labs',
      'fff-node'
    )
    const entryPath = path.join(moduleRoot, 'dist', 'src', 'index.js')
    const originalResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath')

    await fs.mkdir(path.dirname(entryPath), { recursive: true })
    await fs.writeFile(path.join(moduleRoot, 'package.json'), '{"type":"module"}', 'utf8')
    await fs.writeFile(
      entryPath,
      `
export const FileFinder = {
  isAvailable() {
    return true
  },
  create() {
    return {
      ok: true,
      value: {
        isDestroyed: false,
        destroy() {},
        waitForScan() {
          return Promise.resolve({ ok: true, value: true })
        },
        fileSearch() {
          return {
            ok: true,
            value: {
              items: [
                {
                  relativePath: 'packaged.ts',
                  fileName: 'packaged.ts',
                  size: 1,
                  modified: 1,
                  accessFrecencyScore: 0,
                  modificationFrecencyScore: 0,
                  totalFrecencyScore: 0,
                  gitStatus: 'clean'
                }
              ],
              scores: [{ total: 999 }],
              totalMatched: 1,
              totalFiles: 1
            }
          }
        }
      }
    }
  }
}
`,
      'utf8'
    )
    vi.mocked(existsSync).mockImplementation((candidate) => String(candidate) === entryPath)

    Object.defineProperty(process, 'resourcesPath', {
      value: resourcesPath,
      writable: true,
      configurable: true
    })
    ;(process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = resourcesPath

    const service = new FffSearchService()
    try {
      const hits = await service.findFiles('packaged', {
        workspaceRoot: resourcesPath,
        maxResults: 1
      })

      expect(hits).toEqual([{ path: 'packaged.ts', score: 999 }])
    } finally {
      service.destroyAll()
      if (originalResourcesPath) {
        Object.defineProperty(process, 'resourcesPath', originalResourcesPath)
      } else {
        delete (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
      }
      await fs.rm(resourcesPath, { recursive: true, force: true })
    }
  })

  it('maps file search results into DeepChat JSON shape', async () => {
    const mock = createMockModule()
    const service = new FffSearchService({
      moduleLoader: vi.fn().mockResolvedValue({ FileFinder: mock.FileFinder } as any)
    })

    const hits = await service.findFiles('example', {
      workspaceRoot: '/workspace',
      maxResults: 10
    })

    expect(hits).toEqual([{ path: 'src/main/example.ts', score: 321 }])
    expect(mock.finder.fileSearch).toHaveBeenCalledWith('example', {
      pageSize: 10,
      currentFile: undefined
    })
  })

  it('maps grep results with context into DeepChat JSON shape', async () => {
    const mock = createMockModule()
    const service = new FffSearchService({
      moduleLoader: vi.fn().mockResolvedValue({ FileFinder: mock.FileFinder } as any)
    })

    const hits = await service.grep('example', {
      workspaceRoot: '/workspace',
      pathScope: ['src/main/'],
      contextLines: 1,
      maxResults: 5
    })

    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      path: 'src/main/example.ts',
      lineNumber: 5,
      snippet: 'before\nexport function example() {}\nafter'
    })
    expect(mock.finder.grep).toHaveBeenCalledWith(
      'src/main/ example',
      expect.objectContaining({
        mode: 'plain',
        smartCase: true,
        beforeContext: 1,
        afterContext: 1,
        pageSize: 5
      })
    )
  })

  it('uses regex mode automatically for regex-like grep queries', async () => {
    const mock = createMockModule()
    const service = new FffSearchService({
      moduleLoader: vi.fn().mockResolvedValue({ FileFinder: mock.FileFinder } as any)
    })

    await service.grep('agent_fff_search|agentFffSearch', {
      workspaceRoot: '/workspace',
      maxResults: 5
    })

    expect(mock.finder.grep).toHaveBeenCalledWith(
      'agent_fff_search|agentFffSearch',
      expect.objectContaining({
        mode: 'regex',
        pageSize: 5
      })
    )
  })

  it('hydrates grep snippets from disk when FFF line content is truncated', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fff-grep-snippet-'))
    await fs.mkdir(path.join(workspaceRoot, 'src/main'), { recursive: true })
    await fs.writeFile(
      path.join(workspaceRoot, 'src/main/example.ts'),
      ['const before = true', '  const needle = "full line from disk"', 'const after = true'].join(
        '\n'
      ),
      'utf-8'
    )
    const mock = createMockModule({
      grep: vi.fn().mockReturnValue({
        ok: true,
        value: {
          items: [
            {
              relativePath: 'src/main/example.ts',
              fileName: 'example.ts',
              gitStatus: 'clean',
              size: 10,
              modified: 1,
              isBinary: false,
              totalFrecencyScore: 7,
              accessFrecencyScore: 0,
              modificationFrecencyScore: 0,
              lineNumber: 2,
              col: 8,
              byteOffset: 20,
              lineContent: 'needle',
              matchRanges: [[0, 6]],
              contextBefore: [],
              contextAfter: []
            }
          ],
          totalMatched: 1,
          totalFilesSearched: 1,
          totalFiles: 1,
          filteredFileCount: 1,
          nextCursor: null
        }
      })
    })
    const service = new FffSearchService({
      moduleLoader: vi.fn().mockResolvedValue({ FileFinder: mock.FileFinder } as any)
    })

    try {
      const hits = await service.grep('needle', {
        workspaceRoot,
        contextLines: 1,
        maxResults: 5
      })

      expect(hits[0].snippet).toBe(
        'const before = true\n  const needle = "full line from disk"\nconst after = true'
      )
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('keeps extensionless file path scopes exact for grep constraints', async () => {
    const mock = createMockModule()
    const service = new FffSearchService({
      moduleLoader: vi.fn().mockResolvedValue({ FileFinder: mock.FileFinder } as any)
    })

    await service.grep('license', {
      workspaceRoot: '/workspace',
      pathScope: ['Dockerfile'],
      maxResults: 5
    })

    expect(mock.finder.grep).toHaveBeenCalledWith(
      'Dockerfile license',
      expect.objectContaining({
        mode: 'plain',
        pageSize: 5
      })
    )
  })

  it('maps FFF glob results for workspace file search', async () => {
    const mock = createMockModule()
    const service = new FffSearchService({
      moduleLoader: vi.fn().mockResolvedValue({ FileFinder: mock.FileFinder } as any)
    })

    const hits = await service.globFiles('**/*.ts', {
      workspaceRoot: '/workspace',
      maxResults: 10
    })

    expect(hits).toEqual([{ path: 'src/main/example.ts', score: 111 }])
    expect(mock.finder.glob).toHaveBeenCalledWith('**/*.ts', {
      pageSize: 10,
      pageIndex: undefined,
      currentFile: undefined
    })
  })

  it('raises a typed unavailable error when the initial scan times out', async () => {
    const mock = createMockModule({
      waitForScan: vi.fn().mockResolvedValue({ ok: true, value: false })
    })
    const service = new FffSearchService({
      moduleLoader: vi.fn().mockResolvedValue({ FileFinder: mock.FileFinder } as any),
      scanTimeoutMs: 5
    })

    await expect(
      service.findFiles('example', { workspaceRoot: '/workspace' })
    ).rejects.toBeInstanceOf(FffSearchUnavailableError)
    expect(mock.finder.destroy).toHaveBeenCalled()
  })

  it('aborts while waiting for the initial scan and destroys the finder', async () => {
    const controller = new AbortController()
    const mock = createMockModule({
      waitForScan: vi.fn(
        () =>
          new Promise(() => {
            // Intentionally unresolved until the AbortSignal wins the race.
          })
      )
    })
    const service = new FffSearchService({
      moduleLoader: vi.fn().mockResolvedValue({ FileFinder: mock.FileFinder } as any),
      scanTimeoutMs: 10_000
    })

    const promise = service.findFiles('example', {
      workspaceRoot: '/workspace',
      signal: controller.signal
    })
    await Promise.resolve()
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(mock.finder.destroy).toHaveBeenCalled()
  })
})
