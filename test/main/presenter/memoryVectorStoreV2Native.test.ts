import { DuckDBInstance, arrayValue } from '@duckdb/node-api'
import { app } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createMemoryVectorStorePaths,
  MemoryVectorStore,
  type MemoryVectorStorePaths
} from '@/presenter/memoryPresenter/infra/memoryVectorStore'
import { createMemoryVectorStoreV2FormatPlan } from '@/presenter/memoryPresenter/infra/memoryVectorStoreFormat'
import { escapeDuckDbSqlPath } from '@/presenter/memoryPresenter/infra/legacyVssLoader'

const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')
const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../..')
const CRASH_WORKER = path.join(
  PROJECT_ROOT,
  'test/fixtures/memory-vector-store-v2/crash-worker.mjs'
)
const VSS_EXTENSION = path.join(PROJECT_ROOT, 'runtime/duckdb/extensions/vss.duckdb_extension')
const EMBEDDING = { providerId: 'p', modelId: 'm' }
const V2_FORMAT_PLAN = createMemoryVectorStoreV2FormatPlan(2, EMBEDDING)
const CRASH_EXIT_CODE = 73
const REQUIRE_VSS = process.env.DEEPCHAT_REQUIRE_NATIVE_DUCKDB_VSS === '1'
const VSS_AVAILABLE = actualFs.existsSync(VSS_EXTENSION)
const itWithVss = VSS_AVAILABLE || REQUIRE_VSS ? it : it.skip
const temporaryRoots = new Set<string>()

function createPaths(prefix: string): { root: string; paths: MemoryVectorStorePaths } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  temporaryRoots.add(root)
  return { root, paths: createMemoryVectorStorePaths(root, 'deepchat') }
}

async function closeDuckDb(
  connection: { closeSync(): void } | null,
  instance: { closeSync(): void } | null
): Promise<void> {
  connection?.closeSync()
  instance?.closeSync()
}

async function createLegacyV1(paths: MemoryVectorStorePaths, rowCount = 51): Promise<void> {
  const instance = await DuckDBInstance.create(paths.legacy)
  const connection = await instance.connect()
  try {
    await connection.run(`LOAD '${escapeDuckDbSqlPath(VSS_EXTENSION)}';`)
    await connection.run('SET hnsw_enable_experimental_persistence = true;')
    await connection.run(
      'CREATE TABLE memory_vector (memory_id VARCHAR PRIMARY KEY, embedding FLOAT[2]);'
    )
    await connection.run(
      'CREATE TABLE embedding_meta (provider VARCHAR, model VARCHAR, dim INTEGER);'
    )
    await connection.run("INSERT INTO embedding_meta (provider, model, dim) VALUES ('p', 'm', 2);")
    for (let index = 1; index <= rowCount; index += 1) {
      await connection.run(
        'INSERT INTO memory_vector (memory_id, embedding) VALUES (?, ?::FLOAT[]);',
        [`m${String(index).padStart(3, '0')}`, arrayValue([index, rowCount + 1 - index])]
      )
    }
    await connection.run(
      "CREATE INDEX idx_memory_vector_embedding ON memory_vector USING HNSW (embedding) WITH (metric='cosine');"
    )
    const indexReader = await connection.runAndReadAll(
      "SELECT index_name, sql FROM duckdb_indexes() WHERE table_name = 'memory_vector';"
    )
    expect(indexReader.getRowObjectsJson()).toMatchObject([
      { index_name: 'idx_memory_vector_embedding', sql: expect.stringMatching(/USING HNSW/i) }
    ])
    await connection.run('CHECKPOINT;')
  } finally {
    await closeDuckDb(connection, instance)
  }
  expect(fs.existsSync(`${paths.legacy}.wal`)).toBe(false)
}

async function inspectV2(paths: MemoryVectorStorePaths) {
  const instance = await DuckDBInstance.create(paths.current)
  const connection = await instance.connect()
  try {
    const metaReader = await connection.runAndReadAll(
      'SELECT provider, model, dim, format_version FROM embedding_meta;'
    )
    const indexReader = await connection.runAndReadAll(
      "SELECT index_name, sql FROM duckdb_indexes() WHERE table_name = 'memory_vector';"
    )
    const rowsReader = await connection.runAndReadAll(
      'SELECT memory_id, embedding FROM memory_vector ORDER BY memory_id;'
    )
    return {
      meta: metaReader.getRowObjectsJson(),
      indexes: indexReader.getRowObjectsJson(),
      rows: rowsReader.getRowObjectsJson()
    }
  } finally {
    await closeDuckDb(connection, instance)
  }
}

async function runCrashWorker(mode: string, paths: MemoryVectorStorePaths): Promise<void> {
  const child = spawn(
    process.execPath,
    [CRASH_WORKER, mode, JSON.stringify(paths), JSON.stringify(V2_FORMAT_PLAN)],
    {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'ignore', 'pipe']
    }
  )
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk)
  })
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  expect(stderr).toBe('')
  expect(exitCode).toBe(CRASH_EXIT_CODE)
}

