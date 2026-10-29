import path from 'node:path'
import logger from '@shared/logger'
import {
  settingsChangedEvent,
  sessionsTapeInspectorHeadChangedEvent,
  type DeepchatEventName
} from '@shared/contracts/events'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { initializeCoreProfile } from '@/app/profileStartup'
import { DatabaseRequestGate } from '@/app/databaseRequestGate'
import { StartupWorkloadCoordinator } from '@/app/startupWorkloadCoordinator'
import { AgentCliTokenAuthority, ArtifactSpool } from '@/cli'
import { TypedEventHub, type TypedEventHubOptions } from '@/events/typedEventHub'
import { SessionEventRouter } from '@/events/sessionEventRouter'
import { McpAppSandboxRegistry } from '@/mcp/apps/sandboxRegistry'
import { providerDbLoader, type ProviderDbBootstrap } from '@/provider/providerDbLoader'
import { createCoreData } from './data'
import { createCoreProviders } from './providers'
import { createCoreRuntime } from './runtime'
import type { createCoreSettings } from './settings'
import { createCoreMaintenance, type CoreMaintenanceNative } from './maintenance'
import { createCoreController, type CoreControllerNative } from './controller'

type RuntimeOptions = Parameters<typeof createCoreRuntime>[0]
type ProviderOptions = Parameters<typeof createCoreProviders>[0]
type Runtime = Awaited<ReturnType<typeof createCoreRuntime>>

export type CoreKernelNative = Pick<
  RuntimeOptions,
  | 'workspaceDesktop'
  | 'approvalPresentation'
  | 'ocrCacheKeyProvider'
  | 'initializeFloatingButton'
  | 'assertSyncTokenStorageAvailable'
  | 'semanticNotifications'
  | 'dialog'
  | 'secureCrypto'
  | 'getProxyUrl'
  | 'whenProxyReady'
  | 'openExternal'
  | 'openPath'
  | 'selectDirectory'
  | 'cacheImage'
  | 'agentDesktop'
  | 'pluginSettingsWindow'
  | 'remoteAuthWindows'
  | 'openRemoteSession'
  | 'showNotification'
  | 'mcpPreview'
  | 'sessionUiPort'
  | 'mcpReadinessChanged'
  | 'reportStartupFailure'
  | 'onSessionInactive'
> &
  CoreMaintenanceNative &
  CoreControllerNative & {
    renderer: TypedEventHubOptions['renderer']
    onRendererDestroyed: ProviderOptions['onRendererDestroyed']
    sendToRenderer: ProviderOptions['sendToRenderer']
    destroySessionBrowser: RuntimeOptions['execution']['destroySessionBrowser']
    observeDelegation: RuntimeOptions['execution']['observeDelegation']
    runJournalObserver: RuntimeOptions['runJournalObserver']
    notifySessionCompletion(session: { id: string; title: string }): Promise<void>
    providerCrypto: ProviderOptions['crypto']
    fetchRegistryIcon: ProviderOptions['fetchRegistryIcon']
    mcpAppDesktop: RuntimeOptions['mcpApps']['desktop']
    publishMcpConsent: Parameters<McpAppSandboxRegistry['setConsentPublisher']>[0]
  }

