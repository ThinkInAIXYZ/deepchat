import type { AgentInvocationAdmissionObservation } from '@shared/harness/admission'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, cpSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { HarnessRuntime } from '@/harness/runtime'
import { CoreRuntimeConnection } from '@/harness/core'

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

async function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'deepchat-core-admission-'))
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
        entry: path.resolve('test/fixtures/harness/core-admission.ts'),
        formats: ['es'],
        fileName: () => 'core.mjs'
      },
      rollupOptions: { external: [/^node:/] }
    }
  })
  const observations: AgentInvocationAdmissionObservation[] = []
  const runtime = await HarnessRuntime.start({
    directory: harness,
    electronExecutable: process.execPath,
    capacity: 1,
    maxPending: 4,
    observe(value) {
      observations.push(value)
    }
  })
  cleanups.push(() => runtime.stop())
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const connection = await CoreRuntimeConnection.connect({
    runtime,
    temporaryDirectory: directory,
    native: async (method, args) => {
      expect(method).toBe('profile.logging')
      expect(args).toEqual([true])
      entered.resolve()
      await release.promise
    }
  })
  cleanups.push(() => connection.closeAfterHostExit())
  cleanups.push(() => release.resolve())
  const identity = await connection.status()
  const parent = Number(
    (process.platform === 'win32'
      ? execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${identity.pid}').ParentProcessId`
          ],
          { encoding: 'utf8' }
        )
      : execFileSync('ps', ['-o', 'ppid=', '-p', String(identity.pid)], { encoding: 'utf8' })
    ).trim()
  )
  expect(parent).toBe(runtime.identity?.hostPid)
  return { runtime, connection, entered, release, pid: identity.pid, observations }
}

it('shares one quota with Main while preserving Core cancellation and command ordering', async () => {
  const f = await fixture()
  const main = randomUUID()
  await f.runtime.request('acquire', [main, { ownerId: 'main', maxActiveForOwner: 1 }, true])
  const working = f.connection.configure({ operation: 'read', input: {} })
  await expect
    .poll(async () => await f.runtime.request('snapshot', []))
    .toMatchObject({
      admission: { active: 1, pending: 1, rejected: 1 }
    })
  await f.runtime.request('release', [main, 'permit_released', true])
  await f.entered.promise
  await expect(f.runtime.request('snapshot', [])).resolves.toMatchObject({
    admission: { active: 1, pending: 0 }
  })
  f.release.resolve()
  await expect(working).resolves.toMatchObject({ active: 0, pending: 0, closed: false })
  await expect(f.connection.stop()).resolves.toMatchObject({ phase: 'stopped' })
  await expect(f.runtime.request('snapshot', [])).resolves.toMatchObject({
    admission: { closed: true }
  })
  expect(f.observations.some((value) => value.type === 'closed')).toBe(true)
})

it('fences the shared quota after physical Core loss with a permit and Native effect pending', async () => {
  const f = await fixture()
  const working = f.connection.configure({ operation: 'read', input: {} }).catch((error) => error)
  await f.entered.promise
  const queued = f.runtime
    .request('acquire', [randomUUID(), { ownerId: 'waiting-main' }, true])
    .catch((error) => error)
  await expect
    .poll(async () => await f.runtime.request('snapshot', []))
    .toMatchObject({
      admission: { active: 1, pending: 1 }
    })
  process.kill(f.pid, 'SIGKILL')
  await expect(working).resolves.toMatchObject({ name: 'CoreOperationOutcomeUnknownError' })
  await expect(queued).resolves.toMatchObject({ name: 'AgentInvocationAdmissionClosedError' })
  await expect(f.runtime.request('snapshot', [])).resolves.toMatchObject({
    admission: { closed: true, pending: 0 }
  })
  expect(f.observations.some((value) => value.type === 'closed')).toBe(true)
  f.release.resolve()
})
