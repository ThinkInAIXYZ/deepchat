import { afterEach, describe, expect, it, vi } from 'vitest'

const duckDbMocks = vi.hoisted(() => ({
  create: vi.fn()
}))

vi.mock('@duckdb/node-api', () => ({
  DuckDBInstance: { create: duckDbMocks.create },
  DuckDBConnection: class {},
  arrayValue: (values: number[]) => values
}))

import logger from '@shared/logger'
import { MigrationAbandonFence } from '@/presenter/memoryPresenter/infra/legacyV1Reader'
import { loadLegacyVss } from '@/presenter/memoryPresenter/infra/legacyVssLoader'
import {
  createMemoryVectorStorePaths,
  MemoryVectorStore,
  type MemoryVectorStorePaths
} from '@/presenter/memoryPresenter/infra/memoryVectorStore'
import {
  createMemoryVectorStoreV2FormatPlan,
  readSafeMemoryVectorRowCount
} from '@/presenter/memoryPresenter/infra/memoryVectorStoreFormat'
import {
  isDuckDbFatalError,
  MemoryVectorStorePostCommitError,
  MemoryVectorStoreTerminalRecoveryError
} from '@/presenter/memoryPresenter/infra/vectorStoreErrors'
import type { MemoryVectorRecord } from '@/presenter/memoryPresenter/types'
import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

const mutableApp = app as { isPackaged: boolean }

interface TestStore {
  connection: { run: ReturnType<typeof vi.fn> }
  vectorTable: string
  perfObserver?: { increment: ReturnType<typeof vi.fn>; observe: ReturnType<typeof vi.fn> }
  upsert(records: MemoryVectorRecord[]): Promise<void>
}

interface QueryableStore {
  connection: { runAndReadAll: ReturnType<typeof vi.fn> }
  vectorTable: string
  query: ReturnType<typeof vi.fn>
  queryByMemoryId(
    memoryId: string,
    options: { topK: number }
  ): Promise<Array<{ memoryId: string; distance: number }>>
}

interface ExactQueryableStore {
  connection: { runAndReadAll: ReturnType<typeof vi.fn> }
  vectorTable: string
  metric: 'cosine'
  query(
    embedding: number[],
    options: { topK: number }
  ): Promise<Array<{ memoryId: string; distance: number }>>
}

interface ListableStore {
  connection: { runAndReadAll: ReturnType<typeof vi.fn> }
  vectorTable: string
  listMemoryIds(afterId: string | null, limit: number): Promise<string[]>
}

function makeStore(onRun: (sql: string) => void = () => {}) {
  const calls: string[] = []
  const connection = {
    run: vi.fn(async (sql: string) => {
      calls.push(sql.trim().split(/[\s;]/)[0].toUpperCase())
      onRun(sql)
      return undefined
    })
  }
  const store = Object.create(MemoryVectorStore.prototype) as unknown as TestStore
  store.connection = connection
  store.vectorTable = 'memory_vector'
  return { store, calls, connection }
}

const records: MemoryVectorRecord[] = [{ memoryId: 'm1', embedding: [0.1, 0.2] }]
const EMB = { providerId: 'p', modelId: 'm' }

describe('MemoryVectorStore v2 format contract', () => {
  it('defines the schema and metadata consumed by native crash fixtures', () => {
    const plan = createMemoryVectorStoreV2FormatPlan(2, EMB)

    expect(plan.createVectorTableSql).toContain('embedding FLOAT[2]')
    expect(plan.createMetaTableSql).toContain('format_version INTEGER NOT NULL')
    expect(plan.createVectorTableSql).not.toMatch(/HNSW|VSS/i)
    expect(plan.metaParams).toEqual(['p', 'm', 2, 2])
  })

  it('rejects malformed and unsafe row counts', () => {
    expect(readSafeMemoryVectorRowCount([{ row_count: '51' }], 'test')).toBe(51)
    expect(() => readSafeMemoryVectorRowCount([{ row_count: null }], 'test')).toThrow(
      'invalid test row count'
    )
    expect(() =>
      readSafeMemoryVectorRowCount([{ row_count: Number.MAX_SAFE_INTEGER + 1 }], 'test')
    ).toThrow('invalid test row count')
  })
})

describe('MemoryVectorStore.upsert transaction (C4, AC-4.2)', () => {
  it('wraps DELETE+INSERT in a single BEGIN/COMMIT', async () => {
    const { store, calls } = makeStore()
    const increment = vi.fn()
    store.perfObserver = { increment, observe: vi.fn() }
    await store.upsert(records)
    expect(calls).toEqual(['BEGIN', 'DELETE', 'INSERT', 'COMMIT'])
    expect(increment.mock.calls).toEqual([['duckDbStatements'], ['duckDbStatements']])
  })

  it('rolls back and rethrows when INSERT fails, never COMMITs', async () => {
    const { store, calls } = makeStore((sql) => {
      if (sql.trim().toUpperCase().startsWith('INSERT')) throw new Error('insert boom')
    })
    await expect(store.upsert(records)).rejects.toThrow('insert boom')
    expect(calls).toContain('BEGIN')
    expect(calls).toContain('ROLLBACK')
    expect(calls).not.toContain('COMMIT')
  })

  it('does not call native rollback after a fatal DuckDB failure', async () => {
    const { store, calls } = makeStore((sql) => {
      if (sql.trim().toUpperCase().startsWith('INSERT')) {
        throw new Error('INTERNAL Error: database has been invalidated')
      }
    })

    await expect(store.upsert(records)).rejects.toThrow('database has been invalidated')

    expect(calls).toContain('BEGIN')
    expect(calls).not.toContain('ROLLBACK')
    expect(calls).not.toContain('COMMIT')
  })

  it('no-ops on empty records without opening a transaction', async () => {
    const { store, connection } = makeStore()
    await store.upsert([])
    expect(connection.run).not.toHaveBeenCalled()
  })
})

describe('MemoryVectorStore.queryByMemoryId', () => {
  it('reads the stored source vector, reuses parameterized query, and excludes itself', async () => {
    const connection = {
      runAndReadAll: vi.fn(async (_sql: string, _params: unknown[]) => ({
        getRowObjectsJson: () => [{ embedding: [0.1, 0.2] }]
      }))
    }
    const store = Object.create(MemoryVectorStore.prototype) as QueryableStore
    store.connection = connection
    store.vectorTable = 'memory_vector'
    store.query = vi.fn(async () => [
      { memoryId: 'm1', distance: 0 },
      { memoryId: 'm2', distance: 0.12 },
      { memoryId: 'm3', distance: 0.2 }
    ])

    const matches = await store.queryByMemoryId('m1', { topK: 2 })

    expect(matches).toEqual([
      { memoryId: 'm2', distance: 0.12 },
      { memoryId: 'm3', distance: 0.2 }
    ])
    expect(connection.runAndReadAll).toHaveBeenCalledWith(
      expect.stringContaining('SELECT embedding'),
      ['m1']
    )
    expect(store.query).toHaveBeenCalledWith([0.1, 0.2], { topK: 3 })
  })

  it('returns no neighbors when the source vector is missing or malformed', async () => {
    const connection = {
      runAndReadAll: vi.fn(async () => ({
        getRowObjectsJson: () => []
      }))
    }
    const store = Object.create(MemoryVectorStore.prototype) as QueryableStore
    store.connection = connection
    store.vectorTable = 'memory_vector'
    store.query = vi.fn(async () => [])

    await expect(store.queryByMemoryId('missing', { topK: 2 })).resolves.toEqual([])
    expect(store.query).not.toHaveBeenCalled()

    connection.runAndReadAll.mockResolvedValueOnce({
      getRowObjectsJson: () => [{ embedding: ['bad'] }]
    })
    await expect(store.queryByMemoryId('bad', { topK: 2 })).resolves.toEqual([])
    expect(store.query).not.toHaveBeenCalled()
  })
})