export async function createCoreKernel(options: {
  profile: Awaited<ReturnType<typeof initializeCoreProfile>>
  settings: ReturnType<typeof createCoreSettings>
  bootstrap: RuntimeOptions['bootstrap']
  providerCatalogBootstrap: ProviderDbBootstrap
  nextSettingsVersion(): number
  native: CoreKernelNative
  browser: RuntimeOptions['browser']
  helpers: Pick<
    RuntimeOptions,
    'spawnBackgroundExecHost' | 'spawnCodeModeHost' | 'spawnFileWatcherHost' | 'spawnSchedulerHost'
  >
  admission: RuntimeOptions['agentInvocationAdmission']
  vectors: RuntimeOptions['memoryVectorStores']
  bindEventPublisher(publish: (name: DeepchatEventName, payload: unknown) => void): void
  isStopping(): boolean
  allowInsecureTls: boolean
}) {
  if (options.isStopping()) throw new Error('Core Kernel startup is stopping')
  const { native, bootstrap, profile, settings } = options
  let stopping: Promise<void> | undefined
  let starting: Promise<void> | undefined
  let stoppingRequested = false
  let runtime: Runtime | undefined
  let data: ReturnType<typeof createCoreData> | undefined
  let providers: ReturnType<typeof createCoreProviders> | undefined
  let maintenance: ReturnType<typeof createCoreMaintenance> | undefined
  let controller: ReturnType<typeof createCoreController> | undefined
  let constructionIncomplete = false
  const isStopping = () => stoppingRequested || options.isStopping()
  const databaseRequests = new DatabaseRequestGate(() => {
    if (isStopping()) throw new Error('Core Kernel is stopping')
  })
  const syncActiveSessions = new Set<string>()
  const typedEventHub = new TypedEventHub({ renderer: native.renderer, log: logger })
  const events = new SessionEventRouter({
    hub: typedEventHub,
    resolveSessionRunId: (id) => (data ? data.resolveSessionRunId(id) : null),
    getBoundRendererIds: (id) =>
      runtime?.execution.desktopSessionBinding.getWebContentsIdsForSession(id) ?? []
  })
  const publishEvent = (name: DeepchatEventName, input: unknown) => {
    const payload =
      name === 'settings.changed'
        ? { ...settingsChangedEvent.payload.parse(input), version: options.nextSettingsVersion() }
        : input
    events.publish(name, payload)
    if (name === 'sessions.status.changed') {
      const state = payload as { sessionId: string; status: string }
      if (state.status === 'generating' || state.status === 'running')
        syncActiveSessions.add(state.sessionId)
      else {
        syncActiveSessions.delete(state.sessionId)
        runtime?.syncReplica.wake()
      }
    }
  }
  options.bindEventPublisher(publishEvent)
  const startupWorkloadCoordinator = new StartupWorkloadCoordinator()
  const startupRunId = startupWorkloadCoordinator.createRun('main')
  const unsubscribeStartup = startupWorkloadCoordinator.subscribe((payload) =>
    publishEvent('startup.workload.changed', payload)
  )
  const agentCliTokenAuthority = new AgentCliTokenAuthority()
  const artifactSpool = new ArtifactSpool({
    directory: path.join(bootstrap.profileDirectory, 'local-control', 'artifacts'),
    consumeAgentBytes: (token, bytes) => agentCliTokenAuthority.consumeBytes(token, bytes),
    log: logger
  })
  const mcpApps = new McpAppSandboxRegistry()
  mcpApps.setConsentPublisher(native.publishMcpConsent)
  const stop = (): Promise<void> => {
    if (stopping) return stopping
    stoppingRequested = true
    databaseRequests.beginShutdown()
    providerDbLoader.stop()
    stopping = (async () => {
      const errors: unknown[] = []
      const step = async (name: string, action: () => void | Promise<void>) => {
        try {
          await action()
        } catch (error) {
          errors.push(error)
          logger.warn('[Core] Kernel retirement failed', { name, error })
        }
      }
      await step('settings', () => settings.appSettingsService.stop())
      agentCliTokenAuthority.clear()
      await step('startup', () => startupWorkloadCoordinator.cancelAndDrainTarget('main'))
      await step('agent-settings-stop', () => providers?.agentSettings.stop())
      await step('provider-catalog', () => providerDbLoader.drain())
      await step('agent-settings', async () => await providers?.agentSettings.drain())
      await step('accounts', async () => {
        if (controller) await controller.oauthService.stop()
        else await providers?.accounts.stop()
      })
      await step('acp-auth', async () => await providers?.acpAuthService.shutdown())
      if (runtime) {
        const owner = runtime
        await step('cli', () => owner.cliServer.stop())
        await step('automatic-sync', () => owner.automaticSync.close())
        await step('sync-peer', () => owner.syncPeerService.stop())
        await step('sync-host', () => owner.syncHostService.stop())
        await step('replica-endpoint', () => owner.replicaEndpoint.close())
        await step('sync-replica', () => owner.syncReplica.close())
        await step('delegation', () => owner.execution.liveDelegationService.stop())
        await step('scheduler', () => owner.cronJobs.destroy())
        await step('remote', () => owner.remoteService.destroy())
        await step('hooks', () => owner.hookService.stop())
        await step('context-hooks', async () => await owner.pluginService.contextHooks?.stop())
        await step('sessions', async () => {
          const sessions = data!.appSessionService.list({ includeSubagents: true })
          const results = await Promise.allSettled(
            sessions.flatMap((session) => {
              const id = toAppSessionId(session.id)
              return [
                owner.execution.deepChatAgentHarness.cleanupSession(id),
                owner.execution.acpAgentRuntime.cleanupSession(id)
              ]
            })
          )
          const failures = results.flatMap((result) =>
            result.status === 'rejected' ? [result.reason] : []
          )
          if (failures.length) throw new AggregateError(failures, 'Core sessions did not retire')
        })
        await step('background-exec', () => owner.backgroundExec.shutdown())
        await step('code-mode', () => owner.toolService.shutdownCodeRuntime())
        await step('runtime-initialization', () => owner.drainInitialization(step))
        await step('activation', async () => await starting?.catch(() => undefined))
        await step('plugins', () => owner.pluginService.shutdown())
        mcpApps.clear()
        await step('mcp', () => owner.mcpService.shutdown())
        await step('workspace', () => owner.workspaceService.destroy())
        await step('skill-sync', () => owner.skillSyncService.destroy())
        await step('skills', () => owner.skillService.destroy())
        await step('watchers', () => owner.fileWatcherService.destroy())
        const ingestion = (() => {
          try {
            return owner.execution.memoryIngestionObserver.drainAndFence().then(
              (outcome) => ({ outcome }) as const,
              (error: unknown) => ({ error }) as const
            )
          } catch (error) {
            return Promise.resolve({ error })
          }
        })()
        await step('memory', () => owner.memoryService.dispose())
        await step('memory-ingestion', async () => {
          const result = await ingestion
          if ('error' in result) throw result.error
          if (result.outcome.timedOut)
            logger.warn('[Core] Late Memory ingestion remains fenced', result.outcome)
        })
        await step('knowledge', () => owner.knowledgeService.destroy())
        await step('ocr', () => owner.ocrRuntimeService.close())
        owner.cliMutationGuard.clear()
        await step('cli-audit', () => owner.cliAuditLog.close())
      }
      await step('tape-watchers', async () => await data?.tapeInspectorHeadWatcher.close())
      typedEventHub.close()
      unsubscribeStartup()
      await step('artifacts', () => artifactSpool.close())
      providers?.unsubscribeProviderDbCatalog()
      await step('providers', async () => await providers?.providerRuntime.shutdown())
      await step('acp', async () => await providers?.acpRuntimeOwner.shutdown())
      await step('requests', () => databaseRequests.drainForShutdown())
      if (constructionIncomplete)
        errors.push(new Error('Partial Core construction requires physical retirement'))
      if (errors.length) throw new AggregateError(errors, 'Core Kernel did not retire')
    })()
    return stopping
  }
  try {
    constructionIncomplete = true
    data = createCoreData({
      profile,
      profileDirectory: bootstrap.profileDirectory,
      providerCatalogBootstrap: options.providerCatalogBootstrap,
      publishEvent,
      emitTapeHead: (webContentsId, pulse) =>
        typedEventHub.publish(sessionsTapeInspectorHeadChangedEvent.name, pulse, {
          kind: 'renderer',
          webContentsId
        }),
      onRendererDestroyed: native.onRendererDestroyed,
      projectEnvironmentChanged: () => runtime?.projectService.notifyEnvironmentProjectionChanged()
    })
    constructionIncomplete = false
    await providerDbLoader.initialize()
    if (isStopping()) throw new Error('Core Kernel startup was stopped')
    constructionIncomplete = true
    providers = createCoreProviders({
      profile,
      data,
      artifactSpool,
      profileDirectory: bootstrap.profileDirectory,
      homeDirectory: bootstrap.homeDirectory,
      temporaryDirectory: bootstrap.temporaryDirectory,
      registryDirectory: path.join(
        bootstrap.isPackaged
          ? path.join(bootstrap.resourcesPath, 'app.asar.unpacked')
          : bootstrap.appPath,
        'resources',
        'acp-registry'
      ),
      crypto: native.providerCrypto,
      openExternal: native.openExternal,
      fetchRegistryIcon: native.fetchRegistryIcon,
      sendToRenderer: native.sendToRenderer,
      onRendererDestroyed: native.onRendererDestroyed,
      publishEvent,
      projectEnvironmentChanged: () => runtime?.projectService.notifyEnvironmentProjectionChanged(),
      readLanguage: () => settings.desktopSettings.getLanguage(),
      allowInsecureTls: options.allowInsecureTls,
      registry: {
        getNpmRegistry: () => runtime!.mcpService.getNpmRegistry(),
        getUvRegistry: () => runtime!.mcpService.getUvRegistry()
      },
      memory: {
        cleanupDeletedAgentResources: (id) =>
          runtime!.memoryService.cleanupDeletedAgentResources(id),
        onAgentMemoryMaintenanceConfigChanged: (id) =>
          runtime!.memoryService.onAgentMemoryMaintenanceConfigChanged(id)
      },
      cleanupAgentSkills: async (id) => {
        await runtime!.ensureSkillServicesInitialized()
        await runtime!.skillService.cleanupAgentSkills(id)
      },
      skillSettings: settings.skillSettings,
      assertAcpInstallAllowed: () =>
        databaseRequests.assertRouteAllowed('config.ensureAcpAgentInstalled')
    })
    runtime = await createCoreRuntime({
      ...native,
      ...options.helpers,
      importSnapshot: async (filePath, mode) => {
        if (!maintenance) throw new Error('Core runtime is starting')
        return await maintenance.run({ kind: 'import-backup-file', filePath, mode })
      },
      resolveRouteDispatcher: () => controller?.routeDispatcher,
      profile,
      data,
      providers,
      bootstrap,
      settings,
      browser: options.browser,
      artifactSpool,
      startupWorkloadCoordinator,
      startupRunId,
      databaseRequests,
      syncActiveSessions,
      mcpApps: { registry: mcpApps, desktop: native.mcpAppDesktop },
      agentInvocationAdmission: options.admission,
      memoryVectorStores: options.vectors,
      execution: {
        typedEventHub,
        resolveSessionRunId: data.resolveSessionRunId,
        onRendererDestroyed: native.onRendererDestroyed,
        destroySessionBrowser: native.destroySessionBrowser,
        observeDelegation: native.observeDelegation,
        observationsEnabled: () => profile.settingsStore.get<boolean>('loggingEnabled') ?? false
      },
      onSessionCompleted: (id) => {
        const session = data!.appSessionService.get(id)
        if (session?.sessionKind !== 'regular' || data!.resolveSessionRunId(id) !== null) return
        void native
          .notifySessionCompletion({ id, title: session.title })
          .catch((error) => logger.warn('[Core] Session notification failed', { id, error }))
      },
      agentCliTokenAuthority,
      publishEvent,
      isStopping
    })
    constructionIncomplete = false
    if (isStopping()) throw new Error('Core Kernel startup was stopped')
    maintenance = createCoreMaintenance({
      profile,
      data,
      providers,
      runtime,
      settings,
      databaseRequests,
      startupWorkloadCoordinator,
      native,
      isStopping,
      stopForCleanup: stop
    })
    controller = createCoreController({
      profile,
      data,
      providers,
      runtime,
      settings,
      bootstrap,
      databaseRequests,
      startupWorkloadCoordinator,
      artifactSpool,
      maintenance,
      native,
      publishEvent
    })
    providers.agentSettings.start()
    const start = (): Promise<void> => {
      if (starting) return starting
      const owner = runtime!
      const assertActive = () => {
        if (isStopping()) throw new Error('Core Kernel startup was stopped')
      }
      starting = (async () => {
        assertActive()
        await owner.initializeStartup()
        assertActive()
        owner.cronJobs.start()
        owner.memoryService.startBackgroundMaintenance()
        await native.configurationHost.resume()
        assertActive()
        await settings.appSettingsService.observeSystemTheme()
        assertActive()
        try {
          await artifactSpool.initialize()
          assertActive()
          await owner.cliServer.start()
        } catch (error) {
          native.reportStartupFailure('cli_control', 'unknown')
          logger.error('[CLI] Failed to start local control server', error)
        }
        assertActive()
        try {
          await owner.syncHostService.startIfEnabled()
        } catch (error) {
          native.reportStartupFailure('sync_host', 'unknown')
          logger.error('[SyncHost] Failed to start host mode', error)
        }
        assertActive()
        try {
          await owner.automaticSync.start()
        } catch (error) {
          logger.error('[SyncReplica] Failed to start automatic sync', error)
        }
        assertActive()
        if (owner.cliServer.getStatus().running) {
          try {
            await owner.cliLauncherService.ensureInstalled()
          } catch (error) {
            native.reportStartupFailure('cli_launcher', 'unknown')
            logger.warn('[CLI] Failed to install or refresh the command launcher', error)
          }
        }
        assertActive()
        owner.startStartupTasks()
        owner.scheduleBackgroundWork()
      })()
      return starting
    }
    return {
      data,
      providers,
      runtime,
      controller,
      maintenance,
      get stopping() {
        return stoppingRequested
      },
      databaseRequests,
      typedEventHub,
      artifactSpool,
      mcpApps,
      publishEvent,
      start,
      stop
    }
  } catch (error) {
    try {
      await stop()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Core Kernel startup did not retire')
    }
    throw error
  }
}
