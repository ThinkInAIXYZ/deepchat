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

function makeVssLoadableStore(onRun: (sql: string) => void = () => {}) {
  const store = Object.create(MemoryVectorStore.prototype) as unknown as VssLoadableStore
  store.connection = {
    run: vi.fn(async (sql: string) => {
      onRun(sql)
      return undefined
    })
  }
  return store
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
      if (String(target).endsWith('vss.duckdb_extension')) return false
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
