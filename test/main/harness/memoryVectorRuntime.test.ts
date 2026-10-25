import { randomUUID } from 'node:crypto'
import { DuckDBInstance } from '@duckdb/node-api'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import { HarnessRuntime } from '@/harness/runtime'
import { RutisAgentInvocationAdmission } from '@/harness/admission'
import { RutisMemoryVectorStores } from '@/harness/memory-vector'
import { MEMORY_VECTOR_OWNER_FILE } from '@/memory/infra/memoryVectorStorePaths'

const { mkdtempSync, mkdirSync, rmSync, readdirSync, existsSync, writeFileSync, readFileSync } =
  await vi.importActual<typeof import('node:fs')>('node:fs')
const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder'))
const { getFileMatchers, copyFiles } = builderRequire('app-builder-lib/out/fileMatcher.js')
const active: Array<{ runtime: HarnessRuntime; stores: RutisMemoryVectorStores; root: string }> = []

async function create(memoryDbDir?: string) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-runtime-'))
  const resources =
    process.platform === 'darwin'
      ? path.join(root, 'DeepChat.app', 'Contents', 'Resources')
      : path.join(root, 'resources')
  const directory = path.join(resources, 'app.asar.unpacked', 'harness')
  const config = parse(readFileSync(path.resolve('electron-builder.yml'), 'utf8'))
  const matchers = getFileMatchers(
    {
      extraResources: config.extraResources.filter((resource: { from?: string }) =>
        resource.from?.startsWith('./out/harness/')
      )
    },
    'extraResources',
    resources,
    {
      defaultSrc: path.resolve('.'),
      globalOutDir: path.resolve('dist'),
      customBuildOptions: {},
      macroExpander: (value: string) => value
    }
  )
  await copyFiles(matchers)
  const { shareHarnessDuckDbNativePackage } = await import('../../../scripts/afterPack.js')
  await shareHarnessDuckDbNativePackage({
    appOutDir: root,
    electronPlatformName: process.platform,
    arch: process.arch
  })
  expect(
    existsSync(
      path.join(
        directory,
        'node_modules',
        '@duckdb',
        `node-bindings-${process.platform}-${process.arch}`
      )
    )
  ).toBe(false)
  const runtime = await HarnessRuntime.start({
    directory,
    electronExecutable: require('electron'),
    capacity: 1,
    maxPending: 4,
    observe: () => {}
  })
  const stores = new RutisMemoryVectorStores(runtime, {
    memoryDbDir: memoryDbDir ?? path.join(root, 'memory'),
    host: { appPath: path.resolve('.'), userDataPath: root, isPackaged: false }
  })
  active.push({ runtime, stores, root })
  const admission = RutisAgentInvocationAdmission.create({ runtime, capacity: 1, maxPending: 4 })
  return { runtime, stores, root, admission }
}

beforeEach(() => {
  vi.mocked(fs.existsSync).mockImplementation(existsSync)
  vi.mocked(fs.mkdirSync).mockImplementation(mkdirSync)
  vi.mocked(fs.writeFileSync).mockImplementation(writeFileSync)
})

afterEach(async () => {
  for (const { runtime, stores } of active) {
    await stores.dispose()
    await runtime.stop()
  }
  for (const { root } of active) rmSync(root, { recursive: true, force: true })
  active.length = 0
  vi.restoreAllMocks()
})

