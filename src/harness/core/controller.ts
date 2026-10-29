import logger from '@shared/logger'
import type { DeepchatEventName } from '@shared/contracts/events'
import { projectEnvironmentsChangedEvent, sessionsUpdatedEvent } from '@shared/contracts/events'
import type { initializeCoreProfile } from '@/app/profileStartup'
import type { DatabaseRequestGate } from '@/app/databaseRequestGate'
import type { StartupWorkloadCoordinator } from '@/app/startupWorkloadCoordinator'
import { createRouteDispatcher } from '@/routes'
import type { DeepchatRouteMap } from '@/routes/routeRegistry'
import { createNodeScheduler } from '@/routes/scheduler'
import { createProviderRoutes } from '@/provider/routes'
import { ProviderImportService } from '@/provider/providerImportService'
import { createToolRoutes } from '@/tool/routes'
import { createPluginRoutes } from '@/plugin/routes'
import { createSkillRoutes } from '@/skill/routes'
import { createMcpRoutes } from '@/mcp/routes'
import { createRemoteRoutes } from '@/remote/routes'
import { createSchedulerRoutes } from '@/scheduler/routes'
import { createMemoryRoutes } from '@/memory/routes'
import { createFileRoutes } from '@/file/routes'
import { createOcrRoutes } from '@/ocr/routes'
import { createToolchainRoutes } from '@/toolchains/routes'
import { createKnowledgeRoutes } from '@/knowledge/routes'
import { createWorkspaceRoutes } from '@/workspace/routes'
import { createOrchestrationRoutes } from '@/orchestration/routes'
import { createLivePort } from './execution'
import { createProjectRoutes } from '@/project/routes'
import { createSessionRoutes } from '@/session/routes'
import { createAgentRoutes } from '@/agent/routes'
import { createPromptRoutes } from '@/agent/promptRoutes'
import { createAcpRoutes } from '@/agent/acp/routes'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import { createOnboardingRoutes } from '@/onboarding/routes'
import { createExporterRoutes } from '@/exporter/routes'
import { createSyncRoutes } from '@/sync/routes'
import { createSyncHostRoutes } from '@/sync/host/routes'
import { createSyncPeerRoutes } from '@/sync/peer/routes'
import { createPlatformRoutes } from '@/platform/routes'
import type { ProxySettingMode } from '@/platform/proxySettings'
import { createHookRoutes } from '@/hook/routes'
import { createAppSettingsRoutes } from '@/app/settingsRoutes'
import { createAppRoutes } from '@/app/routes'
import { createCliRoutes, createArtifactRoutes, createCliComputeRoutes } from '@/cli'
import { createApprovalRoutes } from '@/approval/routes'
import { createCliProviderModelAdminRoutes } from '@/cli/providerModelAdminRoutes'
import { createCliMcpAdminRoutes } from '@/cli/mcpAdminRoutes'
import { ImportMode } from '@/sync'
import { OAuthService, type GitHubCopilotAuthorizationPort } from './oauth'
import type { ArtifactSpool } from '@/cli/artifactSpool'
import type { createCoreMaintenance } from './maintenance'
import type { createCoreData } from './data'
import type { createCoreProviders } from './providers'
import type { createCoreRuntime } from './runtime'
import type { createCoreSettings } from './settings'

export type CoreControllerNative = Pick<
  Parameters<typeof createAppRoutes>[0],
  'isMainWindowContext' | 'rendererPerformance' | 'splash'
> & {
  isSettingsWindow(windowId: number | null): Promise<boolean>
  pluginSettingsWindow: Parameters<typeof createPluginRoutes>[1]
  images: Parameters<typeof createFileRoutes>[1]
  pickToolchainPath: Parameters<typeof createToolchainRoutes>[0]['pickPath']
  hasTrustedRenderer: Parameters<typeof createCliRoutes>[0]['hasTrustedRenderer']
  applyProxy(mode: ProxySettingMode, url: string, resolve: boolean): Promise<boolean>
  copilotAuthorization: GitHubCopilotAuthorizationPort
}

