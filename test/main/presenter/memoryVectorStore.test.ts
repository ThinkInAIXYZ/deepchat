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
    onFinalOpen?: () => void
    leaveStagingWal?: boolean
    legacyRows?: MemoryVectorRecord[]
    legacyReadError?: Error
    legacyReadGate?: Promise<void>
    onLegacyRead?: () => void
    failTargetInsert?: Error
    targetRowCountOverride?: number
  } = {}
) {
  const dimensions = options.dimensions ?? 2
  const sql: string[] = []
  const legacySql: string[] = []
  const connections: Array<{ closeSync: ReturnType<typeof vi.fn> }> = []
  let targetRowCount = 0
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
          const rows = options.legacyRows ?? []
          if (statement.includes('count(*) AS row_count')) {
            return { getRowObjectsJson: () => [{ row_count: rows.length }] }
          }
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
    if (dbPath === paths.current && options.failFinalOpen) throw new Error('final open failed')
    if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, '')
    if (dbPath === paths.current) options.onFinalOpen?.()
    const connection = {
      run: vi.fn(async (statement: string, params: unknown[] = []) => {
        sql.push(statement)
        if (statement.includes('INSERT INTO memory_vector')) {
          if (options.failTargetInsert) throw options.failTargetInsert
          targetRowCount += params.length / 2
        }
        if (statement.includes('CHECKPOINT') && options.leaveStagingWal) {
          fs.writeFileSync(`${paths.staging}.wal`, 'wal')
        }
        return undefined
      }),
      runAndReadAll: vi.fn(async (statement: string) => ({
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
      })),
      closeSync: vi.fn()
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
  vi.spyOn(fs, 'existsSync').mockImplementation(actualFs.existsSync)
  vi.spyOn(fs, 'readFileSync').mockImplementation(actualFs.readFileSync)
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

const EMB = { providerId: 'p', modelId: 'm' }

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

  it('keeps the quarantine marker until the final v2 store opens successfully', async () => {
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
      onFinalOpen: () => expect(fs.existsSync(paths.quarantine)).toBe(true)
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

  it('retries marker recovery after a pre-commit publish failure', async () => {
    const actualFs = await setupRealFileSystem()
    const root = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-marker-retry-'))
    const paths = createMemoryVectorStorePaths(root, 'agent-a')
    fs.writeFileSync(paths.quarantine, 'old')
    mockV2DuckDbLifecycle(paths, { leaveStagingWal: true })

    try {
      await expect(MemoryVectorStore.create(paths, 2, EMB)).rejects.toThrow('staged v2 WAL remains')
      expect(fs.existsSync(paths.quarantine)).toBe(true)
      expect(fs.existsSync(paths.current)).toBe(false)

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

  it('returns the healthy store when marker cleanup fails after commit', async () => {
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
      const store = await MemoryVectorStore.create(paths, 2, EMB)
      expect(store.isUsable()).toBe(true)
      expect(fs.existsSync(paths.current)).toBe(true)
      expect(fs.existsSync(paths.quarantine)).toBe(true)
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
      await expect(MemoryVectorStore.create(paths, 2, EMB)).rejects.toThrow('final open failed')
      expect(fs.existsSync(paths.current)).toBe(true)
      expect(fs.existsSync(paths.staging)).toBe(false)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
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
})
