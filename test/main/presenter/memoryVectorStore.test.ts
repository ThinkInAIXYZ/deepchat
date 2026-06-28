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
import { MemoryVectorStore } from '@/presenter/memoryPresenter/memoryVectorStore'
import type { MemoryVectorRecord } from '@/presenter/memoryPresenter/types'
import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

interface TestStore {
  connection: { run: ReturnType<typeof vi.fn> }
  vectorTable: string
  upsert(records: MemoryVectorRecord[]): Promise<void>
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
    await store.upsert(records)
    expect(calls).toEqual(['BEGIN', 'DELETE', 'INSERT', 'COMMIT'])
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

interface EmbeddingMeta {
  provider: string
  model: string
  dim: number
}

interface OpenableStore {
  usable: boolean
  vectorTable: string
  metaTable: string
  dbPath: string
  connection: { runAndReadAll: ReturnType<typeof vi.fn> }
  connect(): Promise<void>
  loadVss(): Promise<void>
  open(expectedDim: number, embedding: { providerId: string; modelId: string }): Promise<void>
  isUsable(): boolean
}

interface VssLoadableStore {
  dbPath: string
  connection: { run: ReturnType<typeof vi.fn> }
  loadVss(): Promise<void>
}

function mockDuckDbHandles(onRun: (sql: string) => void = () => {}) {
  const connection = {
    run: vi.fn(async (sql: string) => {
      onRun(sql)
      return undefined
    }),
    closeSync: vi.fn()
  }
  const dbInstance = {
    connect: vi.fn(async () => connection),
    closeSync: vi.fn()
  }
  duckDbMocks.create.mockResolvedValue(dbInstance)
  return { connection, dbInstance }
}

// meta: undefined => meta table missing (legacy file); null => present but empty; object => stored identity.
function makeOpenableStore(opts: { meta?: EmbeddingMeta | null }) {
  const store = Object.create(MemoryVectorStore.prototype) as unknown as OpenableStore
  store.usable = true
  store.vectorTable = 'memory_vector'
  store.metaTable = 'embedding_meta'
  store.dbPath = '/tmp/agent-x.duckdb'
  store.connection = {
    runAndReadAll: vi.fn(async () => {
      if (opts.meta === undefined) throw new Error('Catalog Error: embedding_meta does not exist')
      return { getRowObjectsJson: () => (opts.meta ? [opts.meta] : []) }
    })
  }
  store.connect = async () => undefined
  store.loadVss = async () => undefined
  return store
}

const EMB = { providerId: 'p', modelId: 'm' }

function makeVssLoadableStore(
  onRun: (sql: string) => void = () => {},
  dbPath = '/tmp/agent.duckdb'
) {
  const store = Object.create(MemoryVectorStore.prototype) as unknown as VssLoadableStore
  store.dbPath = dbPath
  store.connection = {
    run: vi.fn(async (sql: string) => {
      onRun(sql)
      return undefined
    })
  }
  return store
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
  app.isPackaged = false
  duckDbMocks.create.mockReset()
  vi.restoreAllMocks()
})

describe('MemoryVectorStore.open identity guard (C5, AC-5.2/5.3)', () => {
  it('stays usable when stored identity matches', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const store = makeOpenableStore({ meta: { provider: 'p', model: 'm', dim: 2 } })
    await store.open(2, EMB)
    expect(store.isUsable()).toBe(true)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('disables and warns when the stored dim differs', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const store = makeOpenableStore({ meta: { provider: 'p', model: 'm', dim: 4 } })
    await store.open(2, EMB)
    expect(store.isUsable()).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('disables and warns when the stored model differs (same dim)', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const store = makeOpenableStore({ meta: { provider: 'p', model: 'OLD', dim: 2 } })
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
})

describe('MemoryVectorStore VSS loading', () => {
  it('closes opened DuckDB handles when packaged create fails on a missing bundled extension', async () => {
    app.isPackaged = true
    vi.spyOn(fs, 'existsSync').mockImplementation((target) => {
      if (/(^|[/\\])vss\.duckdb_extension(?:\..+)?$/.test(String(target))) return false
      return true
    })
    vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const { connection, dbInstance } = mockDuckDbHandles()

    await expect(MemoryVectorStore.create('/tmp/agent.duckdb', 2, EMB)).rejects.toThrow(
      /bundled VSS extension missing/
    )

    expect(connection.run).not.toHaveBeenCalledWith('INSTALL vss;')
    expect(connection.closeSync).toHaveBeenCalledTimes(1)
    expect(dbInstance.closeSync).toHaveBeenCalledTimes(1)
  })

  it('closes opened DuckDB handles when packaged create fails during bundled VSS LOAD', async () => {
    app.isPackaged = true
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const { connection, dbInstance } = mockDuckDbHandles((sql) => {
      if (sql.includes('LOAD')) throw new Error('bad extension')
    })

    await expect(MemoryVectorStore.create('/tmp/agent.duckdb', 2, EMB)).rejects.toThrow(
      'bad extension'
    )

    expect(connection.run).toHaveBeenCalledTimes(1)
    expect(connection.run).not.toHaveBeenCalledWith('INSTALL vss;')
    expect(connection.closeSync).toHaveBeenCalledTimes(1)
    expect(dbInstance.closeSync).toHaveBeenCalledTimes(1)
  })

  it('fails closed in packaged builds when the bundled extension is missing', async () => {
    app.isPackaged = true
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const store = makeVssLoadableStore()

    await expect(store.loadVss()).rejects.toThrow(/bundled VSS extension missing/)

    expect(store.connection.run).not.toHaveBeenCalledWith('INSTALL vss;')
    expect(error).toHaveBeenCalled()
  })

  it('materializes packaged base64 VSS assets into userData before loading', async () => {
    app.isPackaged = true
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
    app.isPackaged = true
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
    app.isPackaged = true
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
    app.isPackaged = true
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
    app.isPackaged = true
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
    app.isPackaged = true
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const store = makeVssLoadableStore((sql) => {
      if (sql.includes('LOAD')) throw new Error('bad extension')
    })

    await expect(store.loadVss()).rejects.toThrow('bad extension')

    expect(store.connection.run).toHaveBeenCalledTimes(1)
    expect(store.connection.run).not.toHaveBeenCalledWith('INSTALL vss;')
  })

  it('keeps the network fallback for development builds', async () => {
    app.isPackaged = false
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