describe('Rutis native Memory runtime', () => {
  it.each(['quarantine', 'corrupt-open', 'marker-failure'])(
    'fences native files by terminating only the vector process after %s',
    async (failure) => {
      const { runtime, stores, admission, root } = await create()
      const identity = runtime.identity
      const store = await stores.createVectorStore(
        'agent',
        { providerId: 'fixture', modelId: 'fixture' },
        2
      )
      await store.upsert([{ memoryId: 'existing', embedding: [1, 0] }])
      const worker = runtime.memoryIdentity!
      const file = path.join(root, 'memory', 'agent.v2.duckdb')
      if (failure === 'quarantine') {
        stores.markVectorStoreQuarantined('agent')
        expect(existsSync(`${file}.quarantine`)).toBe(true)
      } else if (failure === 'marker-failure') {
        vi.mocked(fs.writeFileSync).mockImplementationOnce(() => {
          throw new Error('Quarantine intent cannot be persisted')
        })
        expect(() => stores.markVectorStoreQuarantined('agent')).toThrow('cannot be persisted')
      } else {
        await store.close()
        writeFileSync(file, 'invalid native database')
        await expect(
          stores.createVectorStore('agent', { providerId: 'fixture', modelId: 'fixture' }, 2)
        ).rejects.toThrow()
      }
      await vi.waitFor(() => {
        expect(runtime.memoryAvailable).toBe(false)
        expect(() => process.kill(worker.pid, 0)).toThrow()
      })
      expect(existsSync(`${file}.lease`)).toBe(true)
      expect(existsSync(`${file}.quarantine`)).toBe(true)
      const retained = readFileSync(file)
      await expect(stores.resetVectorStore('agent')).rejects.toThrow()
      await expect(
        stores.createVectorStore('agent', { providerId: 'fixture', modelId: 'fixture' }, 2)
      ).rejects.toThrow()
      expect(readFileSync(file)).toEqual(retained)
      await admission.run({ ownerId: 'after-native-quarantine' }, async () => {})
      expect(runtime.identity).toEqual(identity)
      expect(runtime.memoryIdentity?.pid).toBe(worker.pid)
    }
  )
  it('rejects oversized results without abandoning the request or admission owner', async () => {
    const { runtime, stores, admission } = await create()
    const store = await stores.createVectorStore(
      'large-ids',
      { providerId: 'fixture', modelId: 'fixture' },
      2
    )
    for (let offset = 0; offset < 800; offset += 50) {
      await store.upsert(
        Array.from({ length: 50 }, (_, index) => ({
          memoryId: `${'x'.repeat(1000)}${offset + index}`,
          embedding: [1, 0]
        }))
      )
    }
    await expect(store.query([1, 0], { topK: 800 })).rejects.toMatchObject({
      name: 'MemoryVectorResponseLimitError'
    })
    expect(runtime.memoryTransport.pending).toBe(0)
    expect(await store.query([1, 0], { topK: 1 })).toHaveLength(1)
    await admission.run({ ownerId: 'after-large-result' }, async () => {})
  })
  it('fences another file owner before quarantine recovery or reset can touch live stores', async () => {
    const first = await create()
    const directory = path.join(first.root, 'memory')
    const store = await first.stores.createVectorStore(
      'agent',
      { providerId: 'fixture', modelId: 'fixture' },
      2
    )
    await store.upsert([{ memoryId: 'existing', embedding: [1, 0] }])
    writeFileSync(path.join(directory, 'agent.v2.duckdb.quarantine'), '')
    writeFileSync(path.join(directory, '.vector-owner.v2.duckdb.quarantine'), '')
    const second = await create(directory)
    await expect(
      second.stores.createVectorStore('agent', { providerId: 'fixture', modelId: 'fixture' }, 2)
    ).rejects.toMatchObject({ name: 'MemoryVectorOwnershipUnavailableError' })
    await expect(second.stores.resetVectorStore('agent')).rejects.toThrow('ownership')
    expect(await store.listMemoryIds(null, 512)).toEqual(['existing'])
    expect(existsSync(path.join(directory, 'agent.v2.duckdb.quarantine'))).toBe(true)
    await first.stores.dispose()
    await first.runtime.stop()
    const replacement = await create(directory)
    const recovered = await replacement.stores.createVectorStore(
      'agent',
      { providerId: 'fixture', modelId: 'fixture' },
      2
    )
    expect(recovered.isUsable()).toBe(false)
    await recovered.close()
    await replacement.stores.resetVectorStore('agent')
    const rebuilt = await replacement.stores.createVectorStore(
      'agent',
      { providerId: 'fixture', modelId: 'fixture' },
      2
    )
    expect(await rebuilt.listMemoryIds(null, 512)).toEqual([])
    expect(existsSync(path.join(directory, 'agent.v2.duckdb.quarantine'))).toBe(false)
    expect(existsSync(path.join(directory, MEMORY_VECTOR_OWNER_FILE))).toBe(true)
  })
  it('lazily owns the real native store in a separate process using the standalone closure', async () => {
    const { runtime, stores, root } = await create()
    const identity = runtime.identity!
    expect(runtime.memoryIdentity).toBeUndefined()
    await stores.resetVectorStore('unused')
    expect(runtime.memoryIdentity).toBeUndefined()
    const store = await stores.createVectorStore(
      'agent',
      { providerId: 'fixture', modelId: 'fixture' },
      2
    )
    const worker = runtime.memoryIdentity!
    expect([process.pid, identity.hostPid, identity.runtime.pid]).not.toContain(worker.pid)
    expect(worker.modules).toBe(identity.runtime.modules)
    await store.upsert([
      { memoryId: 'anchor', embedding: [1, 0] },
      { memoryId: 'other', embedding: [0, 1] }
    ])
    expect(await store.query([1, 0], { topK: 2 })).toEqual([
      { memoryId: 'anchor', distance: 0 },
      { memoryId: 'other', distance: 1 }
    ])
    await store.deleteByMemoryIds(['anchor'])
    await store.close()
    const reopened = await stores.createVectorStore(
      'agent',
      { providerId: 'fixture', modelId: 'fixture' },
      2
    )
    expect(await reopened.listMemoryIds(null, 512)).toEqual(['other'])
    await reopened.close()
    const mismatched = await stores.createVectorStore(
      'agent',
      { providerId: 'fixture', modelId: 'changed' },
      3
    )
    expect(mismatched.isUsable()).toBe(false)
    await expect(mismatched.query([1, 0, 0], { topK: 1 })).rejects.toThrow('unavailable')
    await mismatched.close()
    const original = await stores.createVectorStore(
      'agent',
      { providerId: 'fixture', modelId: 'fixture' },
      2
    )
    expect(await original.listMemoryIds(null, 512)).toEqual(['other'])
    await original.close()
    await stores.resetVectorStore('agent')
    expect(
      readdirSync(path.join(root, 'memory')).filter(
        (name) => !name.startsWith(MEMORY_VECTOR_OWNER_FILE)
      )
    ).toEqual([])
    const precision = await stores.createVectorStore(
      'precision',
      { providerId: 'fixture', modelId: 'fixture' },
      5
    )
    const values = [0, -0, 1 / 3, -3.4028234663852886e38, 1.401298464324817e-45]
    await precision.upsert([{ memoryId: 'float32', embedding: values }])
    await precision.close()
    const instance = await DuckDBInstance.create(path.join(root, 'memory', 'precision.v2.duckdb'))
    try {
      const connection = await instance.connect()
      try {
        const rows = await connection.runAndReadAll('SELECT embedding FROM memory_vector')
        expect(rows.getRowObjectsJson()).toEqual([{ embedding: values.map(Math.fround) }])
      } finally {
        connection.closeSync()
      }
    } finally {
      instance.closeSync()
    }
    expect(runtime.identity).toEqual(identity)
    expect(runtime.memoryIdentity).toEqual(worker)
    await stores.dispose()
    await runtime.stop()
    expect(() => process.kill(worker.pid, 0)).toThrow()
    expect(() => process.kill(identity.runtime.pid, 0)).toThrow()
  })

  it('serves admission while chunked vector batches run and isolates native worker death', async () => {
    const { runtime, stores, admission, root } = await create()
    const permit = await admission.acquire({ ownerId: 'parent' })
    const queued = admission.acquire({ ownerId: 'other' })
    void queued.catch(() => undefined)
    await expect.poll(async () => (await admission.snapshot()).pending).toBe(1)
    const store = await stores.createVectorStore(
      'agent',
      { providerId: 'fixture', modelId: 'fixture' },
      1536
    )
    expect(await admission.snapshot()).toMatchObject({ active: 1, pending: 1 })
    const identity = runtime.identity!
    const worker = runtime.memoryIdentity!
    const batch = Array.from({ length: 50 }, (_, row) => ({
      memoryId: randomUUID(),
      embedding: Array.from({ length: 1536 }, (_, index) => (index === row ? 1 : 0))
    }))
    const uploading = store.upsert(batch)
    await expect.poll(async () => (await admission.snapshot()).pending).toBe(1)
    permit.release()
    ;(await queued).release()
    await uploading
    expect(await store.listMemoryIds(null, 512)).toHaveLength(50)
    process.kill(worker.pid, 'SIGKILL')
    await expect.poll(() => store.isUsable()).toBe(false)
    expect(existsSync(path.join(root, 'memory', 'agent.v2.duckdb.lease'))).toBe(true)
    expect(() => process.kill(worker.pid, 0)).toThrow()
    await expect(store.query(batch[0].embedding, { topK: 1 })).rejects.toThrow()
    await expect(
      stores.createVectorStore('after-crash', { providerId: 'fixture', modelId: 'fixture' }, 2)
    ).rejects.toThrow()
    await admission.run({ ownerId: 'after-crash' }, async () => {})
    expect(await admission.snapshot()).toMatchObject({ active: 0, pending: 0 })
    expect(runtime.identity).toEqual(identity)
    expect(runtime.memoryIdentity).toEqual(worker)
    expect(() => process.kill(identity.runtime.pid, 0)).not.toThrow()
  })
})
