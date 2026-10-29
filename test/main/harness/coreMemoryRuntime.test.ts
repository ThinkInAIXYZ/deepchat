import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { afterEach, expect, it, vi } from 'vitest'
import { CoreRuntimeConnection } from '@/harness/core'
import { HarnessRuntime } from '@/harness/runtime'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')
vi.unmock('child_process')
vi.unmock('node:child_process')

const cleanups: Array<() => unknown | Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

function assertChild(pid: number, parent: number | undefined) {
  const actual = Number(
    (process.platform === 'win32'
      ? execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').ParentProcessId`
          ],
          { encoding: 'utf8' }
        )
      : execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' })
    ).trim()
  )
  expect(actual).toBe(parent)
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'deepchat-core-memory-'))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  const harness = path.join(directory, 'harness')
  cpSync(path.resolve('out/harness'), harness, { recursive: true })
  const { build } = await vi.importActual<typeof import('vite')>('vite')
  await build({
    configFile: false,
    publicDir: false,
    logLevel: 'silent',
    resolve: {
      conditions: ['node'],
      mainFields: ['module', 'main'],
      alias: { '@': path.resolve('src/main'), '@shared': path.resolve('src/shared') }
    },
    build: {
      target: 'node24',
      outDir: harness,
      emptyOutDir: false,
      copyPublicDir: false,
      lib: {
        entry: path.resolve('test/fixtures/harness/core-memory.ts'),
        formats: ['es'],
        fileName: () => 'core.mjs'
      },
      rollupOptions: { external: [/^node:/] }
    }
  })
  const runtime = await HarnessRuntime.start({
    directory: harness,
    electronExecutable: process.execPath,
    capacity: 1,
    maxPending: 4,
    observe() {}
  })
  cleanups.push(() => runtime.stop())
  const connection = await CoreRuntimeConnection.connect({
    runtime,
    temporaryDirectory: directory,
    native: async () => {
      throw new Error('Unexpected Native operation')
    }
  })
  cleanups.push(() => connection.closeAfterHostExit())
  const core = await connection.status()
  assertChild(core.pid, runtime.identity?.hostPid)
  const memoryDbDir = path.join(directory, 'memory')
  await connection.openProfile({
    userDataDirectory: directory,
    homeDirectory: directory,
    currentAppVersion: '1.1.4',
    systemLocale: 'en-US',
    appPath: path.resolve('.'),
    isPackaged: false
  })
  const command = (action: string) =>
    connection.configure(
      action === 'start'
        ? { operation: 'initialize' }
        : action === 'write'
          ? { operation: 'nativeSnapshot' }
          : { operation: 'read', input: {} }
    )
  const start = async () => {
    const identity = (await command('start')) as { pid: number; generation: string }
    assertChild(identity.pid, runtime.identity?.hostPid)
    expect(identity.pid).not.toBe(core.pid)
    return identity
  }
  return { runtime, connection, memoryDbDir, core, start, command }
}

it('preserves packed data through Core and releases the native owner before stop returns', async () => {
  const f = await fixture()
  const memory = await f.start()
  expect((await f.start()).pid).toBe(memory.pid)
  const result = (await f.command('write')) as { before: string[]; after: string[] }
  expect(result.before).toEqual(
    Array.from({ length: 45 }, (_, i) => `row-${String(i).padStart(2, '0')}`)
  )
  expect(result.after).toEqual(result.before.slice(1))
  await expect(
    f.runtime.startMemory({
      generation: randomUUID(),
      memoryDbDir: f.memoryDbDir,
      host: { appPath: path.resolve('.'), userDataPath: f.memoryDbDir, isPackaged: false }
    })
  ).rejects.toThrow('owned by Core')
  await f.connection.stop()
  expect(alive(memory.pid)).toBe(false)
  const instance = await DuckDBInstance.create(path.join(f.memoryDbDir, 'core-data.v2.duckdb'))
  try {
    const connection = await instance.connect()
    try {
      const values = await connection.runAndReadAll(
        "SELECT embedding[45] AS anchor, embedding[2048] AS fraction, list_sum(embedding)::FLOAT AS total FROM memory_vector WHERE memory_id = 'row-44'"
      )
      expect(values.getRowObjectsJson()).toEqual([{ anchor: 1, fraction: -0.25, total: 0.75 }])
    } finally {
      connection.closeSync()
    }
  } finally {
    instance.closeSync()
  }
})

it('preserves a Main-owned Memory generation when Core is denied and stopped', async () => {
  const f = await fixture()
  const generation = randomUUID()
  await f.runtime.startMemory({
    generation,
    memoryDbDir: f.memoryDbDir,
    host: { appPath: path.resolve('.'), userDataPath: f.memoryDbDir, isPackaged: false }
  })
  await expect(f.start()).rejects.toMatchObject({
    name: 'MemoryVectorStoreQuarantineRequiredError'
  })
  await f.connection.stop()
  expect(f.runtime.memoryAvailable).toBe(true)
  await expect(
    f.runtime.requestMemory({
      method: 'reset',
      generation,
      operation: randomUUID(),
      agentId: 'after-core-stop'
    })
  ).resolves.toBeNull()
  await expect(f.runtime.request('snapshot', [])).resolves.toHaveProperty('admission')
})

it('reaps Core-owned Memory after physical Core loss without restarting it', async () => {
  const f = await fixture()
  const memory = await f.start()
  process.kill(f.core.pid, 'SIGKILL')
  await expect.poll(() => alive(memory.pid)).toBe(false)
  await expect(f.connection.status()).rejects.toThrow('Core runtime stopped')
  await expect(f.runtime.request('snapshot', [])).resolves.toHaveProperty('admission')
})

it('marks physical Memory loss unavailable while preserving the Rust control path', async () => {
  const f = await fixture()
  const memory = await f.start()
  process.kill(memory.pid, 'SIGKILL')
  await expect.poll(async () => await f.command('available')).toEqual({ available: false })
  await expect(f.start()).rejects.toMatchObject({
    name: 'MemoryVectorStoreQuarantineRequiredError'
  })
  await expect(f.runtime.request('snapshot', [])).resolves.toHaveProperty('admission')
  await f.connection.stop()
})
