import { createCoreConfigurationNative } from '@/harness/configuration'
import type { NativeConfigurationSnapshot } from '@shared/types/nativeConfiguration'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, statSync, cpSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createServer, type ServerResponse } from 'node:http'
import { connect, type Socket, type AddressInfo } from 'node:net'
import { afterEach, expect, it, vi } from 'vitest'
import { describeIfNativeSqlite } from '../nativeSqliteHarness'
import { HarnessRuntime } from '@/harness/runtime'
import { CoreRuntimeConnection, createCoreProfileNative } from '@/harness/core'
import { initializeCoreProfile } from '@/app/profileStartup'
import { CoreDesktopNative } from '@/harness/desktop'
import { CoreBrowserNative } from '@/harness/browser'
import type { CoreKernelNative } from '../../../src/harness/core/kernel'
import { createRendererRouteContext, type RouteContext } from '@/routes/routeRegistry'
import { CORE_ORDINARY_CALLS, CORE_ROUTE_QUEUED } from '@shared/harness/core'
import { configGetEntriesRoute } from '@shared/contracts/routes'
import { CoreHelperNative } from '@/harness/helpers'
import { FileWatcherHost } from '@/platform/fileWatcher/watcherHost'
import type { FileWatcherHost as FileWatcherPort } from '@/platform/fileWatcher/watcherHostClient'
import type { WatchRequest } from '@/platform/fileWatcher/watcherTypes'
import { CronJobsSchedulerUtilityHost } from '@/scheduler/schedulerUtilityHost'
import type { SchedulerHost } from '@/scheduler/schedulerProcessManager'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')
vi.unmock('child_process')
vi.unmock('node:child_process')
vi.unmock('node:http')
vi.unmock('node:net')

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
      retireDesktop?: () => Promise<void>
      retireBrowser?: () => Promise<void>
      isSettingsWindow?: (windowId: number | null) => Promise<boolean>
      resumeConfiguration?: () => Promise<void>
      assertCallerActive?: (context: RouteContext) => void
      sessionPresentation?: CoreKernelNative['sessionPresentation']
      sessionWindow?: CoreKernelNative['remoteSessionWindow']
      applyProxy?: CoreKernelNative['applyProxy']
      getProxySnapshot?: CoreKernelNative['getProxySnapshot']
      onFailure?: (error: Error) => void
      onRendererDestroyed?: CoreKernelNative['onRendererDestroyed']
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
    const unexpected = async (): Promise<never> => {
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
    const kernelNative: CoreKernelNative = {
      configurationHost: {
        pause: async () => {},
        resume: options.resumeConfiguration ?? (async () => {}),
        stopWrites: async () => {},
        drainWrites: async () => {},
        startWrites: async () => {}
      },
      isSettingsWindow: options.isSettingsWindow ?? (async () => false),
      isMainWindowContext: async () => false,
      rendererPerformance: { record: async () => false },
      splash: { showDebugScenario: unexpected, closeDebugScenario: async () => false },
      images: { saveImage: unexpected, copyImage: unexpected },
      pickToolchainPath: unexpected,
      hasTrustedRenderer: async () => false,
      applyProxy: options.applyProxy ?? (async () => false),
      copilotAuthorization: { browser: unexpected, device: unexpected },
      sessionPresentation: options.sessionPresentation ?? {
        focusBrowser: unexpected,
        setComputerUsePreview: unexpected,
        dismissComputerUsePreview: unexpected
      },
      workspaceDesktop: {
        revealFile: unexpected,
        openFile: unexpected,
        listFileOpenApps: unexpected,
        openFileWithApp: unexpected
      },
      approvalPresentation: {
        getTarget: async () => null,
        present: unexpected,
        close: async () => {}
      },
      ocrCacheKeyProvider: { loadOrCreateKey: unexpected },
      initializeFloatingButton: async () => {},
      assertSyncTokenStorageAvailable: unexpected,
      semanticNotifications: { occur() {}, recover() {} },
      secureCrypto: crypto,
      providerCrypto: crypto,
      getProxySnapshot:
        options.getProxySnapshot ?? (async () => ({ version: 0, proxyUrl: null, noProxy: '' })),
      openExternal: unexpected,
      openPath: unexpected,
      selectDirectory: unexpected,
      cacheImage: unexpected,
      agentDesktop: {
        tempDirectory: directory,
        profileTempDirectory: path.join(userDataDirectory, 'temp'),
        readImageSize: unexpected,
        createSettingsWindow: async () => null,
        sendSettingsNavigation: async () => false
      },
      pluginSettingsWindow: {
        open: unexpected,
        close: async () => {},
        closeAll: async () => {},
        getPluginIdForWebContents: async () => null
      },
      remoteAuthWindows: { open: unexpected, close: async () => {}, closeAll: async () => {} },
      remoteSessionWindow: options.sessionWindow ?? { select: unexpected, present: unexpected },
      showNotification: unexpected,
      mcpPreview: undefined,
      sessionUiPort: { refreshSessionUi: async () => {} },
      mcpReadinessChanged() {},
      reportStartupFailure() {},
      onSessionInactive() {},
      renderer: {
        broadcast: (envelope) => publishEvent(envelope.name, envelope.payload),
        send: (_id, envelope) => publishEvent(envelope.name, envelope.payload)
      },
      onRendererDestroyed: options.onRendererDestroyed ?? (() => () => {}),
      sendToRenderer: (_id, name, payload) => publishEvent(name, payload),
      destroySessionBrowser: async () => {},
      observeDelegation() {},
      runJournalObserver: undefined,
      notifySessionCompletion: unexpected,
      fetchRegistryIcon: unexpected,
      mcpAppDesktop: { observeOwner: unexpected, openExternal: unexpected },
      publishMcpConsent() {}
    }
    let connection: CoreRuntimeConnection
    // shortcut: Native owners run in-process here; verify utility-process bindings at G5 cutover.
    const nativeHelpers = new CoreHelperNative(
      {
        exec: unexpected,
        code: unexpected,
        watcher: async () => {
          const events = new EventEmitter()
          const owner = new FileWatcherHost({
            postMessage: (message) => events.emit('message', message)
          })
          return {
            postMessage: (message) => {
              const operation =
                message.method === 'watch'
                  ? owner.watch(message.args[0] as WatchRequest)
                  : message.method === 'unwatch'
                    ? owner.unwatch(message.args[0] as string)
                    : owner.shutdown()
              void operation.then(
                (data) =>
                  events.emit('message', {
                    type: 'file-watcher:response',
                    id: message.id,
                    ok: true,
                    data
                  }),
                (error: Error) =>
                  events.emit('message', {
                    type: 'file-watcher:response',
                    id: message.id,
                    ok: false,
                    error: { message: error.message }
                  })
              )
            },
            onMessage: (listener) => {
              events.on('message', listener)
            },
            onExit: (listener) => {
              events.on('exit', listener)
            },
            onError: (listener) => {
              events.on('error', listener)
            },
            terminate: async () => {
              await owner.shutdown()
              events.emit('exit', 0)
            }
          } satisfies FileWatcherPort
        },
        scheduler: async () => {
          const events = new EventEmitter()
          const owner = new CronJobsSchedulerUtilityHost({
            postMessage: (message) => events.emit('message', message)
          })
          return {
            pid: process.pid,
            postMessage: (message) => {
              if (message.type === 'START') owner.start()
              else if (message.type === 'RECONCILE') owner.reconcile()
              else if (message.type === 'SCAN_RESULT') owner.applyScanResult(message)
              else owner.shutdown()
            },
            kill: () => {
              owner.shutdown()
              events.emit('exit', 0)
            },
            onMessage: (listener) => {
              events.on('message', listener)
            },
            onExit: (listener) => {
              events.on('exit', listener)
            },
            onError: (listener) => {
              events.on('error', listener)
            }
          } satisfies SchedulerHost
        }
      },
      async (events) => await connection.deliverNativeEvents(events),
      (error) => connection.invalidateNative(error)
    )
    const nativeDesktop = new CoreDesktopNative(
      kernelNative,
      async (event) => await connection.deliverDesktopEvent(event),
      options.retireDesktop ?? (async () => {}),
      (error) => {
        throw error
      }
    )
    const nativeBrowser = new CoreBrowserNative(
      {
        getToolDefinitions: () => [],
        callTool: async () => {
          throw new Error('Unexpected Agent Browser call')
        }
      },
      async (event) => await connection.deliverBrowserEvent(event),
      options.retireBrowser ?? (async () => {}),
      (error) => connection.invalidateNative(error)
    )
    connection = await CoreRuntimeConnection.connect({
      onFailure: options.onFailure,
      runtime: options.transport?.(runtime) ?? runtime,
      temporaryDirectory: directory,
      native: (method, args) =>
        method === 'desktop'
          ? nativeDesktop.invoke(args)
          : method === 'helpers'
            ? nativeHelpers.invoke(args)
            : method === 'browser'
              ? nativeBrowser.invoke(args)
              : method === 'configuration'
                ? configurationNative(method, args)
                : profileNative(method, args)
    })
    cleanups.push(async () => {
      await connection.closeAfterHostExit()
      await nativeHelpers.close().catch(() => {})
      await nativeBrowser.close().catch(() => {})
    })
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
      publishEvent,
      invokeRoute: async (routeName: string, input: unknown, context: RouteContext) =>
        await connection.invokeRoute(routeName, input, context, () =>
          options.assertCallerActive?.(context)
        ),
      assembleKernel: async () =>
        await connection.assembleKernel({
          temporaryDirectory: directory,
          appDataDirectory: directory,
          documentsDirectory: null,
          projectHomeDirectory: null,
          resourcesPath: path.resolve('resources'),
          workingDirectory: directory,
          builtinSkillsDirectories: [],
          providerCatalogPath: path.resolve('resources/model-db/providers.json'),
          allowInsecureTls: false
        })
    }
  }

  it(
    'runs SDK routes with bounded queues, reserved control and acknowledged retirement',
    { timeout: 30_000 },
    async () => {
      const entered = Promise.withResolvers<void>()
      const retired = Promise.withResolvers<void>()
      const queriesEntered = Promise.withResolvers<void>()
      const queriesReleased = Promise.withResolvers<void>()
      let holdQueries = false
      let settingsQueries = 0
      let queuedCallerActive = true
      const focusBrowser = vi.fn(async () => true)
      const setComputerUsePreview = vi.fn<
        CoreKernelNative['sessionPresentation']['setComputerUsePreview']
      >(async (_id, mode) => ({
        updated: true,
        surface: mode === 'stopped' ? 'none' : 'renderer-canvas'
      }))
      const dismissComputerUsePreview = vi.fn(async () => true)
      const selectSessionWindow = vi.fn(async () => ({ windowId: 99, webContentsId: 77 }))
      const presentSessionWindow = vi.fn(async () => true)
      const f = await fixture({
        detached: true,
        sessionWindow: { select: selectSessionWindow, present: presentSessionWindow },
        sessionPresentation: { focusBrowser, setComputerUsePreview, dismissComputerUsePreview },
        assertCallerActive: (context) => {
          if (
            context.caller.kind === 'renderer' &&
            context.caller.webContentsId === 43 &&
            !queuedCallerActive
          )
            throw new Error('Renderer document retired')
        },
        isSettingsWindow: async () => {
          if (holdQueries) {
            if (++settingsQueries === CORE_ORDINARY_CALLS) queriesEntered.resolve()
            await queriesReleased.promise
          }
          return false
        },
        retireDesktop: async () => {
          entered.resolve()
          await retired.promise
        }
      })
      try {
        await f.connection.openProfile(f.options)
        await f.connection.configure({ operation: 'initialize' })
        const status = await f.assembleKernel()
        expect(status).toMatchObject({ phase: 'kernel-assembled', businessReady: false })
        expect(status.pid).not.toBe(process.pid)
        await expect(
          f.invokeRoute('settings.getSnapshot', {}, createRendererRouteContext(42, 99))
        ).rejects.toThrow('Core business routes are unavailable')
        await expect(f.connection.mcpAppSandbox.getProtocolPolicy('missing')).rejects.toThrow(
          'Core MCP App protocol is unavailable'
        )
        await expect(f.connection.host.hasProvider('missing')).rejects.toThrow(
          'Core host queries are unavailable'
        )
        await expect(f.connection.host.getShutdownConfirmation()).rejects.toThrow(
          'Core host control is unavailable'
        )
        await expect(f.connection.startKernel()).resolves.toMatchObject({
          phase: 'running',
          businessReady: true
        })
        f.publishEvent.mockClear()
        await f.connection.host.observeSettingsWindow('opened')
        await vi.waitFor(() =>
          expect(f.publishEvent).toHaveBeenCalledWith(
            'startup.workload.changed',
            expect.objectContaining({ target: 'settings' })
          )
        )
        await f.connection.host.observeSettingsWindow('ready')
        await f.connection.host.systemResume()
        await f.connection.host.observeSettingsWindow('closed')
        await expect(f.connection.mcpAppSandbox.getProtocolPolicy('missing')).resolves.toBeNull()
        await expect(f.connection.host.hasProvider('missing')).resolves.toBe(false)
        await expect(
          f.connection.host.resolveWorkspacePreviewRequest('workspace-preview://missing/index.html')
        ).resolves.toBeNull()
        await expect(
          f.connection.mcpAppSandbox.requestBrowserPermission(
            'missing',
            { webContentsId: 42, windowId: 99 },
            ['camera']
          )
        ).resolves.toBe(false)
        f.publishEvent.mockClear()
        await f.invokeRoute(
          'settings.update',
          {
            changes: [{ key: 'notificationsEnabled', value: false }]
          },
          createRendererRouteContext(42, 99)
        )
        await vi.waitFor(() =>
          expect(f.publishEvent).toHaveBeenCalledWith(
            'settings.changed',
            expect.objectContaining({ values: { notificationsEnabled: false } })
          )
        )
        const caller = createRendererRouteContext(42, 99)
        await expect(
          f.invokeRoute('config.setLanguage', { language: 'zh-CN' }, caller)
        ).resolves.toMatchObject({ requestedLanguage: 'zh-CN', locale: 'zh-CN' })
        await expect(f.invokeRoute('config.getLanguage', {}, caller)).resolves.toMatchObject({
          locale: 'zh-CN'
        })
        await f.invokeRoute('config.setTheme', { theme: 'dark' }, caller)
        await expect(f.invokeRoute('config.getTheme', {}, caller)).resolves.toMatchObject({
          theme: 'dark'
        })
        await expect(
          f.invokeRoute('config.setUpdateChannel', { channel: 'beta' }, caller)
        ).resolves.toEqual({ channel: 'beta' })
        await expect(f.invokeRoute('config.getUpdateChannel', {}, caller)).resolves.toEqual({
          channel: 'beta'
        })
        const { sessionId } = (await f.invokeRoute(
          'sessions.createDraft',
          { agentId: 'deepchat', projectDir: null },
          caller
        )) as { sessionId: string }
        await expect(f.invokeRoute('browser.focusContent', { sessionId }, caller)).resolves.toEqual(
          { focused: true }
        )
        expect(focusBrowser).toHaveBeenCalledWith(sessionId, caller.caller)
        await expect(
          f.invokeRoute('browser.focusContent', { sessionId }, createRendererRouteContext(43, 99))
        ).resolves.toEqual({ focused: false })
        expect(focusBrowser).toHaveBeenCalledOnce()
        await f.invokeRoute('sessions.activate', { sessionId }, caller)
        await expect(
          f.invokeRoute('computerUse.setPreviewMode', { sessionId, mode: 'eligible' }, caller)
        ).resolves.toEqual({ updated: true, surface: 'renderer-canvas' })
        await expect(
          f.invokeRoute('computerUse.dismissPreview', { sessionId, runId: 'run-1' }, caller)
        ).resolves.toEqual({ dismissed: true })
        expect(dismissComputerUsePreview).toHaveBeenCalledWith(sessionId, 'run-1', caller.caller)
        await f.invokeRoute('sessions.deactivate', {}, caller)
        await expect(
          f.invokeRoute('computerUse.setPreviewMode', { sessionId, mode: 'eligible' }, caller)
        ).resolves.toEqual({ updated: false, surface: 'none' })
        await expect(
          f.invokeRoute('computerUse.setPreviewMode', { sessionId, mode: 'stopped' }, caller)
        ).resolves.toEqual({ updated: true, surface: 'none' })
        expect(setComputerUsePreview).toHaveBeenCalledTimes(2)
        const created = (await f.invokeRoute(
          'sessions.create',
          {
            agentId: 'deepchat',
            providerId: 'openai',
            modelId: 'gpt-4o-mini',
            message: ''
          },
          caller
        )) as { session: { id: string } }
        const widget = (await f.invokeRoute('sessions.getWidgetSnapshot', {}, caller)) as {
          snapshot: { sessions: { id: string }[] }
        }
        expect(widget.snapshot.sessions.map((session) => session.id)).toEqual([created.session.id])
        await expect(
          f.invokeRoute('sessions.openDesktop', { sessionId: 'missing' }, caller)
        ).resolves.toEqual({ opened: false })
        expect(selectSessionWindow).not.toHaveBeenCalled()
        await expect(
          f.invokeRoute('sessions.openDesktop', { sessionId: created.session.id }, caller)
        ).resolves.toEqual({ opened: true })
        expect(presentSessionWindow).toHaveBeenCalledWith({ windowId: 99, webContentsId: 77 })
        await expect(
          f.invokeRoute('sessions.getActive', {}, createRendererRouteContext(77, 99))
        ).resolves.toMatchObject({ session: { id: created.session.id } })
        await expect(
          f.invokeRoute(
            'settings.getSnapshot',
            {},
            {
              caller: { kind: 'internal', component: 'migration' }
            }
          )
        ).rejects.toThrow()
        await expect(f.invokeRoute('window.getCurrentState', {}, caller)).rejects.toThrow(
          'Unhandled deepchat route'
        )
        holdQueries = true
        const ordinary = Array.from({ length: CORE_ORDINARY_CALLS }, () =>
          f.invokeRoute('providers.listSummaries', {}, caller)
        )
        const ordinaryOutcomes = Promise.allSettled(ordinary)
        await queriesEntered.promise
        await expect(f.connection.host.getShutdownConfirmation()).resolves.toBeNull()
        await expect(f.connection.host.clearPermissionCaches()).resolves.toBeUndefined()
        const prompt = 'x'.repeat(3 * 1024 * 1024)
        const input = { changes: [{ key: 'default_system_prompt', value: prompt }] }
        const queued = [
          f.invokeRoute('config.updateEntries', input, caller),
          f.invokeRoute(
            'config.updateEntries',
            { changes: [{ key: 'default_system_prompt', value: 'retired caller' }] },
            createRendererRouteContext(43, 100)
          ),
          f.connection.mcpAppSandbox.getProtocolPolicy('missing'),
          ...Array.from({ length: CORE_ROUTE_QUEUED - 3 }, () =>
            f.invokeRoute('config.getEntries', { keys: ['init_complete'] }, caller)
          )
        ]
        const queuedOutcomes = Promise.allSettled(queued)
        input.changes[0].value = 'mutated after admission'
        queuedCallerActive = false
        await expect(f.invokeRoute('config.getEntries', {}, caller)).rejects.toThrow(
          'Core route queue exceeded'
        )
        await expect(
          f.invokeRoute(
            'approvals.resolve',
            { requestId: 'unknown_approval_id', decision: 'denied' },
            caller
          )
        ).resolves.toEqual({ accepted: false })
        expect(settingsQueries).toBe(CORE_ORDINARY_CALLS)
        await expect(f.connection.status()).resolves.toMatchObject({ businessReady: true })
        queriesReleased.resolve()
        expect((await ordinaryOutcomes).every((result) => result.status === 'fulfilled')).toBe(true)
        const outcomes = await queuedOutcomes
        expect(outcomes[2]).toEqual({ status: 'fulfilled', value: null })
        expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(2)
        expect(outcomes[1]).toMatchObject({
          status: 'rejected',
          reason: { message: 'Renderer document retired' }
        })
        expect(outcomes.at(-1)).toMatchObject({
          status: 'rejected',
          reason: { message: 'Core route queue yielded to a control request' }
        })
        const output = configGetEntriesRoute.output.parse(
          await f.invokeRoute('config.getEntries', { keys: ['default_system_prompt'] }, caller)
        )
        expect(output.values.default_system_prompt === prompt).toBe(true)
        const stopping = f.connection.stop()
        const observed = stopping.then(
          () => 'stopped',
          () => 'failed'
        )
        await entered.promise
        await expect(
          initializeCoreProfile({ ...f.options, host: f.host, crypto: f.crypto })
        ).rejects.toMatchObject({ name: 'CoreProfileOwnershipUnavailableError' })
        retired.resolve()
        expect(await observed).toBe('stopped')
        const reopened = await initializeCoreProfile({
          ...f.options,
          host: f.host,
          crypto: f.crypto
        })
        expect(reopened.settingsStore.get('notificationsEnabled')).toBe(false)
        reopened.closeProfile()
      } finally {
        queriesReleased.resolve()
        retired.resolve()
      }
    }
  )

  it(
    'fences pending Kernel activation until its accepted Native effect settles',
    { timeout: 30_000 },
    async () => {
      const entered = Promise.withResolvers<void>()
      const released = Promise.withResolvers<void>()
      const f = await fixture({
        resumeConfiguration: async () => {
          entered.resolve()
          await released.promise
        }
      })
      try {
        await f.connection.openProfile(f.options)
        await f.connection.configure({ operation: 'initialize' })
        await f.assembleKernel()
        const activation = Promise.allSettled([f.connection.startKernel()])
        await entered.promise
        await expect(f.connection.status()).resolves.toMatchObject({
          phase: 'starting',
          businessReady: false
        })
        const queued = Promise.allSettled([
          f.invokeRoute('providers.list', {}, createRendererRouteContext(42, 99))
        ])
        await f.connection.beginShutdown()
        expect((await queued)[0]).toMatchObject({
          status: 'rejected',
          reason: { message: 'Core is stopping' }
        })
        const stopping = f.connection.stop()
        await expect.poll(async () => (await f.connection.status()).phase).toBe('stopping')
        await expect(
          initializeCoreProfile({ ...f.options, host: f.host, crypto: f.crypto })
        ).rejects.toMatchObject({ name: 'CoreProfileOwnershipUnavailableError' })
        released.resolve()
        expect((await activation)[0].status).toBe('rejected')
        await expect(stopping).resolves.toMatchObject({ phase: 'stopped', businessReady: false })
        expect(existsSync(path.join(f.options.userDataDirectory, 'local-control.json'))).toBe(false)
        const reopened = await initializeCoreProfile({
          ...f.options,
          host: f.host,
          crypto: f.crypto
        })
        reopened.closeProfile()
      } finally {
        released.resolve()
      }
    }
  )

  it(
    'applies proxy changes to SDK HTTP and retires current and draining connections',
    { timeout: 30_000 },
    async () => {
      const sockets = new Set<Socket>()
      const servers: ReturnType<typeof createServer>[] = []
      cleanups.push(async () => {
        for (const socket of sockets) socket.destroy()
        await Promise.all(
          servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
        )
      })
      let hold: ((response: ServerResponse) => void) | undefined
      const respond = (response: ServerResponse) => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ data: [{ id: 'core-http-model', object: 'model' }] }))
      }
      const target = createServer((_request, response) =>
        hold ? hold(response) : respond(response)
      )
      const listen = async (server: ReturnType<typeof createServer>) => {
        servers.push(server)
        server.on('connection', (socket) => {
          sockets.add(socket)
          socket.once('close', () => sockets.delete(socket))
        })
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
        return (server.address() as AddressInfo).port
      }
      const targetPort = await listen(target)
      const authorizations: Array<{ proxy: number; value: string | undefined }> = []
      const proxyUrl = async (proxy: number) => {
        const server = createServer((request, response) => {
          authorizations.push({ proxy, value: request.headers['proxy-authorization'] })
          if (hold) hold(response)
          else respond(response)
        })
        server.on('connect', (request, client, head) => {
          authorizations.push({ proxy, value: request.headers['proxy-authorization'] })
          const upstream = connect(targetPort, '127.0.0.1', () => {
            client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
            upstream.write(head)
            upstream.pipe(client)
            client.pipe(upstream)
          })
          client.on('error', () => upstream.destroy())
          upstream.on('error', () => client.destroy())
          client.once('close', () => upstream.destroy())
        })
        return `http://user%40example:pass%3Aword@127.0.0.1:${await listen(server)}`
      }
      const primary = await proxyUrl(1)
      const secondary = await proxyUrl(2)
      let snapshot = { version: 0, proxyUrl: null as string | null, noProxy: '' }
      const f = await fixture({
        getProxySnapshot: async () => snapshot,
        applyProxy: async (mode, url, resolve) => {
          if (resolve)
            snapshot = {
              version: snapshot.version + 1,
              proxyUrl: mode === 'custom' ? url : null,
              noProxy: 'localhost,127.0.0.1'
            }
          return mode === 'system'
        }
      })
      await f.connection.openProfile(f.options)
      await f.connection.configure({ operation: 'initialize' })
      await f.assembleKernel()
      await f.connection.startKernel()
      const route = (name: string, input: unknown) =>
        f.invokeRoute(name, input, createRendererRouteContext(42, 99))
      const refresh = (providerId: string) => route('providers.refreshModels', { providerId })
      for (const [id, host] of [
        ['proxied', 'provider.invalid'],
        ['bypassed', '127.0.0.1']
      ]) {
        await route('providers.add', {
          provider: {
            id,
            name: id,
            apiType: 'openai',
            apiKey: 'fixture-key',
            baseUrl: `http://${host}:${targetPort}/v1`,
            enable: false,
            custom: true
          }
        })
      }
      await route('config.setCustomProxyUrl', { url: primary })
      await route('config.setProxyMode', { mode: 'custom' })
      await expect(refresh('proxied')).resolves.toEqual({ refreshed: true })
      expect(authorizations).toContainEqual({
        proxy: 1,
        value: `Basic ${Buffer.from('user@example:pass:word').toString('base64')}`
      })
      const proxyRequests = authorizations.length
      await expect(refresh('bypassed')).resolves.toEqual({ refreshed: true })
      expect(authorizations).toHaveLength(proxyRequests)

      const entered = Promise.withResolvers<void>()
      const responses: ServerResponse[] = []
      hold = (response) => {
        responses.push(response)
        entered.resolve()
      }
      const pending = refresh('proxied')
      await entered.promise
      await route('config.setCustomProxyUrl', { url: secondary })
      hold = undefined
      responses.forEach(respond)
      await expect(pending).resolves.toEqual({ refreshed: true })
      await expect(refresh('proxied')).resolves.toEqual({ refreshed: true })
      expect(authorizations.some((entry) => entry.proxy === 2)).toBe(true)
      await route('config.setProxyMode', { mode: 'none' })
      const beforeDirect = authorizations.length
      await expect(refresh('bypassed')).resolves.toEqual({ refreshed: true })
      expect(authorizations).toHaveLength(beforeDirect)

      await route('config.setProxyMode', { mode: 'custom' })
      responses.length = 0
      hold = (response) => {
        responses.push(response)
      }
      const retiredRequest = refresh('proxied').catch((error: unknown) => error)
      await vi.waitFor(() => expect(responses).toHaveLength(1))
      await route('config.setCustomProxyUrl', { url: primary })
      const currentRequest = refresh('bypassed').catch((error: unknown) => error)
      await vi.waitFor(() => expect(responses).toHaveLength(2))
      const closed = responses.map(
        (response) => new Promise<void>((resolve) => response.once('close', resolve))
      )
      await expect(f.connection.stop()).resolves.toMatchObject({ phase: 'stopped' })
      await Promise.all(closed)
      expect(await retiredRequest).toBeInstanceOf(Error)
      expect(await currentRequest).toBeInstanceOf(Error)
      const reopened = await initializeCoreProfile({ ...f.options, host: f.host, crypto: f.crypto })
      reopened.closeProfile()
    }
  )

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
      const bounds = { x: 20, y: 40, dockSide: 'left' as const }
      await f.connection.configure({ operation: 'floatingBounds', bounds })
      expect(f.nativeSnapshots.at(-1)?.floatingButtonBounds).toEqual(bounds)
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
      expect(reopened.settingsStore.get('floatingButtonBounds')).toEqual(bounds)
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
    'keeps the profile until the Browser owner retires without Agent Browser calls',
    { timeout: 30_000 },
    async () => {
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const f = await fixture({
        retireBrowser: async () => {
          entered.resolve()
          await release.promise
        }
      })
      try {
        await f.connection.openProfile(f.options)
        await f.connection.configure({ operation: 'initialize' })
        await f.assembleKernel()
        const stopping = f.connection.stop()
        await entered.promise
        await expect(
          initializeCoreProfile({ ...f.options, host: f.host, crypto: f.crypto })
        ).rejects.toMatchObject({ name: 'CoreProfileOwnershipUnavailableError' })
        release.resolve()
        await expect(stopping).resolves.toMatchObject({ phase: 'stopped' })
        const reopened = await initializeCoreProfile({
          ...f.options,
          host: f.host,
          crypto: f.crypto
        })
        reopened.closeProfile()
      } finally {
        release.resolve()
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
        const ordinary = Array.from({ length: CORE_ORDINARY_CALLS }, () =>
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
          Array.from({ length: CORE_ORDINARY_CALLS }, () =>
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
    'fences an unknown helper event through its reserved lane while ordinary work is saturated',
    { timeout: 30_000 },
    async () => {
      const entered = Promise.withResolvers<void>()
      const receipt = Promise.withResolvers<void>()
      const f = await fixture({
        refreshTheme: async () => {
          entered.resolve()
          await receipt.promise
        }
      })
      await f.connection.openProfile(f.options)
      const observation = Promise.allSettled([f.connection.observeSystemTheme()])
      await entered.promise
      const pending = Promise.allSettled(
        Array.from({ length: CORE_ORDINARY_CALLS }, () =>
          f.connection.configure({ operation: 'read', input: { keys: ['fontFamily'] } })
        )
      )
      try {
        await expect(
          f.connection.deliverNativeEvents([
            {
              id: randomUUID(),
              sequence: 1,
              pid: null,
              event: { type: 'message', message: Buffer.alloc(32 * 1024) }
            }
          ])
        ).rejects.toThrow(/Unknown or out-of-order Native helper event|Core helpers owner failed/)
        await expect(f.connection.status()).rejects.toThrow()
        await expect(
          initializeCoreProfile({ ...f.options, host: f.host, crypto: f.crypto })
        ).rejects.toMatchObject({ name: 'CoreProfileOwnershipUnavailableError' })
      } finally {
        receipt.resolve()
        await observation
        await pending
        await expect(f.connection.stop()).resolves.toMatchObject({ phase: 'stopped' })
        await f.connection.closeAfterHostExit()
      }
      const reopened = await initializeCoreProfile({ ...f.options, host: f.host, crypto: f.crypto })
      reopened.closeProfile()
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
    'reports an internal Core failure before physical Native retirement releases the writer',
    { timeout: 30_000 },
    async () => {
      const failure = Promise.withResolvers<Error>()
      const closing = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const onFailure = vi.fn((error: Error) => failure.resolve(error))
      const f = await fixture({
        onFailure,
        onRendererDestroyed: () => {
          throw new Error('Native renderer registration was refused')
        },
        retireDesktop: async () => {
          closing.resolve()
          await release.promise
        }
      })
      await f.connection.openProfile(f.options)
      await f.connection.configure({ operation: 'initialize' })
      await f.assembleKernel()
      await f.connection.startKernel()
      const mutation = Promise.allSettled([
        f.invokeRoute(
          'sessions.create',
          {
            agentId: 'deepchat',
            providerId: 'openai',
            modelId: 'gpt-4o-mini',
            message: ''
          },
          createRendererRouteContext(42, 99)
        )
      ])
      try {
        await expect(failure.promise).resolves.toMatchObject({
          name: 'CoreOwnerFailureError',
          message: 'Core desktop owner failed'
        })
        await closing.promise
        expect(onFailure).toHaveBeenCalledOnce()
        await expect(f.connection.beginShutdown()).resolves.toBeUndefined()
        await expect(
          initializeCoreProfile({ ...f.options, host: f.host, crypto: f.crypto })
        ).rejects.toMatchObject({ name: 'CoreProfileOwnershipUnavailableError' })
      } finally {
        release.resolve()
        await mutation
        await f.connection.stop().catch(() => {})
        await f.connection.closeAfterHostExit()
      }
      const reopened = await initializeCoreProfile({ ...f.options, host: f.host, crypto: f.crypto })
      reopened.closeProfile()
    }
  )

  it(
    'releases a crashed Core owner without silently adopting a replacement',
    { timeout: 30_000 },
    async () => {
      let send!: ReturnType<HarnessRuntime['connectCore']>
      const onFailure = vi.fn()
      const f = await fixture({
        onFailure,
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
      expect(onFailure).toHaveBeenCalledOnce()
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
