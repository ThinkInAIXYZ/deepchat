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
  type MemoryVectorCommand,
  type MemoryVectorConfig
} from '@shared/harness/memory-vector'

const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')
let directory: string
let config: MemoryVectorConfig
let owner: MemoryVectorOwner
let resource: string
type Command = MemoryVectorCommand extends infer T
  ? T extends MemoryVectorCommand
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
const begin = async (vectors: number[][]) => {
  const upload = randomUUID()
  const bytes = Buffer.concat(vectors.map((vector) => encodeMemoryVector(vector, 2)))
  await command({
    method: 'begin',
    upload,
    memoryIds: vectors.map((_, i) => `m${i}`),
    bytes: bytes.length
  })
  await command({ method: 'chunk', upload, offset: 0, data: bytes.toString('base64') })
  return upload
}

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
  it('publishes one complete validated batch and preserves vector-only recall across close', async () => {
    await open()
    const upload = randomUUID()
    await command({ method: 'begin', upload, memoryIds: ['m0', 'm1'], bytes: 16 })
    await command({
      method: 'chunk',
      upload,
      offset: 0,
      data: encodeMemoryVector([1, 0], 2).toString('base64')
    })
    await expect(command({ method: 'commit', upload })).rejects.toThrow('incomplete')
    expect(await command({ method: 'list', afterId: null, limit: 512 })).toEqual([])
    const invalid = Buffer.alloc(8)
    invalid.writeFloatLE(Infinity)
    await command({ method: 'chunk', upload, offset: 8, data: invalid.toString('base64') })
    await expect(command({ method: 'commit', upload })).rejects.toThrow('non-finite')
    expect(await command({ method: 'list', afterId: null, limit: 512 })).toEqual([])
    await command({ method: 'abort', upload })
    await command({
      method: 'commit',
      upload: await begin([
        [1, 0],
        [0, 1]
      ])
    })
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
    const upsert = MemoryVectorStore.prototype.upsert
    vi.spyOn(MemoryVectorStore.prototype, 'upsert').mockImplementation(async function (records) {
      started.resolve()
      await gate.promise
      return upsert.call(this, records)
    })
    const commit = command({ method: 'commit', upload: await begin([[1, 0]]) })
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
})