export function createCoreController(options: {
  profile: Pick<
    Awaited<ReturnType<typeof initializeCoreProfile>>,
    'settingsStore' | 'proxySettings' | 'databaseSecurityService' | 'database'
  >
  data: ReturnType<typeof createCoreData>
  providers: ReturnType<typeof createCoreProviders>
  settings: ReturnType<typeof createCoreSettings>
  runtime: Awaited<ReturnType<typeof createCoreRuntime>>
  bootstrap: { temporaryDirectory: string; isPackaged: boolean; appVersion: string }
  databaseRequests: DatabaseRequestGate
  startupWorkloadCoordinator: StartupWorkloadCoordinator
  artifactSpool: ArtifactSpool
  maintenance: ReturnType<typeof createCoreMaintenance>
  native: CoreControllerNative
  nativeRouteMaps?: readonly DeepchatRouteMap[]
  publishEvent(name: DeepchatEventName, payload: unknown): void
}) {
  const {
    profile,
    data,
    providers,
    settings,
    runtime,
    bootstrap,
    databaseRequests,
    startupWorkloadCoordinator,
    artifactSpool,
    maintenance,
    native,
    publishEvent: publishDeepchatEvent
  } = options
  const {
    settingsDatabase,
    providerSettings,
    sessionData,
    memoryDatabase,
    promptSettings,
    tapeInspectorHeadWatcher,
    usageStatsService
  } = data
  const { providerRuntime, agentSettings, acpAuthService, acpRuntimeOwner, cliComputeService } =
    providers
  const acpProviderAdminPort = providerRuntime
  const { appSettingsService, skillSettings, commandShellService, recordSettingsActivity } =
    settings
  const {
    execution,
    toolService,
    pluginService,
    skillService,
    skillSyncService,
    mcpService,
    remoteService,
    cronJobs,
    memoryService,
    fileService,
    ocrRuntimeService,
    toolchainService,
    knowledgeService,
    knowledgeSettings,
    workspaceService,
    projectService,
    sessionPermissionPort,
    exporter,
    syncService,
    syncSettings,
    syncHostService,
    syncPeerService,
    hookService,
    cliServer,
    cliMutationGuard,
    cliSkillService,
    ensureSkillServicesInitialized
  } = runtime
  const {
    deepChatAgentHarness,
    orchestrationCapabilityResolver,
    sessionAssignment,
    sessionLifecycle,
    sessionQuery,
    desktopSessionBinding,
    sessionTurn,
    sessionHistorySearch,
    agentSessionExportService,
    sessionTranslation,
    acpAgentRuntime,
    cliRunService
  } = execution
  const { database: mainDatabase, databaseSecurityService } = profile
  const { run: runDatabaseMaintenance, pullLatestBackupFromCloud } = maintenance
  const oauthService = new OAuthService(
    {
      getGitHubCopilotSignInTarget: async (providerId) => {
        if (databaseRequests.state !== 'running')
          throw new Error(`App database maintenance is ${databaseRequests.state}`)
        return await providerRuntime.getGitHubCopilotSignInTarget(providerId)
      },
      commitGitHubCopilotCredential: async (target, key) => {
        if (databaseRequests.state !== 'running')
          throw new Error(`App database maintenance is ${databaseRequests.state}`)
        await providerRuntime.commitGitHubCopilotCredential(target, key)
      },
      invalidateGitHubCopilotSignIns: () => providerRuntime.invalidateGitHubCopilotSignIns()
    },
    providers.accounts,
    native.copilotAuthorization
  )
  const providerQueryScheduler = createNodeScheduler()
  const providerRoutes = createProviderRoutes({
    providerSettings,
    providerRuntime,
    acpProviderAdminPort,
    providerImportService: new ProviderImportService({
      getProviders: () => providerSettings.getProviders(),
      getDefaultProviders: () => providerSettings.getDefaultProviders(),
      addCustomModel: (providerId, model) => providerSettings.addCustomModel(providerId, model),
      updateProvidersBatch: (batchUpdate) => providerRuntime.updateProvidersBatch(batchUpdate)
    }),
    oauthService,
    scheduler: providerQueryScheduler,
    recordSettingsActivity: (input) => settingsDatabase.recordSettingsActivity(input)
  })
  const toolRoutes = createToolRoutes(toolService)
  const pluginRoutes = createPluginRoutes(pluginService, native.pluginSettingsWindow)
  const skillRoutes = createSkillRoutes({
    tempDirectory: bootstrap.temporaryDirectory,
    skillService,
    skillSyncService,
    skillSettings,
    ensureInitialized: ensureSkillServicesInitialized,
    assertSessionActiveSkillsMutable: async (conversationId) => {
      const state = await deepChatAgentHarness.getSessionState(conversationId)
      if (state?.status === 'generating') {
        throw new Error('Cannot change Session Skills while the session is generating.')
      }
    },
    recordSettingsActivity: (input) => settingsDatabase.recordSettingsActivity(input)
  })
  const mcpRoutes = createMcpRoutes({
    mcpService,
    mcpAppHost: (() => {
      if (!mcpService.appHost) {
        throw new Error('MCP Apps host is not configured')
      }
      return mcpService.appHost
    })(),
    isSettingsWindow: native.isSettingsWindow,
    recordSettingsActivity: (input) => settingsDatabase.recordSettingsActivity(input)
  })
  const remoteRoutes = createRemoteRoutes(remoteService)
  const schedulerRoutes = createSchedulerRoutes(cronJobs)
  const memoryRoutes = createMemoryRoutes({
    memoryService,
    getAgentType: (agentId) => agentSettings.getAgentType(agentId),
    getTapeInspection: () => sessionData.tapeStore,
    getAuditEntries: () => memoryDatabase.agentMemoryAuditTable
  })
  const fileRoutes = createFileRoutes(fileService, native.images)
  const ocrRoutes = createOcrRoutes({ runtime: ocrRuntimeService })
  const toolchainRoutes = createToolchainRoutes({
    service: toolchainService,
    pickPath: native.pickToolchainPath
  })
  const knowledgeRoutes = createKnowledgeRoutes({
    service: knowledgeService,
    settings: knowledgeSettings,
    applyConfigChange: async () => {
      mcpService.handleConfigChanged()
      await knowledgeService.syncConfigChanges()
    },
    recordActivity: (input) => {
      void settingsDatabase.recordSettingsActivity(input).catch((error) => {
        console.warn('[SettingsActivity] Failed to record settings activity:', error)
      })
    }
  })
  const workspaceRoutes = createWorkspaceRoutes(workspaceService)
  const orchestrationRoutes = createOrchestrationRoutes({
    resolveCapability: (target) =>
      'sessionId' in target
        ? orchestrationCapabilityResolver.resolveSession(target.sessionId)
        : orchestrationCapabilityResolver.resolveDraft(target.agentId),
    getPolicy: (sessionId) => sessionAssignment.getOrchestrationPolicy(sessionId),
    setPolicy: (sessionId, policy) =>
      sessionAssignment.updateOrchestrationPolicy(sessionId, policy),
    liveDelegations: createLivePort(() => execution.liveDelegationService)
  })
  const projectRoutes = createProjectRoutes({
    projectService,
    publishEnvironmentsChanged: (action, environmentPath, version) => {
      publishDeepchatEvent(projectEnvironmentsChangedEvent.name, {
        action,
        path: environmentPath,
        version
      })
    }
  })
  const sessionRoutes = createSessionRoutes({
    lifecycle: sessionLifecycle,
    projection: sessionQuery,
    desktop: desktopSessionBinding,
    turn: sessionTurn,
    assignment: sessionAssignment,
    permission: sessionPermissionPort,
    agentSettings,
    scheduler: createNodeScheduler(),
    historySearch: sessionHistorySearch,
    exportService: agentSessionExportService,
    translation: sessionTranslation,
    usageStats: usageStatsService,
    tapeInspectorHeadWatcher,
    sessionReferences: sessionData.sessionReferences
  })
  const agentRoutes = createAgentRoutes({
    agentSettings,
    recordActivity: (input) => {
      void settingsDatabase.recordSettingsActivity(input).catch((error) => {
        console.warn('[SettingsActivity] Failed to record settings activity:', error)
      })
    },
    reconcileScheduler: async () => {
      await cronJobs.reconcileScheduler('agent-change')
    }
  })
  const promptRoutes = createPromptRoutes({
    settings: promptSettings,
    recordActivity: (input) => {
      void settingsDatabase.recordSettingsActivity(input).catch((error) => {
        console.warn('[SettingsActivity] Failed to record settings activity:', error)
      })
    }
  })
  const acpRoutes = createAcpRoutes({
    auth: acpAuthService,
    owner: acpRuntimeOwner,
    runtime: acpAgentRuntime,
    isMainWindowContext: native.isMainWindowContext,
    importHistory: async (sessionId) => {
      const localId = toAppSessionId(sessionId)
      const instance = acpAgentRuntime.getHydrated(localId)
      if (!instance) throw new Error('ACP session is not initialized')
      await instance.runIdleOperation(async () => {
        const session = acpRuntimeOwner.getOrCreate().sessionController.getSession(localId)
        const snapshot =
          session &&
          (await acpRuntimeOwner
            .getOrCreate()
            .sessionController.getExtensions(localId, session.agentId))
        if (!session || !snapshot?.history) throw new Error('Read ACP history before importing')
        sessionData.transcript.importAcpHistory(
          sessionId,
          session.agentId,
          session.sessionId,
          snapshot.history
        )
        publishDeepchatEvent('sessions.messages.changed', {
          sessionId,
          messages: sessionData.transcript.getMessages(sessionId),
          version: Date.now()
        })
        publishDeepchatEvent('sessions.updated', { sessionIds: [sessionId], reason: 'updated' })
      })
    }
  })
  const onboardingRoutes = createOnboardingRoutes(profile.settingsStore)
  const exporterRoutes = createExporterRoutes(exporter)
  const syncRoutes = createSyncRoutes({
    sync: syncService,
    settings: syncSettings,
    importFromSync: (backupFileName, importMode) =>
      runDatabaseMaintenance({
        kind: 'import-backup',
        fileName: backupFileName,
        mode: importMode ?? ImportMode.INCREMENT
      }),
    pullLatestBackupFromCloud: (importMode) => pullLatestBackupFromCloud(importMode),
    recordActivity: (input) => {
      void settingsDatabase.recordSettingsActivity(input).catch((error) => {
        console.warn('[SettingsActivity] Failed to record settings activity:', error)
      })
    }
  })
  const syncHostRoutes = createSyncHostRoutes({ host: syncHostService })
  const platformRoutes = createPlatformRoutes({
    proxySettings: profile.proxySettings,
    applyProxyMode: async (mode) => {
      if (await native.applyProxy(mode, profile.proxySettings.getCustomUrl(), true))
        providerRuntime.handleProxyResolved()
    },
    applyCustomProxyUrl: async (url) => {
      await native.applyProxy(
        profile.proxySettings.getMode(),
        url,
        profile.proxySettings.getMode() === 'custom'
      )
    }
  })
  const hookRoutes = createHookRoutes({ service: hookService })
  const appSettingsRoutes = createAppSettingsRoutes({
    settings: profile.settingsStore,
    appSettings: appSettingsService,
    commandShell: commandShellService,
    publishEvent: publishDeepchatEvent,
    recordActivity: recordSettingsActivity,
    listActivities: (limit) => settingsDatabase.listSettingsActivity(limit)
  })
  const appRoutes = createAppRoutes({
    isPackaged: bootstrap.isPackaged,
    logging: { openFolder: () => appSettingsService.openLoggingFolder() },
    rendererPerformance: native.rendererPerformance,
    isMainWindowContext: native.isMainWindowContext,
    agentSettings,
    projects: projectService,
    databaseSecurity: databaseSecurityService,
    database: {
      getDatabase: () => mainDatabase.getDatabase(),
      repairSchema: () => runDatabaseMaintenance({ kind: 'repair-schema' })
    },
    startupSession: sessionQuery,
    desktopSession: desktopSessionBinding,
    startup: startupWorkloadCoordinator,
    ensureDefaultWorkspace: () => projectService.ensureDefaultWorkspace(),
    enableDatabaseEncryption: (password) =>
      runDatabaseMaintenance({ kind: 'enable-encryption', password }),
    changeDatabasePassword: (currentPassword, newPassword) =>
      runDatabaseMaintenance({ kind: 'change-password', currentPassword, newPassword }),
    disableDatabaseEncryption: (currentPassword) =>
      runDatabaseMaintenance({ kind: 'disable-encryption', currentPassword }),
    recordActivity: (input) => {
      void settingsDatabase.recordSettingsActivity(input).catch((error) => {
        console.warn('[SettingsActivity] Failed to record settings activity:', error)
      })
    },
    publishSessionsUpdated: (sessionIds) => {
      publishDeepchatEvent(sessionsUpdatedEvent.name, { sessionIds, reason: 'created' })
    },
    splash: native.splash
  })
  const cliRoutes = createCliRoutes({
    appVersion: bootstrap.appVersion,
    getStatus: () => cliServer.getStatus(),
    hasTrustedRenderer: native.hasTrustedRenderer
  })
  const approvalRoutes = createApprovalRoutes({
    resolve: (input, caller) => cliMutationGuard.resolve(input, caller)
  })
  const artifactRoutes = createArtifactRoutes(artifactSpool)
  const cliComputeRoutes = createCliComputeRoutes(cliComputeService)
  const cliProviderModelAdminRoutes = createCliProviderModelAdminRoutes({
    providerSettings,
    providerRuntime,
    scheduler: providerQueryScheduler,
    recordSettingsActivity: (input) => {
      void settingsDatabase.recordSettingsActivity(input).catch((error) => {
        console.warn('[SettingsActivity] Failed to record CLI provider activity:', error)
      })
    }
  })
  const cliSkillRoutes = cliSkillService.createRoutes()
  const cliMcpAdminRoutes = createCliMcpAdminRoutes({
    mcp: mcpService,
    recordSettingsActivity: (input) => {
      void settingsDatabase.recordSettingsActivity(input).catch((error) => {
        console.warn('[SettingsActivity] Failed to record CLI MCP activity:', error)
      })
    },
    log: logger
  })
  const cliRunRoutes = cliRunService.createRoutes()
  const routeDispatcher = createRouteDispatcher({
    appDatabaseMaintenance: databaseRequests,
    routeMaps: [
      ...(options.nativeRouteMaps ?? []),
      providerRoutes,
      toolRoutes,
      pluginRoutes,
      skillRoutes,
      mcpRoutes,
      remoteRoutes,
      schedulerRoutes,
      memoryRoutes,
      fileRoutes,
      ocrRoutes,
      toolchainRoutes,
      knowledgeRoutes,
      workspaceRoutes,
      orchestrationRoutes,
      projectRoutes,
      sessionRoutes,
      agentRoutes,
      promptRoutes,
      acpRoutes,
      onboardingRoutes,
      exporterRoutes,
      syncRoutes,
      syncHostRoutes,
      createSyncPeerRoutes(syncPeerService),
      platformRoutes,
      hookRoutes,
      appSettingsRoutes,
      appRoutes,
      approvalRoutes,
      cliRoutes,
      artifactRoutes,
      cliComputeRoutes,
      cliProviderModelAdminRoutes,
      cliSkillRoutes,
      cliMcpAdminRoutes,
      cliRunRoutes
    ],
    isSettingsWindow: native.isSettingsWindow,
    startupWorkloadCoordinator
  })
  return { routeDispatcher, oauthService }
}