describe('MemoryVectorStore.query exact scan', () => {
  it('uses core array distance ordering without VSS statements', async () => {
    const connection = {
      runAndReadAll: vi.fn(async (_sql: string, _params: unknown[]) => ({
        getRowObjectsJson: () => [
          { memory_id: 'm2', distance: 0.1 },
          { memory_id: 'm1', distance: 0.2 }
        ]
      }))
    }
    const store = Object.create(MemoryVectorStore.prototype) as ExactQueryableStore
    store.connection = connection
    store.vectorTable = 'memory_vector'
    store.metric = 'cosine'

    await expect(store.query([0.1, 0.2], { topK: 2 })).resolves.toEqual([
      { memoryId: 'm2', distance: 0.1 },
      { memoryId: 'm1', distance: 0.2 }
    ])
    const sql = String(connection.runAndReadAll.mock.calls[0][0])
    expect(sql).toContain('array_cosine_distance')
    expect(sql).toContain('ORDER BY distance')
    expect(sql).not.toMatch(/LOAD|INSTALL|HNSW/i)
  })
})

describe('MemoryVectorStore.listMemoryIds', () => {
  it('uses keyset pagination and a bounded limit', async () => {
    const connection = {
      runAndReadAll: vi.fn(async () => ({
        getRowObjectsJson: () => [{ memory_id: 'm2' }, { memory_id: 'm3' }]
      }))
    }
    const store = Object.create(MemoryVectorStore.prototype) as ListableStore
    store.connection = connection
    store.vectorTable = 'memory_vector'

    await expect(store.listMemoryIds('m1', 2)).resolves.toEqual(['m2', 'm3'])

    expect(connection.runAndReadAll).toHaveBeenCalledWith(
      expect.stringContaining('memory_id > ?'),
      ['m1', 2]
    )
  })

  it('returns early for a zero limit', async () => {
    const connection = {
      runAndReadAll: vi.fn()
    }
    const store = Object.create(MemoryVectorStore.prototype) as ListableStore
    store.connection = connection
    store.vectorTable = 'memory_vector'

    await expect(store.listMemoryIds(null, 0)).resolves.toEqual([])
    expect(connection.runAndReadAll).not.toHaveBeenCalled()
  })
})

interface EmbeddingMeta {
  provider: string
  model: string
  dim: number
  formatVersion: number
}

interface OpenableStore {
  usable: boolean
  vectorTable: string
  metaTable: string
  dbPath: string
  connection: { runAndReadAll: ReturnType<typeof vi.fn> }
  connect(): Promise<void>
  open(expectedDim: number, embedding: { providerId: string; modelId: string }): Promise<void>
  isUsable(): boolean
}

interface VssLoadableStore {
  dbPath: string
  connection: { run: ReturnType<typeof vi.fn> }
  loadVss(): Promise<void>
}

function v2SchemaRows(dimensions: number, includeFormatVersion = true) {
  return [
    { table_name: 'memory_vector', column_name: 'memory_id', data_type: 'VARCHAR' },
    {
      table_name: 'memory_vector',
      column_name: 'embedding',
      data_type: `FLOAT[${dimensions}]`
    },
    { table_name: 'embedding_meta', column_name: 'provider', data_type: 'VARCHAR' },
    { table_name: 'embedding_meta', column_name: 'model', data_type: 'VARCHAR' },
    { table_name: 'embedding_meta', column_name: 'dim', data_type: 'INTEGER' },
    ...(includeFormatVersion
      ? [
          {
            table_name: 'embedding_meta',
            column_name: 'format_version',
            data_type: 'INTEGER'
          }
        ]
      : [])
  ]
}

function mockV2DuckDbLifecycle(
  paths: MemoryVectorStorePaths,
  options: {
    dimensions?: number
    includeFormatVersion?: boolean
    failFinalOpen?: boolean
    finalOpenError?: Error
    currentReadError?: Error
    onFinalOpen?: () => void
    leaveStagingWal?: boolean
    legacyRows?: MemoryVectorRecord[]
    legacyMetaRows?: Array<{ provider: unknown; model: unknown; dim: unknown }>
    legacyMetaColumns?: string[]
    legacyReadError?: Error
    legacyReadGate?: Promise<void>
    onLegacyRead?: () => void
    beforeLegacyPage?: (pageIndex: number) => Promise<void> | void
    failTargetInsert?: Error
    targetRowCountOverride?: number
    stagingRunError?: Error
    stagingCloseError?: Error
  } = {}
) {
  const dimensions = options.dimensions ?? 2
  const sql: string[] = []
  const legacySql: string[] = []
  const connections: Array<{ closeSync: ReturnType<typeof vi.fn> }> = []
  let targetRowCount = 0
  let legacyPageIndex = 0
  duckDbMocks.create.mockImplementation(async (dbPath: string) => {
    if (dbPath === ':memory:') {
      const connection = {
        run: vi.fn(async (statement: string) => {
          legacySql.push(statement)
          return undefined
        }),
        runAndReadAll: vi.fn(async (statement: string, params: unknown[] = []) => {
          legacySql.push(statement)
          options.onLegacyRead?.()
          if (options.legacyReadGate) await options.legacyReadGate
          if (options.legacyReadError) throw options.legacyReadError
          if (statement.includes('information_schema.columns')) {
            return {
              getRowObjectsJson: () =>
                (options.legacyMetaColumns ?? ['provider', 'model', 'dim']).map((column_name) => ({
                  column_name
                }))
            }
          }
          if (statement.includes('SELECT provider, model, dim')) {
            return {
              getRowObjectsJson: () =>
                options.legacyMetaRows ?? [{ provider: 'p', model: 'm', dim: dimensions }]
            }
          }
          const rows = options.legacyRows ?? []
          if (statement.includes('count(*) AS row_count')) {
            return { getRowObjectsJson: () => [{ row_count: rows.length }] }
          }
          await options.beforeLegacyPage?.(legacyPageIndex++)
          const afterId = statement.includes('memory_id > ?') ? String(params[0]) : null
          const limit = Number(params[params.length - 1])
          const page = rows
            .filter((row) => afterId === null || row.memoryId > afterId)
            .slice(0, limit)
            .map((row) => ({ memory_id: row.memoryId, embedding: row.embedding }))
          return { getRowObjectsJson: () => page }
        }),
        closeSync: vi.fn()
      }
      connections.push(connection)
      return {
        connect: vi.fn(async () => connection),
        closeSync: vi.fn()
      }
    }
    if (dbPath === paths.current && (options.finalOpenError || options.failFinalOpen)) {
      throw options.finalOpenError ?? new Error('final open failed')
    }
    if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, '')
    if (dbPath === paths.current) options.onFinalOpen?.()
    const connection = {
      run: vi.fn(async (statement: string, params: unknown[] = []) => {
        sql.push(statement)
        if (dbPath === paths.staging && options.stagingRunError) {
          throw options.stagingRunError
        }
        if (statement.includes('INSERT INTO memory_vector')) {
          if (options.failTargetInsert) throw options.failTargetInsert
          targetRowCount += params.length / 2
        }
        if (statement.includes('CHECKPOINT') && options.leaveStagingWal) {
          fs.writeFileSync(`${paths.staging}.wal`, 'wal')
        }
        return undefined
      }),
      runAndReadAll: vi.fn(async (statement: string) => {
        if (dbPath === paths.current && options.currentReadError) throw options.currentReadError
        return {
          getRowObjectsJson: () => {
            if (statement.includes('information_schema.columns')) {
              return v2SchemaRows(dimensions, options.includeFormatVersion ?? true)
            }
            if (statement.includes('count(*) AS row_count')) {
              return [{ row_count: options.targetRowCountOverride ?? targetRowCount }]
            }
            return [
              {
                provider: 'p',
                model: 'm',
                dim: dimensions,
                format_version: 2
              }
            ]
          }
        }
      }),
      closeSync: vi.fn(() => {
        if (dbPath === paths.staging && options.stagingCloseError) {
          throw options.stagingCloseError
        }
      })
    }
    connections.push(connection)
    return {
      connect: vi.fn(async () => connection),
      closeSync: vi.fn()
    }
  })
  return { sql, legacySql, connections }
}

