import { createCoreConfigurationNative } from '@/harness/configuration'
import type { NativeConfigurationSnapshot } from '@shared/types/nativeConfiguration'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, statSync, cpSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { describeIfNativeSqlite } from '../nativeSqliteHarness'
import { HarnessRuntime } from '@/harness/runtime'
import { CoreRuntimeConnection, createCoreProfileNative } from '@/harness/core'
import { initializeCoreProfile } from '@/app/profileStartup'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')
vi.unmock('child_process')
vi.unmock('node:child_process')

describeIfNativeSqlite('Rutis Core profile ownership', () => {
  const cleanups: Array<() => void | Promise<void>> = []
  afterEach(async () => {
    vi.useRealTimers()
    for (const cleanup of cleanups.reverse()) await cleanup()
    cleanups.length = 0
  })

  async function fixture(
    options: {
      available?: () => Promise<boolean>
      detached?: boolean
      publishSnapshot?: (snapshot: NativeConfigurationSnapshot) => Promise<void>
      refreshTheme?: (isDark: boolean) => Promise<void>
      readTheme?: () => Promise<{ theme: 'dark' | 'light' | 'system'; isDark: boolean }>
      transport?: (runtime: HarnessRuntime) => Pick<HarnessRuntime, 'connectCore' | 'stop'>
    } = {}
  ) {
    const directory = mkdtempSync(path.join(tmpdir(), 'rutis-core-test-'))
    const userDataDirectory = path.join(directory, 'profile')
    mkdirSync(userDataDirectory)
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
    const harness = options.detached ? path.join(directory, 'harness') : path.resolve('out/harness')
    if (options.detached) cpSync(path.resolve('out/harness'), harness, { recursive: true })
    const runtime = await HarnessRuntime.start({
      directory: harness,
      electronExecutable: process.execPath,
      capacity: 1,
      maxPending: 4,
      observe() {}
    })
    cleanups.push(() => runtime.stop())
    const unexpected = async (): Promise<string> => {
      throw new Error('Unexpected Native operation')
    }
    const host = {
      setLoggingEnabled: vi.fn(async () => {}),
      showDatabaseUnlockProgress: vi.fn(async () => {}),
      requestDatabaseUnlock: vi.fn(async () => null),
      requestDatabaseRecovery: vi.fn(async () => null),
      quit: vi.fn(async () => {})
    }
    const crypto = {
      isAvailable: options.available ?? (async () => false),
      encrypt: unexpected,
      decrypt: unexpected,
      getBackend: async () => undefined
    }
    const nativeSnapshots: NativeConfigurationSnapshot[] = []
    const publishEvent = vi.fn()
    const desktop = {
      systemLocale: 'en-US',
      readTheme: options.readTheme ?? (async () => ({ theme: 'system' as const, isDark: false })),
      applyTheme: async () => false,
      refreshLanguage: async () => {},
      refreshTheme: async (isDark) => {
        await options.refreshTheme?.(isDark)
      },
      readLaunchAtLogin: async () => false,
      setLaunchAtLogin: async (enabled: boolean) => enabled,
      applyContentProtection: async () => {},
      applyFloatingButtonEnabled: async () => {}
    }
    const profileNative = createCoreProfileNative(crypto, host)
    const configurationNative = createCoreConfigurationNative({
      desktop,
      logging: { applyLogging: async () => {}, openLoggingFolder: async () => {} },
      enumerateFonts: async () => ['Fixture Sans'],
      publishNativeSnapshot: async (snapshot) => {
        if (options.publishSnapshot) await options.publishSnapshot(snapshot)
        nativeSnapshots.push(snapshot)
      },
      publishEvent
    })
    const connection = await CoreRuntimeConnection.connect({
      runtime: options.transport?.(runtime) ?? runtime,
      temporaryDirectory: directory,
      native: (method, args) =>
        method === 'configuration' ? configurationNative(method, args) : profileNative(method, args)
    })
    cleanups.push(() => connection.closeAfterHostExit())
    const profileOptions = {
      userDataDirectory,
      homeDirectory: directory,
      currentAppVersion: '1.1.4',
      systemLocale: 'en-US',
      appPath: path.resolve('.'),
      isPackaged: false
    }
    return {
      runtime,
      connection,
      directory,
      options: profileOptions,
      host,
      crypto,
      nativeSnapshots,
      publishEvent
    }
  }

  it(
    'holds the actual writer in Core while Memory and admission remain mounted',
    { timeout: 30_000 },
    async () => {
      const f = await fixture({ detached: true })
      const status = await f.connection.openProfile(f.options)
      expect(status).toMatchObject({ phase: 'profile-open', businessReady: false })
      expect(status.pid).not.toBe(process.pid)
      expect(f.host.setLoggingEnabled).toHaveBeenCalledOnce()
      await f.connection.configure({ operation: 'initialize' })
      await expect(
        f.connection.configure({
          operation: 'update',
          input: {
            changes: [
              { key: 'notificationsEnabled', value: false },
              { key: 'fontSizeLevel', value: 4 }
            ]
          }
        })
      ).resolves.toMatchObject({ values: { notificationsEnabled: false, fontSizeLevel: 4 } })
      expect(f.nativeSnapshots.at(-1)).toMatchObject({
        ownerId: f.connection.payloads.config.generation,
        notificationsEnabled: false
      })
      expect(f.publishEvent).toHaveBeenCalledWith(
        'settings.changed',
        expect.objectContaining({
          changedKeys: ['notificationsEnabled'],
          values: { notificationsEnabled: false }
        })
      )
      await expect(
        f.connection.configure({
          operation: 'read',
          input: {
            keys: ['notificationsEnabled', 'fontSizeLevel']
          }
        })
      ).resolves.toMatchObject({ values: { notificationsEnabled: false, fontSizeLevel: 4 } })
      expect(
        statSync(path.join(f.options.userDataDirectory, 'app_db', 'agent.db')).size
      ).toBeGreaterThan(0)
      await expect(
        initializeCoreProfile({ ...f.options, host: f.host, crypto: f.crypto })
      ).rejects.toMatchObject({ name: 'CoreProfileOwnershipUnavailableError' })
      await f.runtime.startMemory({
        generation: randomUUID(),
        memoryDbDir: path.join(f.directory, 'memory'),
        host: { appPath: process.cwd(), userDataPath: f.directory, isPackaged: false }
      })
      expect(await f.connection.status()).toMatchObject({ pid: status.pid, phase: 'profile-open' })
      await expect(f.runtime.request('snapshot', [])).resolves.toHaveProperty('admission')
      await expect(f.connection.stop()).resolves.toMatchObject({ phase: 'stopped' })
      expect(f.runtime.memoryAvailable).toBe(true)
      const reopened = await initializeCoreProfile({ ...f.options, host: f.host, crypto: f.crypto })
      expect(reopened.settingsStore.get('notificationsEnabled')).toBe(false)
      expect(reopened.settingsStore.get('fontSizeLevel')).toBe(4)
      reopened.closeProfile()
    }
  )

  it(
    'keeps ownership until a pending Native startup effect actually settles',
    { timeout: 30_000 },
    async () => {
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<boolean>()
      const f = await fixture({
        available: async () => {
          entered.resolve()
          return await release.promise
        }
      })
      const opening = f.connection.openProfile(f.options)
      const rejected = expect(opening).rejects.toThrow()
      try {
        await entered.promise
        const stopping = f.connection.stop()
        await expect.poll(async () => (await f.connection.status()).phase).toBe('stopping')
        await expect(
          initializeCoreProfile({ ...f.options, host: f.host, crypto: f.crypto })
        ).rejects.toMatchObject({ name: 'CoreProfileOwnershipUnavailableError' })
        release.resolve(false)
        await rejected
        await expect(stopping).resolves.toMatchObject({ phase: 'stopped' })
        const reopened = await initializeCoreProfile({
          ...f.options,
          host: f.host,
          crypto: f.crypto
        })
        reopened.closeProfile()
      } finally {
        release.resolve(false)
      }
    }
  )

  it(
    'drains a real Native configuration receipt before retiring the profile',
    { timeout: 30_000 },
    async () => {
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const f = await fixture({
        publishSnapshot: async () => {
          entered.resolve()
          await release.promise
        }
      })
      await f.connection.openProfile(f.options)
      const writing = f.connection.configure({
        operation: 'update',
        input: {
          changes: [{ key: 'notificationsEnabled', value: false }]
        }
      })
      const settled = Promise.allSettled([writing])
      try {
        await entered.promise
        expect(f.publishEvent).not.toHaveBeenCalled()
        const stopping = f.connection.stop()
        await expect.poll(async () => (await f.connection.status()).phase).toBe('stopping')
        await expect(
          initializeCoreProfile({ ...f.options, host: f.host, crypto: f.crypto })
        ).rejects.toMatchObject({ name: 'CoreProfileOwnershipUnavailableError' })
        release.resolve()
        await settled
        await expect(stopping).resolves.toMatchObject({ phase: 'stopped' })
        const reopened = await initializeCoreProfile({
          ...f.options,
          host: f.host,
          crypto: f.crypto
        })
        expect(reopened.settingsStore.get('notificationsEnabled')).toBe(false)
        reopened.closeProfile()
      } finally {
        release.resolve()
      }
    }
  )

  it(
    'coalesces native observations and reserves shutdown with ordinary calls saturated',
    { timeout: 30_000 },
    async () => {
      const pause = () => ({
        entered: Promise.withResolvers<void>(),
        release: Promise.withResolvers<void>()
      })
      let receipt = pause()
      let isDark = false
      const refreshTheme = vi.fn(async (_isDark: boolean) => {
        const current = receipt
        current.entered.resolve()
        await current.release.promise
      })
      const f = await fixture({
        refreshTheme,
        readTheme: async () => ({ theme: 'system', isDark })
      })
      await f.connection.openProfile(f.options)
      try {
        const observing = f.connection.observeSystemTheme()
        const observed = Promise.allSettled([observing])
        await receipt.entered.promise
        const ordinary = Array.from({ length: 4 }, () =>
          f.connection.configure({ operation: 'read', input: { keys: ['fontFamily'] } })
        )
        const settled = Promise.allSettled(ordinary)
        expect(f.connection.observeSystemTheme()).toBe(observing)
        isDark = true
        await expect(f.connection.status()).resolves.toMatchObject({ phase: 'profile-open' })
        receipt.release.resolve()
        await expect(observing).resolves.toBeUndefined()
        await observed
        await settled
        expect(refreshTheme).toHaveBeenLastCalledWith(true)
        expect(f.publishEvent).toHaveBeenLastCalledWith(
          'config.systemTheme.changed',
          expect.objectContaining({ isDark: true })
        )

        receipt = pause()
        const finalObservation = Promise.allSettled([f.connection.observeSystemTheme()])
        await receipt.entered.promise
        const queued = Promise.allSettled(
          Array.from({ length: 4 }, () =>
            f.connection.configure({ operation: 'read', input: { keys: ['fontFamily'] } })
          )
        )
        const stopping = f.connection.stop()
        await expect.poll(async () => (await f.connection.status()).phase).toBe('stopping')
        await expect(
          initializeCoreProfile({ ...f.options, host: f.host, crypto: f.crypto })
        ).rejects.toMatchObject({ name: 'CoreProfileOwnershipUnavailableError' })
        receipt.release.resolve()
        await finalObservation
        await queued
        await expect(stopping).resolves.toMatchObject({ phase: 'stopped' })
        const reopened = await initializeCoreProfile({
          ...f.options,
          host: f.host,
          crypto: f.crypto
        })
        reopened.closeProfile()
      } finally {
        receipt.release.resolve()
      }
    }
  )

  it(
    'keeps an unacknowledged stop unknown until actual retirement',
    { timeout: 30_000 },
    async () => {
      const dropped = Promise.withResolvers<void>()
      let stopId = 0
      const f = await fixture({
        transport: (runtime) => ({
          stop: () => runtime.stop(),
          connectCore: (config, listener) => {
            const send = runtime.connectCore(config, {
              ...listener,
              message: (frame) => {
                if (frame.type === 'coreReply' && frame.id === stopId) {
                  dropped.resolve()
                  return
                }
                if (frame.type === 'coreStopped') dropped.reject(new Error(frame.message))
                listener.message(frame)
              }
            })
            return (request) => {
              if (request.type === 'coreCall' && request.method === 'stop') stopId = request.id
              send(request)
            }
          }
        })
      })
      await f.connection.openProfile(f.options)
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        const stopped = expect(f.connection.stop()).rejects.toMatchObject({
          name: 'CoreOperationOutcomeUnknownError'
        })
        await dropped.promise
        await vi.advanceTimersByTimeAsync(30_000)
        await stopped
      } finally {
        vi.useRealTimers()
      }
      expect(existsSync(f.connection.payloads.config.directory)).toBe(true)
      await expect(f.connection.status()).resolves.toMatchObject({ phase: 'stopped' })
    }
  )

  it(
    'releases a crashed Core owner without silently adopting a replacement',
    { timeout: 30_000 },
    async () => {
      let send!: ReturnType<HarnessRuntime['connectCore']>
      const f = await fixture({
        transport: (runtime) => ({
          stop: () => runtime.stop(),
          connectCore: (config, listener) => {
            send = runtime.connectCore(config, listener)
            return send
          }
        })
      })
      const status = await f.connection.openProfile(f.options)
      const parent = Number(
        (process.platform === 'win32'
          ? execFileSync(
              'powershell.exe',
              [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${status.pid}').ParentProcessId`
              ],
              { encoding: 'utf8' }
            )
          : execFileSync('ps', ['-o', 'ppid=', '-p', String(status.pid)], { encoding: 'utf8' })
        ).trim()
      )
      expect(parent).toBe(f.runtime.identity?.hostPid)
      process.kill(status.pid, 'SIGKILL')
      await expect
        .poll(async () => {
          try {
            await f.connection.status()
            return false
          } catch {
            return true
          }
        })
        .toBe(true)
      await expect(
        CoreRuntimeConnection.connect({
          runtime: f.runtime,
          temporaryDirectory: f.directory,
          native: createCoreProfileNative(f.crypto, f.host)
        })
      ).rejects.toMatchObject({ name: 'CoreGenerationAlreadyAdoptedError' })
      send({
        type: 'coreCall',
        id: 999,
        method: 'status',
        args: await f.connection.payloads.encode(undefined)
      })
      await expect(f.runtime.request('snapshot', [])).resolves.toHaveProperty('admission')
      const reopened = await initializeCoreProfile({ ...f.options, host: f.host, crypto: f.crypto })
      reopened.closeProfile()
    }
  )
})
