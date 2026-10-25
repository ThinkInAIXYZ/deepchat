import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryVectorOwner } from '../../../src/harness/memory-vector'
import { MemoryVectorStore } from '@/memory/infra/memoryVectorStore'
import { MEMORY_VECTOR_OWNER_FILE } from '@/memory/infra/memoryVectorStorePaths'
import {
  decodeMemoryVector,
  encodeMemoryVector,
  MemoryVectorCommandSchema,
  type MemoryVectorNativeCommand,
  type MemoryVectorConfig
} from '@shared/harness/memory-vector'

const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')
let directory: string
let config: MemoryVectorConfig
let owner: MemoryVectorOwner
let resource: string
type Command = MemoryVectorNativeCommand extends infer T
  ? T extends MemoryVectorNativeCommand
    ? Omit<T, 'generation' | 'operation' | 'resource'> & { resource?: string }
    : never
  : never
const command = (input: Command) =>
  owner.command({
    resource,
    ...input,
    generation: config.generation,
    operation: randomUUID()
  })
const open = (agentId = 'agent-a', id = resource) =>
  command({
    method: 'open',
    resource: id,
    agentId,
    dimensions: 2,
    embedding: { providerId: 'fixture', modelId: 'fixture' }
  })
const upsert = (vectors: number[][]) =>
  command({
    method: 'upsert',
    upload: randomUUID(),
    bytes: vectors.length * 8,
    offset: 0,
    memoryIds: vectors.map((_, i) => `m${i}`),
    data: Buffer.concat(vectors.map((vector) => encodeMemoryVector(vector, 2)))
  })

beforeEach(() => {
  for (const method of [
    'existsSync',
    'readdirSync',
    'mkdirSync',
    'mkdtempSync',
    'rmSync',
    'renameSync',
    'writeFileSync'
  ] as const) {
    vi.mocked(fs[method]).mockImplementation(actualFs[method] as never)
  }
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-vector-owner-'))
  config = {
    generation: randomUUID(),
    memoryDbDir: directory,
    host: { appPath: path.resolve('.'), userDataPath: directory, isPackaged: false }
  }
  resource = randomUUID()
  owner = new MemoryVectorOwner(config)
})

afterEach(async () => {
  await owner.dispose()
  vi.restoreAllMocks()
  actualFs.rmSync(directory, { recursive: true, force: true })
})