async function setupRealFileSystem() {
  const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')
  const bundledVssPath = path.join(
    app.getAppPath(),
    'runtime',
    'duckdb',
    'extensions',
    'vss.duckdb_extension'
  )
  vi.spyOn(fs, 'existsSync').mockImplementation((target) =>
    String(target) === bundledVssPath ? true : actualFs.existsSync(target)
  )
  vi.spyOn(fs, 'readFileSync').mockImplementation(actualFs.readFileSync)
  vi.spyOn(fs, 'readdirSync').mockImplementation(actualFs.readdirSync)
  vi.spyOn(fs, 'writeFileSync').mockImplementation(actualFs.writeFileSync)
  vi.spyOn(fs, 'mkdirSync').mockImplementation(actualFs.mkdirSync)
  vi.spyOn(fs, 'rmSync').mockImplementation(actualFs.rmSync)
  vi.spyOn(fs, 'renameSync').mockImplementation(actualFs.renameSync)
  return actualFs
}

// meta: undefined => meta table missing (legacy file); null => present but empty; object => stored identity.
function makeOpenableStore(opts: { meta?: EmbeddingMeta | null }) {
  const store = Object.create(MemoryVectorStore.prototype) as unknown as OpenableStore
  store.usable = true
  store.vectorTable = 'memory_vector'
  store.metaTable = 'embedding_meta'
  store.dbPath = '/tmp/agent-x.duckdb'
  store.connection = {
    runAndReadAll: vi.fn(async (sql: string) => {
      if (sql.includes('information_schema.columns')) {
        const rows = [
          { table_name: 'memory_vector', column_name: 'memory_id', data_type: 'VARCHAR' },
          { table_name: 'memory_vector', column_name: 'embedding', data_type: 'FLOAT[2]' },
          ...(opts.meta === undefined
            ? []
            : [
                { table_name: 'embedding_meta', column_name: 'provider', data_type: 'VARCHAR' },
                { table_name: 'embedding_meta', column_name: 'model', data_type: 'VARCHAR' },
                { table_name: 'embedding_meta', column_name: 'dim', data_type: 'INTEGER' },
                {
                  table_name: 'embedding_meta',
                  column_name: 'format_version',
                  data_type: 'INTEGER'
                }
              ])
        ]
        return { getRowObjectsJson: () => rows }
      }
      return {
        getRowObjectsJson: () =>
          opts.meta
            ? [
                {
                  provider: opts.meta.provider,
                  model: opts.meta.model,
                  dim: opts.meta.dim,
                  format_version: opts.meta.formatVersion
                }
              ]
            : []
      }
    })
  }
  store.connect = async () => undefined
  return store
}

function makeVssLoadableStore(
  onRun: (sql: string) => void = () => {},
  dbPath = '/tmp/agent.duckdb'
) {
  const connection = {
    run: vi.fn(async (sql: string) => {
      onRun(sql)
      return undefined
    })
  }
  return {
    dbPath,
    connection,
    loadVss: () => loadLegacyVss(connection, dbPath)
  } satisfies VssLoadableStore
}

async function setupPackagedBase64Fixture(asset: Buffer) {
  const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')
  const mockedPromises = fs.promises as typeof fs.promises & {
    rename: typeof actualFs.promises.rename
    rm: typeof actualFs.promises.rm
  }
  mockedPromises.rename ??= vi.fn()
  mockedPromises.rm ??= vi.fn()
  const userDataDir = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-vss-user-data-'))
  const originalExistsSync = actualFs.existsSync
  const originalReadFile = actualFs.promises.readFile
  vi.spyOn(app, 'getPath').mockReturnValue(userDataDir)
  vi.spyOn(fs, 'existsSync').mockImplementation((target) => {
    const filePath = String(target)
    if (/(^|[/\\])runtime[/\\]duckdb[/\\]extensions[/\\]vss\.duckdb_extension$/.test(filePath)) {
      return false
    }
    if (
      /(^|[/\\])runtime[/\\]duckdb[/\\]extensions[/\\]vss\.duckdb_extension\.b64$/.test(filePath)
    ) {
      return true
    }
    return originalExistsSync(target)
  })
  const readFile = vi.spyOn(fs.promises, 'readFile').mockImplementation((async (
    target,
    options
  ) => {
    if (String(target).endsWith('vss.duckdb_extension.b64')) return asset
    return originalReadFile(target, options)
  }) as typeof fs.promises.readFile)
  const mkdir = vi
    .spyOn(fs.promises, 'mkdir')
    .mockImplementation(actualFs.promises.mkdir as typeof fs.promises.mkdir)
  const writeFile = vi
    .spyOn(fs.promises, 'writeFile')
    .mockImplementation(actualFs.promises.writeFile as typeof fs.promises.writeFile)
  const rename = vi
    .spyOn(mockedPromises, 'rename')
    .mockImplementation(actualFs.promises.rename as typeof fs.promises.rename)
  vi.spyOn(mockedPromises, 'rm').mockImplementation(actualFs.promises.rm as typeof fs.promises.rm)

  return { actualFs, userDataDir, readFile, mkdir, writeFile, rename }
}

afterEach(() => {
  mutableApp.isPackaged = false
  duckDbMocks.create.mockReset()
  vi.restoreAllMocks()
})

describe('DuckDB fatal error classification', () => {
  it.each([
    new Error('INTERNAL Error: assertion failed'),
    new Error('Fatal Error: database is corrupted'),
    new Error('Database has been invalidated'),
    new Error('Failed to add to the HNSW index: Duplicate keys not allowed')
  ])('classifies terminal native failures', (error) => {
    expect(isDuckDbFatalError(error)).toBe(true)
  })

  it('walks causes without classifying ordinary IO and validation errors', () => {
    expect(isDuckDbFatalError(new Error('wrapper', { cause: new Error('INTERNAL Error') }))).toBe(
      true
    )
    expect(isDuckDbFatalError(new Error('EBUSY: file locked'))).toBe(false)
    expect(isDuckDbFatalError(new Error('format_version mismatch'))).toBe(false)
  })
})

