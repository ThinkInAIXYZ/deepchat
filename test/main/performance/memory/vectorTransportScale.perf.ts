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
      nativeFirstWrites: nativeWrites.slice(0, 5),
      remoteFirstWrites: remoteWrites.slice(0, 5),
      nativeLastWrites: nativeWrites.slice(-5),
      remoteLastWrites: remoteWrites.slice(-5),
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
    // Diagnostics follow adoption timings so they cannot warm the measured writes.
    const phases: Record<string, number[]> = {}
    const request = runningRuntime.requestMemory.bind(runningRuntime)
    const spy = vi.spyOn(runningRuntime, 'requestMemory').mockImplementation(async (command) => {
      const start = performance.now()
      try {
        return await request(command)
      } finally {
        const values = (phases[command.method] ??= [])
        values.push(performance.now() - start)
      }
    })
    const diagnosticRecords = Array.from({ length: 50 }, (_, index) => ({
      memoryId: `diagnostic-${index}`,
      embedding: vector
    }))
    const diagnosticNative: number[] = []
    const diagnosticRemote: number[] = []
    try {
      for (let sample = 0; sample < 5; sample++) {
        diagnosticNative.push(await timed(() => baseline.upsert(diagnosticRecords)))
        diagnosticRemote.push(await timed(() => remote.upsert(diagnosticRecords)))
      }
    } finally {
      spy.mockRestore()
    }
    process.stdout.write(
      `[memory-vector-upload-phases] ${JSON.stringify({
        rows,
        nativeWriteMean: mean(diagnosticNative),
        remoteWriteMean: mean(diagnosticRemote),
        phases: Object.fromEntries(
          Object.entries(phases).map(([method, values]) => [
            method,
            { count: values.length, meanMs: mean(values), p95Ms: percentile(values, 0.95) }
          ])
        )
      })}\n`
    )
    expect(runningRuntime.memoryTransport.pending).toBe(0)
    if (process.env.CI && process.platform !== 'win32') {
      const profileDir = path.join(directory, 'cpu-profile')
      actualFs.mkdirSync(profileDir)
      const wrapper = path.join(directory, 'profile-electron')
      const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
      actualFs.writeFileSync(
        wrapper,
        `#!/bin/sh
case " $* " in
  *--max-semi-space-size=*) exec ${shellQuote(require('electron'))} --cpu-prof --cpu-prof-dir=${shellQuote(profileDir)} --cpu-prof-name=memory.cpuprofile "$@" ;;
  *) exec ${shellQuote(require('electron'))} "$@" ;;
esac
`
      )
      actualFs.chmodSync(wrapper, 0o700)
      const profiledRuntime = await HarnessRuntime.start({
        directory: path.resolve('out/harness'),
        electronExecutable: wrapper,
        capacity: 1,
        maxPending: 4,
        observe: () => {}
      })
      const profiledStores = new RutisMemoryVectorStores(profiledRuntime, {
        memoryDbDir: path.join(directory, 'profile-memory'),
        host
      })
      try {
        const store = await profiledStores.createVectorStore('agent', embedding, DIMENSIONS)
        for (let sample = 0; sample < 100; sample++) await store.upsert(diagnosticRecords)
      } finally {
        await profiledStores.dispose()
        await profiledRuntime.stop()
      }
      const profile = JSON.parse(
        actualFs.readFileSync(path.join(profileDir, 'memory.cpuprofile'), 'utf8')
      ) as {
        samples: number[]
        nodes: Array<{
          id: number
          callFrame: { functionName: string; url: string; lineNumber: number }
        }>
      }
      const hits = new Map<number, number>()
      for (const id of profile.samples) hits.set(id, (hits.get(id) ?? 0) + 1)
      process.stdout.write(
        `[memory-vector-cpu-profile] ${JSON.stringify({
          rows,
          samples: profile.samples.length,
          frames: profile.nodes
            .map((node) => ({ ...node.callFrame, hits: hits.get(node.id) ?? 0 }))
            .sort((a, b) => b.hits - a.hits)
            .slice(0, 25)
        })}\n`
      )
    }
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
