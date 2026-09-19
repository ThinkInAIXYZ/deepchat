import { describe, expect, it, vi } from 'vitest'
import {
  findRequiredNativeTapeTests,
  validateMemoryTestScope
} from '../../../scripts/check-memory-test-scope.mjs'

const rootDir = process.cwd()
const baseManifest = {
  behavior: ['portable.test.ts'],
  native: ['native.test.ts'],
  eval: ['eval.test.ts'],
  perf: ['perf.test.ts'],
  exemptions: [{ path: 'exempt.test.ts', reason: 'Owned by an external compatibility gate.' }]
}
const existingPaths = new Set([
  'portable.test.ts',
  'native.test.ts',
  'eval.test.ts',
  'perf.test.ts',
  'exempt.test.ts'
])
const fileContents = new Map([...existingPaths].map((path) => [path, 'export {}']))

describe('memory test scope guard', () => {
  it('keeps mutable runtime test accessors out of production Memory classes', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const files = [
      'src/main/memory/infra/embeddingPipeline.ts',
      'src/main/memory/infra/vectorStoreManager.ts',
      'src/main/memory/services/maintenanceService.ts',
      'src/main/memory/services/personaService.ts',
      'src/main/memory/services/reflectionService.ts',
      'src/main/memory/services/workingMemoryService.ts'
    ]
    for (const file of files) {
      expect(readFileSync(file, 'utf8').includes('getMutableRuntimeStateForTests')).toBe(false)
    }
  })

  it('accepts a complete disjoint scope', () => {
    expect(
      validateMemoryTestScope({
        rootDir,
        manifest: baseManifest,
        existingPaths,
        discoveredPaths: [...existingPaths],
        fileContents
      })
    ).toEqual([])
  })

  it('rejects unclassified and duplicate tests', () => {
    const manifest = structuredClone(baseManifest)
    manifest.native.push('portable.test.ts')
    expect(
      validateMemoryTestScope({
        rootDir,
        manifest,
        existingPaths,
        discoveredPaths: [...existingPaths, 'new-memory.test.ts'],
        fileContents
      })
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('classified more than once'),
        expect.stringContaining('not classified')
      ])
    )
  })

  it('rejects stale paths and empty exemption reasons', () => {
    const manifest = structuredClone(baseManifest)
    manifest.behavior.push('removed.test.ts')
    manifest.exemptions.push({ path: 'unreasoned.test.ts', reason: '' })
    expect(
      validateMemoryTestScope({
        rootDir,
        manifest,
        existingPaths,
        discoveredPaths: [],
        fileContents
      })
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('does not exist'),
        expect.stringContaining('non-empty reason')
      ])
    )
  })

  it('rejects Native harness tests classified as portable', () => {
    const manifest = structuredClone(baseManifest)
    manifest.behavior.push('nativeSqliteHarness.test.ts')
    const paths = new Set([...existingPaths, 'nativeSqliteHarness.test.ts'])
    expect(
      validateMemoryTestScope({
        rootDir,
        manifest,
        existingPaths: paths,
        discoveredPaths: [],
        fileContents: new Map([
          ...fileContents,
          ['nativeSqliteHarness.test.ts', "import './nativeSqliteHarness'"]
        ])
      })
    ).toContainEqual(expect.stringContaining('cannot be portable behavior'))
  })

  it('accepts a manifest without exemptions and never falls back to filesystem reads', () => {
    const manifest = { ...structuredClone(baseManifest), exemptions: undefined }
    const readFile = vi.fn(() => {
      throw new Error('unexpected filesystem read')
    })
    expect(
      validateMemoryTestScope({
        rootDir,
        manifest,
        existingPaths,
        discoveredPaths: ['portable.test.ts'],
        fileContents,
        readFile
      })
    ).toEqual([])
    expect(readFile).not.toHaveBeenCalled()
  })

  it('requires discovered native Tape tests to stay in the native scope', () => {
    const requiredPath = 'tape-native.test.ts'
    const paths = new Set([...existingPaths, requiredPath])
    const contents = new Map([...fileContents, [requiredPath, 'export {}']])

    expect(
      validateMemoryTestScope({
        rootDir,
        manifest: baseManifest,
        existingPaths: paths,
        discoveredPaths: [],
        requiredNativePaths: [requiredPath],
        fileContents: contents
      })
    ).toContainEqual(expect.stringContaining('not classified as native'))

    const manifest = structuredClone(baseManifest)
    manifest.native.push(requiredPath)
    expect(
      validateMemoryTestScope({
        rootDir,
        manifest,
        existingPaths: paths,
        discoveredPaths: [],
        requiredNativePaths: [requiredPath],
        fileContents: contents
      })
    ).toEqual([])
  })

  it('discovers only split Tape suites with native SQLite gates', () => {
    const paths = [
      'test/main/session/data/tapeRecall.test.ts',
      'test/main/session/data/tapeReplay.spec.ts',
      'test/main/session/data/tapeReconciler.test.ts',
      'test/main/session/data/tables/deepchatTapeEntriesTable.test.ts',
      'test/main/session/data/tables/deepchatTapeEntriesTable.spec.ts',
      'test/main/memory/agentMemoryTable.test.ts'
    ]
    const contents = new Map([
      ['test/main/session/data/tapeRecall.test.ts', 'itIfSqlite(\'uses SQLite\', () => {})'],
      ['test/main/session/data/tapeReplay.spec.ts', 'describeIfSqlite(\'uses SQLite\', () => {})'],
      ['test/main/session/data/tapeReconciler.test.ts', 'it(\'stays portable\', () => {})'],
      [
        'test/main/session/data/tables/deepchatTapeEntriesTable.test.ts',
        'describeIfSqlite(\'uses SQLite\', () => {})'
      ],
      [
        'test/main/session/data/tables/deepchatTapeEntriesTable.spec.ts',
        'itIfSqlite(\'uses SQLite\', () => {})'
      ],
      ['test/main/memory/agentMemoryTable.test.ts', 'itIfSqlite(\'outside Tape\', () => {})']
    ])

    expect(findRequiredNativeTapeTests(paths, (path) => contents.get(path) ?? '')).toEqual([
      'test/main/session/data/tapeRecall.test.ts',
      'test/main/session/data/tapeReplay.spec.ts',
      'test/main/session/data/tables/deepchatTapeEntriesTable.test.ts',
      'test/main/session/data/tables/deepchatTapeEntriesTable.spec.ts'
    ])
  })
})