describe('MemoryVectorStore v2 staged publish', () => {
  it('builds at staging, checkpoints, renames, and opens without VSS or HNSW', async () => {
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-v2-'))
    const paths = createMemoryVectorStorePaths(root, 'agent-a')
    const { sql } = mockV2DuckDbLifecycle(paths)

    try {
      const store = await MemoryVectorStore.create(paths, 2, EMB)

      expect(fs.existsSync(paths.current)).toBe(true)
      expect(fs.existsSync(paths.staging)).toBe(false)
      expect(sql.some((statement) => statement.includes('CHECKPOINT'))).toBe(true)
      expect(sql.some((statement) => /LOAD|INSTALL|HNSW|hnsw_/i.test(statement))).toBe(false)
      expect(sql.some((statement) => statement.includes('format_version'))).toBe(true)
      await store.close()
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('retains the initialization cause when closing a failed fresh store also fails', async () => {
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-close-cause-'))
    const paths = createMemoryVectorStorePaths(root, 'agent-a')
    const initializationError = new Error('initialization failed')
    mockV2DuckDbLifecycle(paths, {
      stagingRunError: initializationError,
      stagingCloseError: new Error('close failed')
    })

    try {
      const failure = await MemoryVectorStore.create(paths, 2, EMB).catch((error) => error)

      expect(failure).toBeInstanceOf(MemoryVectorStoreTerminalRecoveryError)
      expect(failure).toMatchObject({
        cause: initializationError,
        recoveryCause: expect.objectContaining({ message: expect.stringContaining('close failed') })
      })
      expect(fs.existsSync(paths.staging)).toBe(true)
    } finally {
      actualFs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('retains the initialization cause when failed fresh-store cleanup is blocked', async () => {
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-cleanup-cause-'))
    const paths = createMemoryVectorStorePaths(root, 'agent-a')
    const initializationError = new Error('initialization failed')
    mockV2DuckDbLifecycle(paths, { stagingRunError: initializationError })
    vi.mocked(fs.rmSync).mockImplementation((target, options) => {
      if (String(target) === paths.staging && actualFs.existsSync(target)) {
        throw Object.assign(new Error('staging busy'), { code: 'EBUSY' })
      }
      return actualFs.rmSync(target, options)
    })

    try {
      const failure = await MemoryVectorStore.create(paths, 2, EMB).catch((error) => error)

      expect(failure).toBeInstanceOf(MemoryVectorStoreTerminalRecoveryError)
      expect(failure).toMatchObject({
        cause: initializationError,
        recoveryCause: expect.objectContaining({ message: expect.stringContaining('staging busy') })
      })
      expect(fs.existsSync(paths.staging)).toBe(true)
    } finally {
      actualFs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('uses a static and disjoint path for every store role', () => {
    const paths = createMemoryVectorStorePaths('/data/AgentMemory', 'agent-a')

    expect(paths).toEqual({
      current: path.join('/data/AgentMemory', 'agent-a.v2.duckdb'),
      staging: path.join('/data/AgentMemory', 'agent-a.v2.duckdb.migrating'),
      quarantine: path.join('/data/AgentMemory', 'agent-a.v2.duckdb.quarantine'),
      legacy: path.join('/data/AgentMemory', 'agent-a.duckdb')
    })
    expect(new Set(Object.values(paths)).size).toBe(4)
  })

  it('rebuilds a legacy store with WAL without opening the suspect v1 database', async () => {
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-v1-'))
    const paths = createMemoryVectorStorePaths(root, 'agent-a')
    fs.writeFileSync(paths.legacy, 'legacy')
    fs.writeFileSync(`${paths.legacy}.wal`, 'wal')
    mockV2DuckDbLifecycle(paths)

    try {
      const store = await MemoryVectorStore.create(paths, 2, EMB)
      expect(fs.existsSync(paths.legacy)).toBe(false)
      expect(fs.existsSync(`${paths.legacy}.wal`)).toBe(false)
      expect(fs.existsSync(paths.current)).toBe(true)
      expect(fs.existsSync(paths.staging)).toBe(false)
      expect(duckDbMocks.create).not.toHaveBeenCalledWith(':memory:')
      await store.close()
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('preserves a WAL-free legacy store through read-only keyset paging', async () => {
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-preserve-'))
    const paths = createMemoryVectorStorePaths(root, 'agent-a')
    fs.writeFileSync(paths.legacy, 'legacy')
    const legacyRows = Array.from({ length: 51 }, (_, index) => ({
      memoryId: `m${String(index + 1).padStart(3, '0')}`,
      embedding: [index, index + 1]
    }))
    const { legacySql } = mockV2DuckDbLifecycle(paths, { legacyRows })

    try {
      const store = await MemoryVectorStore.create(paths, 2, EMB)
      expect(store.isUsable()).toBe(true)
      expect(fs.existsSync(paths.current)).toBe(true)
      expect(fs.existsSync(paths.legacy)).toBe(false)
      expect(legacySql.some((statement) => /ATTACH .*\(READ_ONLY\)/.test(statement))).toBe(true)
      expect(legacySql.some((statement) => statement.includes('memory_id > ?'))).toBe(true)
      await store.close()
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it.each([
    {
      name: 'same-dimension model change',
      legacyMetaRows: [{ provider: 'p', model: 'old-model', dim: 2 }]
    },
    {
      name: 'provider change',
      legacyMetaRows: [{ provider: 'old-provider', model: 'm', dim: 2 }]
    },
    {
      name: 'dimension change',
      legacyMetaRows: [{ provider: 'p', model: 'm', dim: 4 }]
    },
    {
      name: 'duplicate metadata',
      legacyMetaRows: [
        { provider: 'p', model: 'm', dim: 2 },
        { provider: 'p', model: 'm', dim: 2 }
      ]
    },
    {
      name: 'malformed metadata',
      legacyMetaRows: [{ provider: '', model: 'm', dim: 2 }]
    }
  ])('safely rebuilds instead of preserving on $name', async ({ legacyMetaRows }) => {
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-meta-rebuild-'))
    const paths = createMemoryVectorStorePaths(root, 'agent-a')
    fs.writeFileSync(paths.legacy, 'legacy')
    const { legacySql, sql } = mockV2DuckDbLifecycle(paths, {
      legacyRows: [{ memoryId: 'm1', embedding: [0.1, 0.2] }],
      legacyMetaRows
    })

    try {
      const store = await MemoryVectorStore.create(paths, 2, EMB)

      expect(store.isUsable()).toBe(true)
      expect(fs.existsSync(paths.current)).toBe(true)
      expect(fs.existsSync(paths.legacy)).toBe(false)
      expect(legacySql.some((statement) => statement.includes('SELECT memory_id'))).toBe(false)
      expect(sql.some((statement) => statement.includes('INSERT INTO memory_vector'))).toBe(false)
      await store.close()
    } finally {
      actualFs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('safely rebuilds when legacy metadata is missing', async () => {
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-meta-missing-'))
    const paths = createMemoryVectorStorePaths(root, 'agent-a')
    fs.writeFileSync(paths.legacy, 'legacy')
    const { legacySql } = mockV2DuckDbLifecycle(paths, {
      legacyRows: [{ memoryId: 'm1', embedding: [0.1, 0.2] }],
      legacyMetaColumns: []
    })

    try {
      const store = await MemoryVectorStore.create(paths, 2, EMB)

      expect(store.isUsable()).toBe(true)
      expect(fs.existsSync(paths.legacy)).toBe(false)
      expect(legacySql.some((statement) => statement.includes('SELECT provider'))).toBe(false)
      await store.close()
    } finally {
      actualFs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('quarantines native legacy metadata read failures without closing or deleting', async () => {
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-meta-failure-'))
    const paths = createMemoryVectorStorePaths(root, 'agent-a')
    fs.writeFileSync(paths.legacy, 'legacy')
    const { connections } = mockV2DuckDbLifecycle(paths, {
      legacyReadError: new Error('INTERNAL metadata failure')
    })

    try {
      await expect(MemoryVectorStore.create(paths, 2, EMB)).rejects.toMatchObject({
        name: 'MemoryVectorStoreQuarantineRequiredError'
      })
      expect(fs.existsSync(paths.legacy)).toBe(true)
      expect(fs.existsSync(paths.current)).toBe(false)
      expect(connections.every((connection) => !connection.closeSync.mock.calls.length)).toBe(true)
    } finally {
      actualFs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('safely rebuilds without network install when legacy VSS is unavailable', async () => {
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-vss-missing-'))
    const paths = createMemoryVectorStorePaths(root, 'agent-a')
    fs.writeFileSync(paths.legacy, 'legacy')
    vi.mocked(fs.existsSync).mockImplementation((target) => {
      const filePath = String(target)
      if (
        filePath.endsWith('vss.duckdb_extension') ||
        filePath.endsWith('vss.duckdb_extension.b64')
      ) {
        return false
      }
      return actualFs.existsSync(target)
    })
    const { connections, legacySql } = mockV2DuckDbLifecycle(paths, {
      legacyRows: [{ memoryId: 'm1', embedding: [0.1, 0.2] }]
    })

    try {
      const store = await MemoryVectorStore.create(paths, 2, EMB)

      expect(store.isUsable()).toBe(true)
      expect(fs.existsSync(paths.legacy)).toBe(false)
      expect(legacySql.some((statement) => /INSTALL|ATTACH/.test(statement))).toBe(false)
      expect(connections[0].closeSync).toHaveBeenCalledTimes(1)
      await store.close()
    } finally {
      actualFs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('abandons native preserve failures without rollback, close, or file deletion', async () => {
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-preserve-fail-'))
    const paths = createMemoryVectorStorePaths(root, 'agent-a')
    fs.writeFileSync(paths.legacy, 'legacy')
    const { connections, sql } = mockV2DuckDbLifecycle(paths, {
      legacyRows: [{ memoryId: 'm1', embedding: [0.1, 0.2] }],
      failTargetInsert: new Error('target insert failed')
    })

    try {
      await expect(MemoryVectorStore.create(paths, 2, EMB)).rejects.toMatchObject({
        name: 'MemoryVectorStoreQuarantineRequiredError'
      })
      expect(fs.existsSync(paths.legacy)).toBe(true)
      expect(fs.existsSync(paths.staging)).toBe(true)
      expect(fs.existsSync(paths.current)).toBe(false)
      expect(fs.existsSync(paths.quarantine)).toBe(false)
      expect(sql.some((statement) => statement.includes('ROLLBACK'))).toBe(false)
      expect(connections.every((connection) => !connection.closeSync.mock.calls.length)).toBe(true)
    } finally {
      actualFs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('quarantines a preserve row-count mismatch before rename', async () => {
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-count-mismatch-'))
    const paths = createMemoryVectorStorePaths(root, 'agent-a')
    fs.writeFileSync(paths.legacy, 'legacy')
    mockV2DuckDbLifecycle(paths, {
      legacyRows: [{ memoryId: 'm1', embedding: [0.1, 0.2] }],
      targetRowCountOverride: 0
    })

    try {
      await expect(MemoryVectorStore.create(paths, 2, EMB)).rejects.toMatchObject({
        name: 'MemoryVectorStoreQuarantineRequiredError'
      })
      expect(fs.existsSync(paths.current)).toBe(false)
      expect(fs.existsSync(paths.staging)).toBe(true)
      expect(fs.existsSync(paths.legacy)).toBe(true)
    } finally {
      actualFs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('fences a preserve timeout so a late read cannot resume migration side effects', async () => {
    vi.useFakeTimers()
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-preserve-timeout-'))
    const paths = createMemoryVectorStorePaths(root, 'agent-a')
    fs.writeFileSync(paths.legacy, 'legacy')
    let releaseRead!: () => void
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    let notifyReadStarted!: () => void
    const readStarted = new Promise<void>((resolve) => {
      notifyReadStarted = resolve
    })
    const { connections } = mockV2DuckDbLifecycle(paths, {
      legacyRows: [{ memoryId: 'm1', embedding: [0.1, 0.2] }],
      legacyReadGate: readGate,
      onLegacyRead: notifyReadStarted
    })

    try {
      const pending = MemoryVectorStore.create(paths, 2, EMB)
      const rejection = expect(pending).rejects.toMatchObject({
        name: 'MemoryVectorStoreQuarantineRequiredError'
      })
      await readStarted
      await vi.advanceTimersByTimeAsync(60_000)
      await rejection

      releaseRead()
      await vi.runAllTimersAsync()
      await Promise.resolve()
      expect(fs.existsSync(paths.legacy)).toBe(true)
      expect(fs.existsSync(paths.staging)).toBe(false)
      expect(fs.existsSync(paths.current)).toBe(false)
      expect(connections.every((connection) => !connection.closeSync.mock.calls.length)).toBe(true)
    } finally {
      vi.useRealTimers()
      actualFs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('refreshes the idle deadline on progress and uses one insert-only transaction', async () => {
    vi.useFakeTimers()
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-progress-'))
    const paths = createMemoryVectorStorePaths(root, 'agent-a')
    fs.writeFileSync(paths.legacy, 'legacy')
    const legacyRows = Array.from({ length: 101 }, (_, index) => ({
      memoryId: `m${String(index + 1).padStart(3, '0')}`,
      embedding: [index, index + 1]
    }))
    const pageGates = Array.from({ length: 3 }, () => {
      let release!: () => void
      const promise = new Promise<void>((resolve) => {
        release = resolve
      })
      return { promise, release }
    })
    const pageStarts = Array.from({ length: 3 }, () => {
      let notify!: () => void
      const promise = new Promise<void>((resolve) => {
        notify = resolve
      })
      return { promise, notify }
    })
    const { sql } = mockV2DuckDbLifecycle(paths, {
      legacyRows,
      beforeLegacyPage: async (pageIndex) => {
        pageStarts[pageIndex].notify()
        await pageGates[pageIndex].promise
      }
    })

    try {
      const pending = MemoryVectorStore.create(paths, 2, EMB)
      for (let pageIndex = 0; pageIndex < pageGates.length; pageIndex += 1) {
        await pageStarts[pageIndex].promise
        await vi.advanceTimersByTimeAsync(50_000)
        pageGates[pageIndex].release()
      }
      const store = await pending

      expect(sql.filter((statement) => statement.includes('BEGIN TRANSACTION')).length).toBe(1)
      expect(sql.filter((statement) => statement.includes('COMMIT')).length).toBe(1)
      expect(sql.some((statement) => statement.includes('DELETE FROM memory_vector'))).toBe(false)
      expect(
        sql.filter((statement) => statement.includes('INSERT INTO memory_vector')).length
      ).toBe(3)
      await store.close()
    } finally {
      vi.useRealTimers()
      actualFs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('cleans either kind of staging residue before a fresh publish', async () => {
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-staging-'))
    const paths = createMemoryVectorStorePaths(root, 'agent-a')
    fs.writeFileSync(`${paths.staging}.wal`, 'torn')
    mockV2DuckDbLifecycle(paths)

    try {
      const store = await MemoryVectorStore.create(paths, 2, EMB)
      expect(fs.existsSync(paths.current)).toBe(true)
      expect(fs.existsSync(paths.staging)).toBe(false)
      expect(fs.existsSync(`${paths.staging}.wal`)).toBe(false)
      await store.close()
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('discards torn staging and restarts preserve from the intact legacy store', async () => {
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-torn-preserve-'))
    const paths = createMemoryVectorStorePaths(root, 'agent-a')
    fs.writeFileSync(paths.legacy, 'legacy')
    fs.writeFileSync(paths.staging, 'torn')
    fs.writeFileSync(`${paths.staging}.wal`, 'torn-wal')
    mockV2DuckDbLifecycle(paths, {
      legacyRows: [{ memoryId: 'm1', embedding: [0.1, 0.2] }]
    })

    try {
      const store = await MemoryVectorStore.create(paths, 2, EMB)
      expect(store.isUsable()).toBe(true)
      expect(fs.existsSync(paths.current)).toBe(true)
      expect(fs.existsSync(paths.staging)).toBe(false)
      expect(fs.existsSync(`${paths.staging}.wal`)).toBe(false)
      expect(fs.existsSync(paths.legacy)).toBe(false)
      await store.close()
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('removes the quarantine marker before publishing a fresh v2 store', async () => {
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-marker-'))
    const paths = createMemoryVectorStorePaths(root, 'agent-a')
    for (const filePath of [
      paths.current,
      `${paths.current}.wal`,
      paths.staging,
      `${paths.staging}.wal`,
      paths.legacy,
      `${paths.legacy}.wal`,
      paths.quarantine
    ]) {
      fs.writeFileSync(filePath, 'old')
    }
    mockV2DuckDbLifecycle(paths, {
      onFinalOpen: () => expect(fs.existsSync(paths.quarantine)).toBe(false)
    })

    try {
      const store = await MemoryVectorStore.create(paths, 2, EMB)
      expect(fs.existsSync(paths.current)).toBe(true)
      expect(fs.existsSync(paths.quarantine)).toBe(false)
      expect(fs.existsSync(paths.legacy)).toBe(false)
      await store.close()
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('allows the terminal layer to re-persist marker after a fresh publish failure', async () => {
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-marker-retry-'))
    const paths = createMemoryVectorStorePaths(root, 'agent-a')
    fs.writeFileSync(paths.quarantine, 'old')
    mockV2DuckDbLifecycle(paths, { leaveStagingWal: true })

    try {
      await expect(MemoryVectorStore.create(paths, 2, EMB)).rejects.toMatchObject({
        name: 'MemoryVectorStoreTerminalRecoveryError',
        message: expect.stringContaining('staged v2 WAL remains')
      })
      expect(fs.existsSync(paths.quarantine)).toBe(false)
      expect(fs.existsSync(paths.current)).toBe(false)

      MemoryVectorStore.markQuarantined(paths)
      duckDbMocks.create.mockReset()
      mockV2DuckDbLifecycle(paths)
      const store = await MemoryVectorStore.create(paths, 2, EMB)
      expect(store.isUsable()).toBe(true)
      expect(fs.existsSync(paths.current)).toBe(true)
      expect(fs.existsSync(paths.quarantine)).toBe(false)
      await store.close()
    } finally {
      actualFs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('publishes nothing when quarantine marker removal fails', async () => {
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-marker-failure-'))
    const paths = createMemoryVectorStorePaths(root, 'agent-a')
    fs.writeFileSync(paths.quarantine, 'old')
    mockV2DuckDbLifecycle(paths)
    vi.mocked(fs.rmSync).mockImplementation((target, options) => {
      if (String(target) === paths.quarantine) {
        throw Object.assign(new Error('marker busy'), { code: 'EBUSY' })
      }
      return actualFs.rmSync(target, options)
    })

    try {
      await expect(MemoryVectorStore.create(paths, 2, EMB)).rejects.toMatchObject({
        name: 'MemoryVectorStoreTerminalRecoveryError'
      })
      expect(fs.existsSync(paths.current)).toBe(false)
      expect(fs.existsSync(paths.quarantine)).toBe(true)
      expect(duckDbMocks.create).not.toHaveBeenCalled()
    } finally {
      actualFs.rmSync(root, { recursive: true, force: true })
    }
  })

  it.each([
    {
      name: 'staging residue',
      createResidue: (paths: MemoryVectorStorePaths) => [paths.staging],
      busyPath: (paths: MemoryVectorStorePaths) => paths.staging
    },
    {
      name: 'legacy WAL recovery',
      createResidue: (paths: MemoryVectorStorePaths) => [paths.legacy, `${paths.legacy}.wal`],
      busyPath: (paths: MemoryVectorStorePaths) => `${paths.legacy}.wal`
    },
    {
      name: 'orphan current WAL recovery',
      createResidue: (paths: MemoryVectorStorePaths) => [`${paths.current}.wal`],
      busyPath: (paths: MemoryVectorStorePaths) => `${paths.current}.wal`
    }
  ])('makes $name cleanup failure terminal before opening DuckDB', async (testCase) => {
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-cleanup-failure-'))
    const paths = createMemoryVectorStorePaths(root, 'agent-a')
    for (const filePath of testCase.createResidue(paths)) fs.writeFileSync(filePath, 'old')
    const busyPath = testCase.busyPath(paths)
    vi.mocked(fs.rmSync).mockImplementation((target, options) => {
      if (String(target) === busyPath) {
        throw Object.assign(new Error('file busy'), { code: 'EBUSY' })
      }
      return actualFs.rmSync(target, options)
    })

    try {
      await expect(MemoryVectorStore.create(paths, 2, EMB)).rejects.toMatchObject({
        name: 'MemoryVectorStoreTerminalRecoveryError'
      })
      expect(duckDbMocks.create).not.toHaveBeenCalled()
    } finally {
      actualFs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('removes an orphan current WAL before a fresh publication', async () => {
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-orphan-wal-'))
    const paths = createMemoryVectorStorePaths(root, 'agent-a')
    fs.writeFileSync(`${paths.current}.wal`, 'orphan')
    mockV2DuckDbLifecycle(paths)

    try {
      const store = await MemoryVectorStore.create(paths, 2, EMB)
      expect(fs.existsSync(`${paths.current}.wal`)).toBe(false)
      expect(fs.existsSync(paths.current)).toBe(true)
      await store.close()
    } finally {
      actualFs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('opens a committed v2 with residual WAL and treats legacy cleanup as best effort', async () => {
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-authority-'))
    const paths = createMemoryVectorStorePaths(root, 'agent-a')
    fs.writeFileSync(paths.current, 'v2')
    fs.writeFileSync(`${paths.current}.wal`, 'safe-wal')
    fs.writeFileSync(paths.legacy, 'legacy')
    mockV2DuckDbLifecycle(paths)
    vi.mocked(fs.rmSync).mockImplementation((target, options) => {
      if (String(target) === paths.legacy) {
        throw Object.assign(new Error('legacy busy'), { code: 'EBUSY' })
      }
      return actualFs.rmSync(target, options)
    })

    try {
      const store = await MemoryVectorStore.create(paths, 2, EMB)
      expect(store.isUsable()).toBe(true)
      expect(fs.readFileSync(paths.current, 'utf8')).toBe('v2')
      expect(fs.readFileSync(`${paths.current}.wal`, 'utf8')).toBe('safe-wal')
      expect(fs.readFileSync(paths.legacy, 'utf8')).toBe('legacy')
      await store.close()
    } finally {
      actualFs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('leaves the committed final file when post-rename open fails', async () => {
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-commit-'))
    const paths = createMemoryVectorStorePaths(root, 'agent-a')
    mockV2DuckDbLifecycle(paths, { failFinalOpen: true })

    try {
      await expect(MemoryVectorStore.create(paths, 2, EMB)).rejects.toBeInstanceOf(
        MemoryVectorStorePostCommitError
      )
      expect(fs.existsSync(paths.current)).toBe(true)
      expect(fs.existsSync(paths.staging)).toBe(false)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not close a current store after a fatal native metadata read', async () => {
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-current-fatal-'))
    const paths = createMemoryVectorStorePaths(root, 'agent-a')
    fs.writeFileSync(paths.current, 'v2')
    const { connections } = mockV2DuckDbLifecycle(paths, {
      currentReadError: new Error('INTERNAL Error: current metadata read failed')
    })

    try {
      await expect(MemoryVectorStore.create(paths, 2, EMB)).rejects.toMatchObject({
        name: 'MemoryVectorStoreTerminalRecoveryError',
        fatal: true
      })
      expect(connections).toHaveLength(1)
      expect(connections[0].closeSync).not.toHaveBeenCalled()
      expect(fs.existsSync(paths.current)).toBe(true)
    } finally {
      actualFs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('sweeps quarantined stores for agents that no longer exist', async () => {
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-startup-sweep-'))
    const paths = createMemoryVectorStorePaths(root, 'deleted-agent')
    for (const filePath of [paths.current, `${paths.legacy}.wal`, paths.quarantine]) {
      fs.writeFileSync(filePath, 'old')
    }

    try {
      MemoryVectorStore.recoverQuarantinedStores(root)
      expect(fs.readdirSync(root)).toEqual([])
    } finally {
      actualFs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('retains a deleted agent marker when its startup file sweep is blocked', async () => {
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-sweep-blocked-'))
    const paths = createMemoryVectorStorePaths(root, 'deleted-agent')
    fs.writeFileSync(paths.current, 'old')
    fs.writeFileSync(paths.quarantine, 'old')
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    vi.mocked(fs.rmSync).mockImplementation((target, options) => {
      if (String(target) === paths.current) {
        throw Object.assign(new Error('current busy'), { code: 'EBUSY' })
      }
      return actualFs.rmSync(target, options)
    })

    try {
      MemoryVectorStore.recoverQuarantinedStores(root)

      expect(fs.existsSync(paths.current)).toBe(true)
      expect(fs.existsSync(paths.quarantine)).toBe(true)
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining('startup quarantine sweep deferred')
      )
    } finally {
      actualFs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not quarantine a preserved store after the rename commit point', async () => {
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-preserve-commit-'))
    const paths = createMemoryVectorStorePaths(root, 'agent-a')
    fs.writeFileSync(paths.legacy, 'legacy')
    mockV2DuckDbLifecycle(paths, {
      legacyRows: [{ memoryId: 'm1', embedding: [0.1, 0.2] }],
      failFinalOpen: true
    })

    try {
      await expect(MemoryVectorStore.create(paths, 2, EMB)).rejects.toMatchObject({
        name: 'MemoryVectorStorePostCommitError'
      })
      expect(fs.existsSync(paths.current)).toBe(true)
      expect(fs.existsSync(paths.staging)).toBe(false)
      expect(fs.existsSync(paths.legacy)).toBe(true)
      expect(fs.existsSync(paths.quarantine)).toBe(false)
    } finally {
      actualFs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects and removes staging when a WAL remains before the commit point', async () => {
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-wal-'))
    const paths = createMemoryVectorStorePaths(root, 'agent-a')
    mockV2DuckDbLifecycle(paths, { leaveStagingWal: true })

    try {
      await expect(MemoryVectorStore.create(paths, 2, EMB)).rejects.toThrow('staged v2 WAL remains')
      expect(fs.existsSync(paths.current)).toBe(false)
      expect(fs.existsSync(paths.staging)).toBe(false)
      expect(fs.existsSync(`${paths.staging}.wal`)).toBe(false)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('sweeps every store role and marker during an explicit reset', async () => {
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-reset-'))
    const paths = createMemoryVectorStorePaths(root, 'agent-a')
    const files = [
      paths.current,
      `${paths.current}.wal`,
      paths.staging,
      `${paths.staging}.wal`,
      paths.legacy,
      `${paths.legacy}.wal`,
      paths.quarantine
    ]
    for (const filePath of files) fs.writeFileSync(filePath, 'old')

    try {
      MemoryVectorStore.destroyFiles(paths)
      expect(files.every((filePath) => !fs.existsSync(filePath))).toBe(true)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects invalid dimensions before interpolating them into schema SQL', async () => {
    const paths = createMemoryVectorStorePaths('/tmp/AgentMemory', 'agent-a')

    await expect(MemoryVectorStore.create(paths, Number.NaN, EMB)).rejects.toThrow(
      'invalid vector dimensions'
    )
    expect(duckDbMocks.create).not.toHaveBeenCalled()
  })

  it('creates the quarantine marker idempotently in a missing parent directory', async () => {
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-mark-'))
    const paths = createMemoryVectorStorePaths(path.join(root, 'nested'), 'agent-a')

    try {
      MemoryVectorStore.markQuarantined(paths)
      MemoryVectorStore.markQuarantined(paths)
      expect(fs.existsSync(paths.quarantine)).toBe(true)
    } finally {
      actualFs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('MemoryVectorStore.open identity guard (C5, AC-5.2/5.3)', () => {
  it('stays usable when stored identity matches', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const store = makeOpenableStore({
      meta: { provider: 'p', model: 'm', dim: 2, formatVersion: 2 }
    })
    await store.open(2, EMB)
    expect(store.isUsable()).toBe(true)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('disables and warns when the stored dim differs', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const store = makeOpenableStore({
      meta: { provider: 'p', model: 'm', dim: 4, formatVersion: 2 }
    })
    await store.open(2, EMB)
    expect(store.isUsable()).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('disables and warns when the stored model differs (same dim)', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const store = makeOpenableStore({
      meta: { provider: 'p', model: 'OLD', dim: 2, formatVersion: 2 }
    })
    await store.open(2, EMB)
    expect(store.isUsable()).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('legacy store (no meta table): fail-closed because identity is unverifiable', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const store = makeOpenableStore({})
    await store.open(2, EMB)
    expect(store.isUsable()).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('empty meta table: fail-closed because identity is unverifiable', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const store = makeOpenableStore({ meta: null })
    await store.open(2, EMB)
    expect(store.isUsable()).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('disables a renamed v1 store that lacks format_version', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const store = makeOpenableStore({})
    await store.open(2, EMB)
    expect(store.isUsable()).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('propagates native schema inspection failures instead of misclassifying them', async () => {
    const store = makeOpenableStore({
      meta: { provider: 'p', model: 'm', dim: 2, formatVersion: 2 }
    })
    store.connection.runAndReadAll.mockRejectedValueOnce(new Error('INTERNAL catalog failure'))

    await expect(store.open(2, EMB)).rejects.toThrow('INTERNAL catalog failure')
  })
})

describe('Legacy VSS loading', () => {
  it('fails closed in packaged builds when the bundled extension is missing', async () => {
    mutableApp.isPackaged = true
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const store = makeVssLoadableStore()

    await expect(store.loadVss()).rejects.toThrow(/bundled VSS extension missing/)

    expect(store.connection.run).not.toHaveBeenCalledWith('INSTALL vss;')
    expect(error).toHaveBeenCalled()
  })

  it('materializes packaged base64 VSS assets into userData before loading', async () => {
    mutableApp.isPackaged = true
    const asset = Buffer.from(
      gzipSync(Buffer.from('duckdb extension body')).toString('base64'),
      'utf8'
    )
    const { actualFs, userDataDir } = await setupPackagedBase64Fixture(asset)
    vi.spyOn(logger, 'info').mockImplementation(() => undefined)
    const store = makeVssLoadableStore(undefined, path.join(userDataDir, 'agent.duckdb'))

    try {
      await store.loadVss()
      const loadSql = store.connection.run.mock.calls[0][0] as string
      const [, loadedPath] = loadSql.match(/LOAD '([^']+)'/) ?? []

      expect(loadedPath).toBeTruthy()
      const materializedPath = loadedPath!
      expect(materializedPath).toContain(path.join(userDataDir, 'duckdb', 'extensions'))
      expect(actualFs.readFileSync(materializedPath)).toEqual(Buffer.from('duckdb extension body'))
      expect(store.connection.run).not.toHaveBeenCalledWith('INSTALL vss;')
      expect(store.connection.run).toHaveBeenCalledWith(
        'SET hnsw_enable_experimental_persistence = true;'
      )
    } finally {
      actualFs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  it('coalesces packaged base64 materialization across stores in the same process', async () => {
    mutableApp.isPackaged = true
    const asset = Buffer.from(
      gzipSync(Buffer.from('coalesced duckdb extension body')).toString('base64'),
      'utf8'
    )
    const { actualFs, userDataDir, readFile, writeFile, rename } =
      await setupPackagedBase64Fixture(asset)
    vi.spyOn(logger, 'info').mockImplementation(() => undefined)
    const first = makeVssLoadableStore(undefined, path.join(userDataDir, 'a.duckdb'))
    const second = makeVssLoadableStore(undefined, path.join(userDataDir, 'b.duckdb'))

    try {
      await Promise.all([first.loadVss(), second.loadVss()])

      const firstLoadSql = first.connection.run.mock.calls[0][0] as string
      const secondLoadSql = second.connection.run.mock.calls[0][0] as string
      const [, firstLoadedPath] = firstLoadSql.match(/LOAD '([^']+)'/) ?? []
      const [, secondLoadedPath] = secondLoadSql.match(/LOAD '([^']+)'/) ?? []

      expect(firstLoadedPath).toBeTruthy()
      expect(secondLoadedPath).toBe(firstLoadedPath)
      expect(readFile).toHaveBeenCalledTimes(1)
      expect(writeFile).toHaveBeenCalledTimes(1)
      expect(rename).toHaveBeenCalledTimes(1)
      expect(actualFs.readFileSync(firstLoadedPath!)).toEqual(
        Buffer.from('coalesced duckdb extension body')
      )
    } finally {
      actualFs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  it('keeps shared VSS materialization neutral to each migration fence', async () => {
    mutableApp.isPackaged = true
    const asset = Buffer.from(
      gzipSync(Buffer.from('fence-neutral duckdb extension body')).toString('base64'),
      'utf8'
    )
    const { actualFs, userDataDir, readFile } = await setupPackagedBase64Fixture(asset)
    let releaseRead!: () => void
    let notifyReadStarted!: () => void
    const readStarted = new Promise<void>((resolve) => {
      notifyReadStarted = resolve
    })
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    readFile.mockImplementation(async () => {
      notifyReadStarted()
      await readGate
      return asset
    })
    vi.spyOn(logger, 'info').mockImplementation(() => undefined)
    const firstConnection = { run: vi.fn(async () => undefined as never) }
    const secondConnection = { run: vi.fn(async () => undefined as never) }
    const firstFence = new MigrationAbandonFence()
    const secondFence = new MigrationAbandonFence()

    try {
      const first = loadLegacyVss(firstConnection, path.join(userDataDir, 'a.duckdb'), firstFence)
      const second = loadLegacyVss(
        secondConnection,
        path.join(userDataDir, 'b.duckdb'),
        secondFence
      )
      await readStarted
      firstFence.abandon()
      releaseRead()

      await expect(first).rejects.toMatchObject({ name: 'LegacyV1MigrationAbandonedError' })
      await expect(second).resolves.toBeUndefined()
      expect(readFile).toHaveBeenCalledTimes(1)
      expect(firstConnection.run).not.toHaveBeenCalled()
      expect(secondConnection.run).toHaveBeenCalledWith(expect.stringMatching(/^LOAD /))
    } finally {
      actualFs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  it('re-materializes when a cached packaged VSS file was deleted', async () => {
    mutableApp.isPackaged = true
    const asset = Buffer.from(
      gzipSync(Buffer.from('restored duckdb extension body')).toString('base64'),
      'utf8'
    )
    const { actualFs, userDataDir, readFile, writeFile, rename } =
      await setupPackagedBase64Fixture(asset)
    vi.spyOn(logger, 'info').mockImplementation(() => undefined)

    try {
      const first = makeVssLoadableStore(undefined, path.join(userDataDir, 'a.duckdb'))
      await first.loadVss()
      const firstLoadSql = first.connection.run.mock.calls[0][0] as string
      const [, firstLoadedPath] = firstLoadSql.match(/LOAD '([^']+)'/) ?? []
      expect(firstLoadedPath).toBeTruthy()
      actualFs.rmSync(firstLoadedPath!, { force: true })

      const second = makeVssLoadableStore(undefined, path.join(userDataDir, 'b.duckdb'))
      await second.loadVss()
      const secondLoadSql = second.connection.run.mock.calls[0][0] as string
      const [, secondLoadedPath] = secondLoadSql.match(/LOAD '([^']+)'/) ?? []

      expect(secondLoadedPath).toBe(firstLoadedPath)
      expect(actualFs.readFileSync(secondLoadedPath!)).toEqual(
        Buffer.from('restored duckdb extension body')
      )
      expect(readFile).toHaveBeenCalledTimes(2)
      expect(writeFile).toHaveBeenCalledTimes(2)
      expect(rename).toHaveBeenCalledTimes(2)
    } finally {
      actualFs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  it('drops failed packaged base64 materialization promises so the next open can retry', async () => {
    mutableApp.isPackaged = true
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')
    const mockedPromises = fs.promises as typeof fs.promises & {
      rename: typeof actualFs.promises.rename
      rm: typeof actualFs.promises.rm
    }
    mockedPromises.rename ??= vi.fn()
    mockedPromises.rm ??= vi.fn()
    const userDataDir = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-vss-user-data-'))
    const asset = Buffer.from(
      gzipSync(Buffer.from('retry duckdb extension body')).toString('base64'),
      'utf8'
    )
    const originalExistsSync = actualFs.existsSync
    vi.spyOn(app, 'getPath').mockReturnValue(userDataDir)
    vi.spyOn(fs, 'existsSync').mockImplementation((target) => {
      const filePath = String(target)
      if (/(^|[/\\])runtime[/\\]duckdb[/\\]extensions[/\\]vss\.duckdb_extension$/.test(filePath)) {
        return false
      }
      if (
        /(^|[/\\])runtime[/\\]duckdb[/\\]extensions[/\\]vss\.duckdb_extension\.b64$/.test(filePath)
      ) {
        return true
      }
      return originalExistsSync(target)
    })
    const readFile = vi
      .spyOn(fs.promises, 'readFile')
      .mockRejectedValueOnce(new Error('transient read failure'))
      .mockResolvedValueOnce(asset)
    vi.spyOn(fs.promises, 'mkdir').mockImplementation(
      actualFs.promises.mkdir as typeof fs.promises.mkdir
    )
    vi.spyOn(fs.promises, 'writeFile').mockImplementation(
      actualFs.promises.writeFile as typeof fs.promises.writeFile
    )
    vi.spyOn(mockedPromises, 'rename').mockImplementation(
      actualFs.promises.rename as typeof fs.promises.rename
    )
    vi.spyOn(mockedPromises, 'rm').mockImplementation(actualFs.promises.rm as typeof fs.promises.rm)
    vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    vi.spyOn(logger, 'info').mockImplementation(() => undefined)

    try {
      const first = makeVssLoadableStore(undefined, path.join(userDataDir, 'a.duckdb'))
      await expect(first.loadVss()).rejects.toThrow('transient read failure')

      const second = makeVssLoadableStore(undefined, path.join(userDataDir, 'b.duckdb'))
      await second.loadVss()
      const loadSql = second.connection.run.mock.calls[0][0] as string
      const [, loadedPath] = loadSql.match(/LOAD '([^']+)'/) ?? []

      expect(loadedPath).toBeTruthy()
      expect(actualFs.readFileSync(loadedPath!)).toEqual(Buffer.from('retry duckdb extension body'))
      expect(readFile).toHaveBeenCalledTimes(2)
    } finally {
      actualFs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  it('fails closed in packaged builds when base64 materialization contains corrupt gzip data', async () => {
    mutableApp.isPackaged = true
    const asset = Buffer.from(Buffer.from('not a gzip payload').toString('base64'), 'utf8')
    const { actualFs, userDataDir } = await setupPackagedBase64Fixture(asset)
    vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const store = makeVssLoadableStore(undefined, path.join(userDataDir, 'agent.duckdb'))

    try {
      await expect(store.loadVss()).rejects.toThrow()
      expect(store.connection.run).not.toHaveBeenCalledWith('INSTALL vss;')
    } finally {
      actualFs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  it('classifies migration materialization failures as safely unavailable before native load', async () => {
    mutableApp.isPackaged = true
    const asset = Buffer.from(Buffer.from('not a gzip payload').toString('base64'), 'utf8')
    const { actualFs, userDataDir } = await setupPackagedBase64Fixture(asset)
    const connection = { run: vi.fn(async () => undefined as never) }
    const fence = new MigrationAbandonFence()

    try {
      await expect(
        loadLegacyVss(connection, path.join(userDataDir, 'agent.duckdb'), fence)
      ).rejects.toMatchObject({ name: 'LegacyVssUnavailableError' })
      expect(connection.run).not.toHaveBeenCalled()
    } finally {
      actualFs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  it('fails closed in packaged builds when the bundled extension cannot load', async () => {
    mutableApp.isPackaged = true
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const store = makeVssLoadableStore((sql) => {
      if (sql.includes('LOAD')) throw new Error('bad extension')
    })

    await expect(store.loadVss()).rejects.toThrow('bad extension')

    expect(store.connection.run).toHaveBeenCalledTimes(1)
    expect(store.connection.run).not.toHaveBeenCalledWith('INSTALL vss;')
  })

  it('stops after a native load settles when the migration fence was abandoned', async () => {
    mutableApp.isPackaged = true
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    let releaseLoad!: () => void
    let markLoadStarted!: () => void
    const loadStarted = new Promise<void>((resolve) => {
      markLoadStarted = resolve
    })
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve
    })
    const connection = {
      run: vi.fn(async (sql: string) => {
        if (sql.startsWith('LOAD ')) {
          markLoadStarted()
          await loadGate
        }
        return undefined as never
      })
    }
    const fence = new MigrationAbandonFence()
    const pendingLoad = loadLegacyVss(connection, '/tmp/legacy.duckdb', fence)
    const rejection = expect(pendingLoad).rejects.toMatchObject({
      name: 'LegacyV1MigrationAbandonedError'
    })

    await loadStarted
    fence.abandon()
    releaseLoad()

    await rejection
    expect(connection.run).toHaveBeenCalledTimes(1)
    expect(connection.run).not.toHaveBeenCalledWith(
      'SET hnsw_enable_experimental_persistence = true;'
    )
  })

  it('keeps the network fallback for development builds', async () => {
    mutableApp.isPackaged = false
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const store = makeVssLoadableStore()

    await store.loadVss()

    expect(store.connection.run).toHaveBeenCalledWith('INSTALL vss;')
    expect(store.connection.run).toHaveBeenCalledWith('LOAD vss;')
    expect(store.connection.run).toHaveBeenCalledWith(
      'SET hnsw_enable_experimental_persistence = true;'
    )
  })

  it('never uses the network fallback during migration', async () => {
    mutableApp.isPackaged = false
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    const connection = { run: vi.fn(async () => undefined as never) }
    const fence = new MigrationAbandonFence()

    await expect(loadLegacyVss(connection, '/tmp/legacy.duckdb', fence)).rejects.toMatchObject({
      name: 'LegacyVssUnavailableError'
    })
    expect(connection.run).not.toHaveBeenCalled()
  })
})