function createLegacyHoldStatements(paths: MemoryVectorStorePaths): string[] {
  return [
    `LOAD '${escapeDuckDbSqlPath(VSS_EXTENSION)}';`,
    'SET hnsw_enable_experimental_persistence = true;',
    `ATTACH '${escapeDuckDbSqlPath(paths.legacy)}' AS legacy (READ_ONLY);`
  ]
}

async function waitForReady(child: ReturnType<typeof spawn>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for native handle worker: ${stderr}`))
    }, 10_000)
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
      if (stdout.includes('READY\n')) {
        clearTimeout(timeout)
        resolve()
      }
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`Worker exited before READY with code ${code}: ${stderr}`))
    })
  })
}

async function stopChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  child.kill()
  await exited
}

beforeEach(() => {
  vi.mocked(fs.existsSync).mockImplementation(actualFs.existsSync)
  vi.mocked(fs.writeFileSync).mockImplementation(actualFs.writeFileSync)
  vi.mocked(fs.mkdirSync).mockImplementation(actualFs.mkdirSync)
  vi.mocked(fs.mkdtempSync).mockImplementation(actualFs.mkdtempSync)
  vi.mocked(fs.rmSync).mockImplementation(actualFs.rmSync)
  vi.mocked(fs.renameSync).mockImplementation(actualFs.renameSync)
  vi.mocked(app.getAppPath).mockReturnValue(PROJECT_ROOT)
})

afterEach(() => {
  vi.mocked(app.getAppPath).mockReturnValue('/mock/app')
  for (const root of temporaryRoots) {
    fs.rmSync(root, { recursive: true, force: true })
  }
  temporaryRoots.clear()
})

describe('MemoryVectorStore v2 native integration', () => {
  itWithVss('preserves a genuine WAL-free HNSW v1 store without VSS on the v2 path', async () => {
    if (!VSS_AVAILABLE) {
      throw new Error(`Required bundled VSS extension is missing at ${VSS_EXTENSION}`)
    }
    const { paths } = createPaths('deepchat-memory-native-preserve-')
    await createLegacyV1(paths)

    const store = await MemoryVectorStore.create(paths, 2, EMBEDDING)
    expect(store.isUsable()).toBe(true)
    await expect(store.query([1, 51], { topK: 1 })).resolves.toMatchObject([{ memoryId: 'm001' }])
    await store.close()

    expect(fs.existsSync(paths.current)).toBe(true)
    expect(fs.existsSync(paths.legacy)).toBe(false)
    const snapshot = await inspectV2(paths)
    expect(snapshot.meta).toEqual([{ provider: 'p', model: 'm', dim: 2, format_version: 2 }])
    expect(snapshot.indexes).toEqual([])
    expect(snapshot.rows).toHaveLength(51)
    expect(snapshot.rows[0]).toMatchObject({ memory_id: 'm001', embedding: [1, 51] })
    expect(snapshot.rows[50]).toMatchObject({ memory_id: 'm051', embedding: [51, 1] })

    vi.mocked(app.getAppPath).mockReturnValue(path.join(PROJECT_ROOT, 'missing-runtime-root'))
    const reopened = await MemoryVectorStore.create(paths, 2, EMBEDDING)
    await expect(reopened.query([51, 1], { topK: 1 })).resolves.toMatchObject([
      { memoryId: 'm051' }
    ])
    await reopened.close()
  })

  itWithVss('reaches the v2 metadata self-check for a genuine HNSW v1 file', async () => {
    if (!VSS_AVAILABLE) {
      throw new Error(`Required bundled VSS extension is missing at ${VSS_EXTENSION}`)
    }
    const { paths } = createPaths('deepchat-memory-native-renamed-v1-')
    await createLegacyV1(paths, 1)
    fs.renameSync(paths.legacy, paths.current)

    const store = await MemoryVectorStore.create(paths, 2, EMBEDDING)

    expect(store.isUsable()).toBe(false)
    expect(fs.existsSync(paths.current)).toBe(true)
    expect(fs.existsSync(paths.quarantine)).toBe(false)
    await store.close()
  })

  it('rebuilds an unreadable v1 with WAL without opening it', async () => {
    const { paths } = createPaths('deepchat-memory-native-v1-wal-')
    fs.writeFileSync(paths.legacy, 'not-a-duckdb-database')
    fs.writeFileSync(`${paths.legacy}.wal`, 'not-a-duckdb-wal')

    const store = await MemoryVectorStore.create(paths, 2, EMBEDDING)
    expect(store.isUsable()).toBe(true)
    await expect(store.query([1, 0], { topK: 5 })).resolves.toEqual([])
    await store.close()

    expect(fs.existsSync(paths.legacy)).toBe(false)
    expect(fs.existsSync(`${paths.legacy}.wal`)).toBe(false)
    expect((await inspectV2(paths)).meta).toEqual([
      { provider: 'p', model: 'm', dim: 2, format_version: 2 }
    ])
  })
})

describe('MemoryVectorStore v2 native crash recovery', () => {
  it('replays a residual v2 WAL without rebuilding the committed store', async () => {
    const { paths } = createPaths('deepchat-memory-native-v2-wal-')
    await runCrashWorker('v2-wal', paths)
    expect(fs.existsSync(paths.current)).toBe(true)
    expect(fs.existsSync(`${paths.current}.wal`)).toBe(true)

    const store = await MemoryVectorStore.create(paths, 2, EMBEDDING)
    await expect(store.query([1, 0], { topK: 1 })).resolves.toMatchObject([
      { memoryId: 'crash-row' }
    ])
    expect(fs.existsSync(paths.staging)).toBe(false)
    await store.close()
  })

  it.each([
    'staging-schema',
    'staging-write',
    'checkpoint-before',
    'checkpoint-after',
    'rename-before',
    'rename-after',
    'marker-before-sweep',
    'marker-after-sweep',
    'marker-after-delete',
    'marker-during-publish'
  ])('recovers the %s crash point', async (mode) => {
    const { paths } = createPaths(`deepchat-memory-native-${mode}-`)
    await runCrashWorker(mode, paths)

    const store = await MemoryVectorStore.create(paths, 2, EMBEDDING)
    expect(store.isUsable()).toBe(true)
    const matches = await store.query([1, 0], { topK: 1 })
    if (mode === 'rename-after') {
      expect(matches).toMatchObject([{ memoryId: 'crash-row' }])
    } else {
      expect(matches).toEqual([])
    }
    await store.close()

    expect(fs.existsSync(paths.current)).toBe(true)
    expect(fs.existsSync(paths.staging)).toBe(false)
    expect(fs.existsSync(`${paths.staging}.wal`)).toBe(false)
    expect(fs.existsSync(paths.legacy)).toBe(false)
    expect(fs.existsSync(`${paths.legacy}.wal`)).toBe(false)
    expect(fs.existsSync(paths.quarantine)).toBe(false)
  })

  it.runIf(process.platform === 'win32' && VSS_AVAILABLE)(
    'keeps a quarantine marker while a Windows legacy handle returns EBUSY',
    async () => {
      const { root, paths } = createPaths('deepchat-memory-native-windows-handle-')
      await createLegacyV1(paths, 1)
      const child = spawn(
        process.execPath,
        [
          CRASH_WORKER,
          'hold-quarantined-legacy',
          JSON.stringify(paths),
          JSON.stringify(V2_FORMAT_PLAN),
          JSON.stringify(createLegacyHoldStatements(paths))
        ],
        { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
      )
      try {
        await waitForReady(child)

        expect(fs.existsSync(paths.quarantine)).toBe(true)
        expect(() => fs.rmSync(paths.legacy)).toThrowError(
          expect.objectContaining({ code: expect.stringMatching(/EBUSY|EPERM/) })
        )
        expect(fs.existsSync(paths.legacy)).toBe(true)
        expect(fs.existsSync(paths.quarantine)).toBe(true)
      } finally {
        await stopChild(child)
      }

      fs.rmSync(root, { recursive: true, force: true })
      temporaryRoots.delete(root)
    }
  )

  it.runIf(process.platform === 'win32' && VSS_AVAILABLE)(
    'keeps committed v2 authoritative when legacy cleanup returns EBUSY',
    async () => {
      const { root, paths } = createPaths('deepchat-memory-native-windows-cleanup-')
      const published = await MemoryVectorStore.create(paths, 2, EMBEDDING)
      await published.upsert([{ memoryId: 'current-row', embedding: [1, 0] }])
      await published.close()
      await createLegacyV1(paths, 1)
      const child = spawn(
        process.execPath,
        [
          CRASH_WORKER,
          'hold-legacy',
          JSON.stringify(paths),
          JSON.stringify(V2_FORMAT_PLAN),
          JSON.stringify(createLegacyHoldStatements(paths))
        ],
        { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
      )
      try {
        await waitForReady(child)

        const reopened = await MemoryVectorStore.create(paths, 2, EMBEDDING)
        await expect(reopened.query([1, 0], { topK: 1 })).resolves.toMatchObject([
          { memoryId: 'current-row' }
        ])
        await reopened.close()
        expect(fs.existsSync(paths.current)).toBe(true)
        expect(fs.existsSync(paths.legacy)).toBe(true)
      } finally {
        await stopChild(child)
      }

      fs.rmSync(root, { recursive: true, force: true })
      temporaryRoots.delete(root)
    }
  )
})
