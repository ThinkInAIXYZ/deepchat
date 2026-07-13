import { afterEach, describe, expect, it, vi } from 'vitest'

const duckDbMocks = vi.hoisted(() => ({ create: vi.fn() }))
const vssMocks = vi.hoisted(() => ({ load: vi.fn() }))

vi.mock('@duckdb/node-api', () => ({
  DuckDBInstance: { create: duckDbMocks.create },
  DuckDBConnection: class {}
}))

vi.mock('@/presenter/memoryPresenter/infra/legacyVssLoader', () => ({
  loadLegacyVss: vssMocks.load,
  escapeDuckDbSqlPath: (filePath: string) => filePath.replace(/\\/g, '\\\\').replace(/'/g, "''"),
  LegacyVssUnavailableError: class LegacyVssUnavailableError extends Error {}
}))

import {
  LegacyV1MigrationAbandonedError,
  LegacyV1Reader,
  MigrationAbandonFence
} from '@/presenter/memoryPresenter/infra/legacyV1Reader'

function setupReader(responses: Array<Array<Record<string, unknown>>>) {
  const connection = {
    run: vi.fn(async () => undefined),
    runAndReadAll: vi.fn(async () => ({
      getRowObjectsJson: () => responses.shift() ?? []
    })),
    closeSync: vi.fn()
  }
  const instance = {
    connect: vi.fn(async () => connection),
    closeSync: vi.fn()
  }
  duckDbMocks.create.mockResolvedValue(instance)
  return { connection, instance }
}

afterEach(() => {
  vi.restoreAllMocks()
  duckDbMocks.create.mockReset()
  vssMocks.load.mockReset()
})

describe('LegacyV1Reader', () => {
  it('reads one valid legacy embedding identity', async () => {
    const { connection } = setupReader([
      [{ column_name: 'provider' }, { column_name: 'model' }, { column_name: 'dim' }],
      [{ provider: 'provider-a', model: 'model-a', dim: 2 }]
    ])
    const fence = new MigrationAbandonFence()
    const reader = await LegacyV1Reader.open('/tmp/legacy.duckdb', 2, fence)

    await expect(reader.readEmbeddingIdentity(fence)).resolves.toEqual({
      providerId: 'provider-a',
      modelId: 'model-a',
      dimensions: 2
    })
    expect(connection.runAndReadAll).toHaveBeenCalledWith(
      expect.stringContaining("table_catalog = 'legacy'")
    )
  })

  it.each([
    {
      name: 'missing columns',
      responses: [[{ column_name: 'provider' }]]
    },
    {
      name: 'duplicate rows',
      responses: [
        [{ column_name: 'provider' }, { column_name: 'model' }, { column_name: 'dim' }],
        [
          { provider: 'p', model: 'm', dim: 2 },
          { provider: 'p', model: 'm', dim: 2 }
        ]
      ]
    },
    {
      name: 'malformed fields',
      responses: [
        [{ column_name: 'provider' }, { column_name: 'model' }, { column_name: 'dim' }],
        [{ provider: '', model: 'm', dim: 0 }]
      ]
    }
  ])('returns null for $name', async ({ responses }) => {
    setupReader(responses)
    const fence = new MigrationAbandonFence()
    const reader = await LegacyV1Reader.open('/tmp/legacy.duckdb', 2, fence)

    await expect(reader.readEmbeddingIdentity(fence)).resolves.toBeNull()
  })

  it('propagates native metadata read failures', async () => {
    const { connection } = setupReader([])
    connection.runAndReadAll.mockRejectedValueOnce(new Error('INTERNAL metadata failure'))
    const fence = new MigrationAbandonFence()
    const reader = await LegacyV1Reader.open('/tmp/legacy.duckdb', 2, fence)

    await expect(reader.readEmbeddingIdentity(fence)).rejects.toThrow('INTERNAL metadata failure')
    expect(connection.closeSync).not.toHaveBeenCalled()
  })

  it('opens through a neutral connection and reads strictly keyset-paged rows', async () => {
    const { connection, instance } = setupReader([
      [{ row_count: 3 }],
      [
        { memory_id: 'm1', embedding: [0.1, 0.2] },
        { memory_id: 'm2', embedding: [0.3, 0.4] }
      ],
      [{ memory_id: 'm3', embedding: [0.5, 0.6] }]
    ])
    const fence = new MigrationAbandonFence()
    const legacyPath = "C:\\AgentMemory\\O'Brien.duckdb"

    const reader = await LegacyV1Reader.open(legacyPath, 2, fence)
    await expect(reader.countRows(fence)).resolves.toBe(3)
    await expect(reader.readPage(null, fence)).resolves.toEqual([
      { memoryId: 'm1', embedding: [0.1, 0.2] },
      { memoryId: 'm2', embedding: [0.3, 0.4] }
    ])
    await expect(reader.readPage('m2', fence)).resolves.toEqual([
      { memoryId: 'm3', embedding: [0.5, 0.6] }
    ])
    reader.closeBeforeFileMutation(fence)

    expect(duckDbMocks.create).toHaveBeenCalledWith(':memory:')
    expect(vssMocks.load).toHaveBeenCalledWith(connection, legacyPath, fence)
    expect(connection.run).toHaveBeenCalledWith(
      "ATTACH 'C:\\\\AgentMemory\\\\O''Brien.duckdb' AS legacy (READ_ONLY);"
    )
    expect(connection.runAndReadAll).toHaveBeenCalledWith(
      expect.stringContaining('memory_id > ?'),
      ['m2', 50]
    )
    expect(connection.closeSync).toHaveBeenCalledTimes(1)
    expect(instance.closeSync).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed vectors and non-increasing ids', async () => {
    const { connection } = setupReader([
      [{ memory_id: 'm1', embedding: [0.1] }],
      [{ memory_id: 'm1', embedding: [0.1, 0.2] }]
    ])
    const fence = new MigrationAbandonFence()
    const reader = await LegacyV1Reader.open('/tmp/legacy.duckdb', 2, fence)

    await expect(reader.readPage(null, fence)).rejects.toThrow('invalid legacy v1 embedding')
    await expect(reader.readPage('m1', fence)).rejects.toThrow('not strictly keyset ordered')
    expect(connection.closeSync).not.toHaveBeenCalled()
  })

  it('blocks a late read continuation after the attempt is abandoned', async () => {
    let releaseRead!: (value: { getRowObjectsJson(): Array<Record<string, unknown>> }) => void
    const readGate = new Promise<{ getRowObjectsJson(): Array<Record<string, unknown>> }>(
      (resolve) => {
        releaseRead = resolve
      }
    )
    const connection = {
      run: vi.fn(async () => undefined),
      runAndReadAll: vi.fn(() => readGate),
      closeSync: vi.fn()
    }
    const instance = {
      connect: vi.fn(async () => connection),
      closeSync: vi.fn()
    }
    duckDbMocks.create.mockResolvedValue(instance)
    const fence = new MigrationAbandonFence()
    const reader = await LegacyV1Reader.open('/tmp/legacy.duckdb', 2, fence)

    const pending = reader.readPage(null, fence)
    fence.abandon()
    releaseRead({
      getRowObjectsJson: () => [{ memory_id: 'm1', embedding: [0.1, 0.2] }]
    })

    await expect(pending).rejects.toBeInstanceOf(LegacyV1MigrationAbandonedError)
    expect(connection.closeSync).not.toHaveBeenCalled()
    expect(instance.closeSync).not.toHaveBeenCalled()
  })

  it('does not invoke another native close after the first close fails', async () => {
    const { connection, instance } = setupReader([])
    connection.closeSync.mockImplementation(() => {
      throw new Error('close failed')
    })
    const fence = new MigrationAbandonFence()
    const reader = await LegacyV1Reader.open('/tmp/legacy.duckdb', 2, fence)

    expect(() => reader.closeBeforeFileMutation(fence)).toThrow('close failed')
    expect(instance.closeSync).not.toHaveBeenCalled()
  })
})