describe('native Memory vector ownership', () => {
  it('orders mutations behind all native parts and aborts only the known upload', async () => {
    await open()
    const upload = randomUUID()
    const part = { method: 'upsert' as const, upload, memoryIds: ['m0'], bytes: 8 }
    await command({ ...part, offset: 0, data: Buffer.alloc(4) })
    const deleting = command({ method: 'delete', memoryIds: ['m0'] })
    let deleted = false
    void deleting.then(() => {
      deleted = true
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(deleted).toBe(false)
    await command({ method: 'abort', upload: randomUUID() })
    await expect(upsert([[1, 0]])).rejects.toThrow('busy')
    await expect(command({ ...part, offset: 0, data: Buffer.alloc(4) })).rejects.toThrow('busy')
    await command({
      ...part,
      memoryIds: [...part.memoryIds],
      offset: 4,
      data: encodeMemoryVector([1], 1)
    })
    await deleting
    expect(await command({ method: 'list', afterId: null, limit: 10 })).toEqual([])
    await command({ ...part, offset: 0, data: Buffer.alloc(4) })
    await command({ method: 'abort', upload })
    await upsert([[1, 0]])
    await command({ ...part, offset: 0, data: Buffer.alloc(4) })
    await command({ method: 'close' })
    resource = randomUUID()
    await open()
    expect(
      await command({
        method: 'query',
        vector: encodeMemoryVector([1, 0], 2).toString('base64'),
        topK: 1
      })
    ).toEqual([{ memoryId: 'm0', distance: 0 }])
  })

  it('publishes one complete validated batch and preserves vector-only recall across close', async () => {
    await open()
    await expect(
      command({
        method: 'upsert',
        upload: randomUUID(),
        bytes: 8,
        offset: 0,
        memoryIds: ['m0'],
        data: new Uint8Array(new SharedArrayBuffer(8))
      })
    ).rejects.toThrow('shape')
    await expect(
      command({
        method: 'upsert',
        upload: randomUUID(),
        bytes: 8,
        offset: 0,
        memoryIds: ['m0', 'm1'],
        data: encodeMemoryVector([1, 0], 2)
      })
    ).rejects.toThrow('shape')
    expect(await command({ method: 'list', afterId: null, limit: 512 })).toEqual([])
    const invalid = Buffer.alloc(16)
    invalid.writeFloatLE(Infinity)
    await expect(
      command({
        method: 'upsert',
        upload: randomUUID(),
        bytes: 16,
        offset: 0,
        memoryIds: ['m0', 'm1'],
        data: invalid
      })
    ).rejects.toThrow('non-finite')
    expect(await command({ method: 'list', afterId: null, limit: 512 })).toEqual([])
    await upsert([
      [1, 0],
      [0, 1]
    ])
    const query = {
      method: 'query',
      vector: encodeMemoryVector([1, 0], 2).toString('base64'),
      topK: 2
    } as const
    expect(await command(query)).toEqual([
      { memoryId: 'm0', distance: 0 },
      { memoryId: 'm1', distance: 1 }
    ])
    await command({ method: 'close' })
    resource = randomUUID()
    await open()
    expect(await command(query)).toEqual([
      { memoryId: 'm0', distance: 0 },
      { memoryId: 'm1', distance: 1 }
    ])
    expect(await command({ method: 'queryByMemoryId', memoryId: 'm0', topK: 2 })).toEqual([
      { memoryId: 'm1', distance: 1 }
    ])
    await command({ method: 'delete', memoryIds: ['m0'] })
    expect(await command({ method: 'list', afterId: null, limit: 512 })).toEqual(['m1'])
    await expect(
      owner.command({
        generation: randomUUID(),
        operation: randomUUID(),
        resource,
        method: 'close'
      })
    ).rejects.toThrow('generation')
    await expect(command({ method: 'delete', memoryIds: Array(513).fill('m1') })).rejects.toThrow()
    await expect(command({ ...query, resource: randomUUID() })).rejects.toThrow('unavailable')
  })

  it('retains a late native open until revocation has closed the returned handle', async () => {
    const gate = Promise.withResolvers<void>()
    const create = MemoryVectorStore.create.bind(MemoryVectorStore)
    vi.spyOn(MemoryVectorStore, 'create').mockImplementationOnce(async (...args) => {
      await gate.promise
      return create(...args)
    })
    const opening = expect(open()).rejects.toThrow('revoked')
    const closing = command({ method: 'close' })
    let closed = false
    void closing.then(() => {
      closed = true
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(closed).toBe(false)
    await expect(open('agent-a', randomUUID())).rejects.toThrow('owner')
    gate.resolve()
    await Promise.all([opening, closing])
    resource = randomUUID()
    await open()
  })

  it('supports more than eight agents while limiting active native opens to two', async () => {
    const gate = Promise.withResolvers<void>()
    const create = MemoryVectorStore.create.bind(MemoryVectorStore)
    let active = 0
    let peak = 0
    vi.spyOn(MemoryVectorStore, 'create').mockImplementation(async (...args) => {
      active++
      peak = Math.max(active, peak)
      try {
        await gate.promise
        return await create(...args)
      } finally {
        active--
      }
    })
    const opens = Array.from({ length: 9 }, (_, index) => open(`agent-${index}`, randomUUID()))
    const completed = Promise.all(opens)
    void completed.catch(() => undefined)
    try {
      await expect.poll(() => active).toBe(2)
    } finally {
      gate.resolve()
    }
    await completed
    expect(peak).toBe(2)
  })

  it('waits for an executing write before reset can remove files', async () => {
    await open()
    const gate = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    const upsert = MemoryVectorStore.prototype.upsertPacked
    vi.spyOn(MemoryVectorStore.prototype, 'upsertPacked').mockImplementation(
      async function (records) {
        started.resolve()
        await gate.promise
        return upsert.call(this, records)
      }
    )
    const commit = command({
      method: 'upsert',
      upload: randomUUID(),
      bytes: 8,
      offset: 0,
      memoryIds: ['m0'],
      data: encodeMemoryVector([1, 0], 2)
    })
    await started.promise
    const reset = owner.command({
      method: 'reset',
      generation: config.generation,
      operation: randomUUID(),
      agentId: 'agent-a'
    })
    let removed = false
    void reset.then(() => {
      removed = true
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(removed).toBe(false)
    expect(actualFs.existsSync(path.join(directory, 'agent-a.v2.duckdb'))).toBe(true)
    await expect(command({ method: 'queryByMemoryId', memoryId: 'm0', topK: 1 })).rejects.toThrow(
      'unavailable'
    )
    gate.resolve()
    await Promise.all([commit, reset])
    expect(
      actualFs.readdirSync(directory).filter((name) => !name.startsWith(MEMORY_VECTOR_OWNER_FILE))
    ).toEqual([])
    expect(actualFs.existsSync(path.join(directory, MEMORY_VECTOR_OWNER_FILE))).toBe(true)
  })

  it('uses finite Float32 values with explicit little-endian byte order', () => {
    const values = [0, -0, 1 / 3, -3.4028234663852886e38, 1.401298464324817e-45]
    const bytes = encodeMemoryVector(values, values.length)
    expect(decodeMemoryVector(bytes, values.length)).toEqual(values.map(Math.fround))
    expect(encodeMemoryVector([1], 1).toString('hex')).toBe('0000803f')
    expect(() => encodeMemoryVector([1e39], 1)).toThrow('non-finite')
    expect(() => encodeMemoryVector([NaN], 1)).toThrow('non-finite')
    expect(() => decodeMemoryVector(Buffer.alloc(3), 1)).toThrow('length')
  })

  it('accepts canonical base64 and rejects malformed or oversized wire data', () => {
    const accepts = (data: string) =>
      MemoryVectorCommandSchema.safeParse({
        method: 'query',
        resource,
        generation: config.generation,
        operation: randomUUID(),
        topK: 1,
        vector: data
      }).success
    for (const data of ['', 'AA==', 'AAA=', 'AAAA', Buffer.alloc(65536).toString('base64')])
      expect(accepts(data)).toBe(true)
    for (const data of ['AB==', 'AAB=', 'A===', 'AA=A', 'AA==\n', '____', 'A'.repeat(262144)])
      expect(accepts(data)).toBe(false)
  })

  it('accepts only bounded application upload bytes', () => {
    const accepts = (data: unknown) =>
      MemoryVectorCommandSchema.safeParse({
        method: 'chunk',
        resource,
        generation: config.generation,
        operation: randomUUID(),
        upload: randomUUID(),
        offset: 0,
        data
      }).success
    for (const data of [Buffer.alloc(1), new Uint8Array(65536)]) expect(accepts(data)).toBe(true)
    for (const data of ['', 'AAAA', [0, 0, 0], new Uint8Array(0), Buffer.alloc(65537)])
      expect(accepts(data)).toBe(false)
  })
})
