import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { HarnessRuntime } from '@/harness/runtime'
import { RutisMemoryVectorStores } from '@/harness/memory-vector'
import { MemoryVectorStore, createMemoryVectorStorePaths } from '@/memory/infra/memoryVectorStore'
import type { IMemoryVectorStore } from '@/memory/ports'

const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')
const require = createRequire(import.meta.url)
const DIMENSIONS = 1536
const embedding = { providerId: 'fixture', modelId: 'fixture' }
const percentile = (values: number[], fraction: number) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1]
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
const timed = async (task: () => Promise<unknown>) => {
  const start = performance.now()
  await task()
  return performance.now() - start
}
let directory: string
let runtime: HarnessRuntime | undefined
let stores: RutisMemoryVectorStores | undefined
let native: IMemoryVectorStore | undefined

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
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-vector-transport-perf-'))
})

afterEach(async () => {
  await native?.close()
  await stores?.dispose()
  await runtime?.stop()
  native = undefined
  stores = undefined
  runtime = undefined
  actualFs.rmSync(directory, { recursive: true, force: true })
})

it.each([1000, 10000, 50000])(
  'bounds actual vector transport overhead at %i rows',
  async (rows) => {
    const host = { appPath: path.resolve('.'), userDataPath: directory, isPackaged: false }
    const firstOpens: number[] = []
    let remote!: IMemoryVectorStore
    for (let sample = 0; sample < 5; sample++) {
      runtime = await HarnessRuntime.start({
        directory: path.resolve('out/harness'),
        electronExecutable: require('electron'),
        capacity: 1,
        maxPending: 4,
        observe: () => {}
      })
      stores = new RutisMemoryVectorStores(runtime, {
        memoryDbDir: path.join(directory, `remote-${sample}`),
        host
      })
      const openedAt = performance.now()
      remote = await stores.createVectorStore('agent', embedding, DIMENSIONS)
      firstOpens.push(performance.now() - openedAt)
      if (sample < 4) {
        await remote.close()
        await stores.dispose()
        await runtime.stop()
      }
    }
    const runningRuntime = runtime!
    native = await MemoryVectorStore.create(
      createMemoryVectorStorePaths(path.join(directory, 'native'), 'agent'),
      DIMENSIONS,
      embedding,
      host
    )
    const baseline = native
    const nativeWrites: number[] = []
    const remoteWrites: number[] = []
    for (let offset = 0; offset < rows; offset += 50) {
      const records = Array.from({ length: Math.min(50, rows - offset) }, (_, index) => ({
        memoryId: `memory-${String(offset + index).padStart(8, '0')}`,
        embedding: Array.from({ length: DIMENSIONS }, (_, component) =>
          component === (offset + index) % DIMENSIONS ? 1 : 0
        )
      }))
      const pair = [() => baseline.upsert(records), () => remote.upsert(records)]
      const times: number[] = []
      for (const index of offset % 100 === 0 ? [0, 1] : [1, 0])
        times[index] = await timed(pair[index])
      nativeWrites.push(times[0])
      remoteWrites.push(times[1])
    }
    const vector = Array.from({ length: DIMENSIONS }, (_, index) => (index === 0 ? 1 : 0))
    const query = (store: IMemoryVectorStore) => store.query(vector, { topK: 20 })
    await query(baseline)
    await query(remote)
    const traffic = runningRuntime.memoryTransport
    const nativeQueries: number[] = []
    const remoteQueries: number[] = []
    for (let sample = 0; sample < 30; sample++) {
      for (const index of sample % 2 ? [1, 0] : [0, 1]) {
        const target = index === 0 ? nativeQueries : remoteQueries
        target.push(await timed(() => query(index === 0 ? baseline : remote)))
      }
    }
    const nativeQueryP95 = percentile(nativeQueries, 0.95)
    const remoteQueryP95 = percentile(remoteQueries, 0.95)
    const nativeWriteMean = mean(nativeWrites)
    const remoteWriteMean = mean(remoteWrites)
    const report = {
      rows,
      dimensions: DIMENSIONS,
      firstOpens,
      firstOpenMedianMs: percentile(firstOpens, 0.5),
      firstOpenP95Ms: percentile(firstOpens, 0.95),
      nativeQueryP95,
      remoteQueryP95,
      nativeWriteMean,
      remoteWriteMean,
      queryTrafficBytes:
        runningRuntime.memoryTransport.sentBytes +
        runningRuntime.memoryTransport.receivedBytes -
        traffic.sentBytes -
        traffic.receivedBytes,
      pending: runningRuntime.memoryTransport.pending,
      peakPending: runningRuntime.memoryTransport.peakPending,
      nativeNode: process.versions.node,
      remoteNode: runningRuntime.memoryIdentity?.node,
      nativeModules: process.versions.modules,
      remoteModules: runningRuntime.memoryIdentity?.modules
    }
    process.stdout.write(`[memory-vector-transport] ${JSON.stringify(report)}\n`)
    expect(report.nativeNode, 'Use pnpm test:main:memory-perf for the Electron runtime').toBe(
      report.remoteNode
    )
    expect(report.nativeModules).toBe(report.remoteModules)
    expect(report.pending).toBe(0)
    expect(remoteQueryP95 - nativeQueryP95).toBeLessThanOrEqual(Math.max(5, nativeQueryP95 * 0.2))
    expect(remoteWriteMean - nativeWriteMean).toBeLessThanOrEqual(
      Math.max(5, nativeWriteMean * 0.25)
    )
    expect(report.firstOpenMedianMs).toBeLessThanOrEqual(500)
    expect(report.firstOpenP95Ms).toBeLessThanOrEqual(1000)
  },
  120_000
)
