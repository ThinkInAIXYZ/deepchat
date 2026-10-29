import { SyncReplicaStore } from '@/sync/replica/store'
import { SyncReplicaEndpoint } from '@/sync/replica/endpoint'
import { AutomaticSync } from '@/sync/replica/automatic'
import { SyncPeerService } from '@/sync/peer'
import { NowledgeMemConnections } from '@/nowledgeMem'
import { NOWLEDGE_PLUGIN_ID } from '@shared/types/nowledgeMemPlugin'
import logger from '@shared/logger'
import {
  type MainLogStartupComponent,
  type MainLogStartupComponentFailureCategory
} from '@/logging/mainLogEvents'
import { projectEnvironmentsChangedEvent } from '@shared/contracts/events/project.events'
import path from 'path'
import { type DeepchatEventName } from '@shared/contracts/events'
import type { DialogServicePort } from '@shared/types/dialog'
import { type RutisMemoryVectorStores } from '@/harness/memory-vector'
import { FileService } from '@/file'
import { noteNodeDemandFromMcp, type ToolchainService } from '@/toolchains'
import { McpService } from '@/mcp'
import { McpOAuthCredentialStore } from '@/mcp/oauthCredentialStore'
import { SyncService } from '@/sync'
import { type DatabaseRequestGate } from '@/app/databaseRequestGate'
import { SyncSettings } from '@/sync/settings'
import { type SemanticNotificationPublisher } from '@/notifications'
import { type DesktopSettings } from '@/desktop/settings'
import { KnowledgeService } from '@/knowledge'
import type { IFileWatcherService } from '@/platform/fileWatcher'
import { ToolService } from '@/tool'
import { KnowledgeSettings } from '@/knowledge/settings'
import { emitAgentCatalogChanged } from '@/app/agentEvents'
import { SyncHostService } from '@/sync/host'
import { type AppSettingsService } from '@/app/settingsService'
import type {
  CommandPermissionService,
  FilePermissionService,
  SettingsPermissionService,
  ToolPermissionBroker
} from '@/tool/permission'
import type { AgentToolDependencies } from '@/tool/runtimePorts'
import { ConversationExporterService } from '@/exporter'
import { SkillService } from '@/skill'
import type { SkillSessionStatePort } from '@/skill'
import { type SkillSettings } from '@/skill/settings'
import { SkillSyncService } from '@/skill/sync'
import { SkillExecutionAuthorityResolver } from '@/skill/skillExecutionAuthority'
import { HookService } from '@/hook'
import { HookSettings } from '@/hook/config'
import { SchedulerService, createCronJobRunSessionStarter } from '@/scheduler'
import { SchedulerProcessManager } from '@/scheduler/schedulerProcessManager'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import { MemoryService } from '@/memory'
import { ProjectService } from '@/project'
import { type LiveDelegationConsentAuthority } from '@/orchestration/liveDelegationConsent'
import { RemoteService } from '@/remote'
import { PluginService } from '@/plugin'
import { PluginRuntimeSupervisor } from '@/plugin/runtimeSupervisor'
import { createMinimalProcessEnvironment } from '@/mcp/processEnvironment'
import { type AgentTraceSettings } from '@/agent/traceSettings'
import {
  normalizeDeepChatSubagentSlots,
  resolveDeepChatSubagentCapability
} from '@shared/lib/deepchatSubagents'
import { DEFAULT_DISABLED_AGENT_TOOLS } from '@shared/agentTools'
import { composeSubagentAuthority } from '@/session/subagentAuthority'
import type { ProviderCatalogPort } from '@/provider/ports'
import { createSkillExecutionAuthorityTapePort } from '@/tape/application/capabilityAdapters'
import { createInMemoryServerFactory } from '@/mcp/inMemoryServers/builder'
import { type AgentCliCommandAccess, CliSkillService } from '@/cli'
import { BackgroundExecService } from '@/agent/shared/process/backgroundExecSessionManager'
import { createMemoryProviderBindings } from '@/app/memoryProviderBindings'
import { createSessionPermissionPort } from '@/app/sessionPermissionAdapter'
import type { initializeCoreProfile } from '@/app/profileStartup'
import type { createCoreData } from './data'
import type { createCoreProviders } from './providers'
import { createCoreExecution, createLivePort } from './execution'
import type { CredentialCryptoPort } from '@/config/secretStore'
import type { ProjectHost } from '@/project'
import type { RemoteServiceDeps } from '@/remote/ports'

type CoreProfile = Awaited<ReturnType<typeof initializeCoreProfile>>
type CoreExecution = ReturnType<typeof createCoreExecution>
type CoreExecutionOptions = Parameters<typeof createCoreExecution>[0]

export async function createCoreRuntime(options: {
  profile: Pick<
    CoreProfile,
    | 'settingsStore'
    | 'secretStore'
    | 'mcpSettings'
    | 'privacySettings'
    | 'pluginToolPolicies'
    | 'database'
    | 'settingsDatabase'
    | 'providerDatabase'
  >
  data: ReturnType<typeof createCoreData>
  providers: ReturnType<typeof createCoreProviders>
  bootstrap: {
    profileDirectory: string
    homeDirectory: string
    temporaryDirectory: string
    appDataDirectory: string
    documentsDirectory: string | null
    projectHomeDirectory: string | null
    appPath: string
    appVersion: string
    isPackaged: boolean
    resourcesPath: string
    workingDirectory: string
    builtinSkillsDirectories: string[]
  }
  settings: {
    desktopSettings: DesktopSettings
    appSettingsService: AppSettingsService
    skillSettings: SkillSettings
    traceSettings: AgentTraceSettings
  }
  toolchains: ToolchainService
  fileWatcherService: IFileWatcherService
  permissions: {
    agentCliTokenAuthority: Parameters<
      typeof createSessionPermissionPort
    >[0]['agentCliTokenAuthority']
    commandPermissionService: CommandPermissionService
    filePermissionService: FilePermissionService
    settingsPermissionService: SettingsPermissionService
    toolPermissionBroker: ToolPermissionBroker
  }
  commandPermissionHandler: CommandPermissionService
  commandEnvironment: AgentCliCommandAccess
  liveDelegationConsent: LiveDelegationConsentAuthority
  databaseRequests: DatabaseRequestGate
  syncActiveSessions: Set<string>
  importSnapshot: NonNullable<ConstructorParameters<typeof SyncPeerService>[0]['importSnapshot']>
  assertSyncTokenStorageAvailable(): void
  semanticNotifications: SemanticNotificationPublisher
  dialog: DialogServicePort
  secureCrypto: CredentialCryptoPort
  getProxyUrl(): Promise<string | null>
  whenProxyReady(): Promise<void>
  openExternal(url: string): Promise<void>
  openPath(filePath: string): Promise<string>
  selectDirectory: ProjectHost['selectDirectory']
  cacheImage: NonNullable<AgentToolDependencies['cacheImage']>
  browser: AgentToolDependencies['browser']
  agentDesktop: AgentToolDependencies['desktop']
  pluginSettingsWindow: ConstructorParameters<typeof PluginService>[0]['settingsWindow']
  remoteAuthWindows: RemoteServiceDeps['authWindows']
  openRemoteSession: RemoteServiceDeps['desktop']['openSession']
  showNotification: NonNullable<RemoteServiceDeps['notifications']>['showNotification']
  mcpPreview: ConstructorParameters<typeof McpService>[15]
  mcpApps: Pick<NonNullable<ConstructorParameters<typeof McpService>[16]>, 'registry' | 'desktop'>
  spawnBackgroundExecHost: ConstructorParameters<typeof BackgroundExecService>[0]
  spawnCodeModeHost: ConstructorParameters<typeof ToolService>[0]['spawnCodeModeHost']
  spawnSchedulerHost: ConstructorParameters<typeof SchedulerProcessManager>[0]['spawnHost']
  agentInvocationAdmission: CoreExecutionOptions['agentInvocationAdmission']
  memoryVectorStores: Pick<
    RutisMemoryVectorStores,
    'createVectorStore' | 'resetVectorStore' | 'markVectorStoreQuarantined'
  >
  execution: Pick<
    CoreExecutionOptions,
    | 'typedEventHub'
    | 'resolveSessionRunId'
    | 'onRendererDestroyed'
    | 'destroySessionBrowser'
    | 'observeDelegation'
    | 'observationsEnabled'
  >
  onSessionCompleted: CoreExecutionOptions['harness']['onSessionCompleted']
  onSessionInactive(sessionId: string): void
  runJournalObserver: CoreExecutionOptions['harness']['runJournalObserver']
  toolSurfaceRollout: CoreExecutionOptions['harness']['toolSurfaceRunMode']
  agentCliTokenAuthority: CoreExecutionOptions['harness']['agentCliTokenAuthority']
  programmaticToolParents: CoreExecutionOptions['harness']['programmaticToolParents']
  attachmentRouter: CoreExecutionOptions['harness']['attachmentRouter']
  sessionUiPort: CoreExecutionOptions['harness']['sessionUiPort']
  publishEvent(name: DeepchatEventName, payload: unknown): void
  isStopping(): boolean
  mcpReadinessChanged(ready: boolean): void
  reportStartupFailure(
    component: MainLogStartupComponent,
    category: MainLogStartupComponentFailureCategory
  ): void
}) {
  const dependencies = options.profile
  const {
    bootstrap,
    databaseRequests,
    syncActiveSessions,
    commandPermissionHandler,
    liveDelegationConsent,
    semanticNotifications,
    agentInvocationAdmission,
    memoryVectorStores,
    agentCliTokenAuthority,
    programmaticToolParents,
    toolSurfaceRollout,
    attachmentRouter,
    sessionUiPort,
    publishEvent: publishDeepchatEvent
  } = options
  const { settingsDatabase, providerDatabase, database: mainDatabase } = dependencies
  const {
    projectDatabase,
    schedulerDatabase,
    sessionData,
    providerSettings,
    promptSettings,
    appSessionService,
    agentRepository,
    agentLifecycle,
    sessionDeletionGate,
    memoryDatabase,
    sessionRuntimeEvents,
    liveDelegationRepository,
    legacyChatImportService
  } = options.data
  const {
    providerRuntime,
    agentSettings,
    acpRuntimeOwner,
    acpSessionPersistence,
    commandShellService,
    agentDefaults
  } = options.providers
  const { desktopSettings, appSettingsService, skillSettings, traceSettings } = options.settings
  const toolchainService = options.toolchains
  const {
    commandPermissionService,
    filePermissionService,
    settingsPermissionService,
    toolPermissionBroker
  } = options.permissions
  const acpAsLlmProviderPermission = providerRuntime
  const acpAsLlmProviderSessionControl = providerRuntime
  let coreExecution: CoreExecution
  let deepChatAgentHarness: CoreExecution['deepChatAgentHarness']
  let sessionQuery: CoreExecution['sessionQuery']
  let sessionAssignment: CoreExecution['sessionAssignment']
  let sessionTurn: CoreExecution['sessionTurn']
  let sessionLifecycle: CoreExecution['sessionLifecycle']
  let acpAgentRuntime: CoreExecution['acpAgentRuntime']
  const liveDelegationService = createLivePort(() => coreExecution.liveDelegationService)
  let pluginInitializationPromise: Promise<void> | null = null
  let skillInitializationPromise: Promise<void> | null = null
  let skillSyncScanPromise: Promise<void> | null = null
  const fileWatcherService = options.fileWatcherService
  const projectService = new ProjectService(
    projectDatabase,
    sessionData.database,
    {
      tempDirectory: bootstrap.temporaryDirectory,
      userDataDirectory: bootstrap.profileDirectory,
      appDataDirectory: bootstrap.appDataDirectory,
      documentsDirectory: bootstrap.documentsDirectory,
      homeDirectory: bootstrap.projectHomeDirectory,
      selectDirectory: options.selectDirectory,
      openPath: (directory) => options.openPath(directory)
    },
    dependencies.settingsStore,
    (projectPath, version) =>
      publishDeepchatEvent('config.defaultProjectPath.changed', {
        path: projectPath,
        version
      }),
    (action, environmentPath, version) =>
      publishDeepchatEvent(projectEnvironmentsChangedEvent.name, {
        action,
        path: environmentPath,
        version
      })
  )
  const nowledgeMemConnections = new NowledgeMemConnections(
    dependencies.settingsStore,
    dependencies.secretStore,
    dependencies.mcpSettings
  )
  dependencies.mcpSettings.setPluginBindingResolver(NOWLEDGE_PLUGIN_ID, (config) =>
    nowledgeMemConnections.getMcpBindings(config)
  )
  const exporter = new ConversationExporterService({
    nowledgeMemConnections,
    sqlitePresenter: sessionData.database,
    settings: dependencies.settingsStore
  })
  const fileService = new FileService(dependencies.settingsStore, bootstrap.profileDirectory)
  const syncSettings = new SyncSettings(
    dependencies.settingsStore,
    dependencies.secretStore,
    publishDeepchatEvent,
    bootstrap.homeDirectory
  )
  const hookSettings = new HookSettings(dependencies.settingsStore)
  const knowledgeSettings = new KnowledgeSettings(
    dependencies.settingsStore,
    dependencies.mcpSettings
  )
  const syncService = new SyncService(
    syncSettings,
    mainDatabase,
    settingsDatabase,
    providerDatabase,
    publishDeepchatEvent,
    {
      profileDirectory: bootstrap.profileDirectory,
      temporaryDirectory: bootstrap.temporaryDirectory,
      openPath: (directory) => options.openPath(directory)
    }
  )
  const syncTokenStorage = {
    protectToken: async (token: string) => {
      options.assertSyncTokenStorageAvailable()
      return await dependencies.secretStore.wrap(token)
    },
    revealToken: (wrapped: string) => dependencies.secretStore.unwrap(wrapped)
  }
  const syncPeerService = new SyncPeerService({
    directory: path.join(bootstrap.profileDirectory, 'sync-peer'),
    replicaId: () => syncReplica!.replicaId,
    ...syncTokenStorage,
    isLocalDatabaseEncrypted: () => Boolean(mainDatabase.getDatabasePassword()),
    importSnapshot: (filePath, mode) => {
      if (databaseRequests.state !== 'running') throw new Error('sync.tunnel.error.busy')
      return options.importSnapshot(filePath, mode)
    }
  })
  const syncAppliedSessions = new Set<string>()
  const hasPendingSyncSession = (id: string): boolean =>
    Boolean(
      mainDatabase
        .getDatabase()
        .prepare(
          "SELECT 1 FROM deepchat_pending_inputs WHERE session_id=? AND state != 'consumed' LIMIT 1"
        )
        .get(id)
    )
  const syncReplica = new SyncReplicaStore({
    database: () => mainDatabase.getDatabase(),
    directory: path.join(bootstrap.profileDirectory, 'sync-replica'),
    canApply: (kind, id) =>
      databaseRequests.state === 'running' &&
      (kind === 'session'
        ? !syncActiveSessions.has(id) &&
          !hasPendingSyncSession(id) &&
          (syncAppliedSessions.has(id) || !sessionDeletionGate.hasActiveOperations(id))
        : syncActiveSessions.size === 0 &&
          !sessionDeletionGate.hasActiveOperationsOutside(syncAppliedSessions)),
    guard: async (units, operation) => {
      const ids = [
        ...new Set(units.filter((unit) => unit.kind === 'session').map((unit) => unit.id))
      ].sort()
      const apply = async (index: number): Promise<ReturnType<typeof operation>> => {
        if (index === ids.length) return operation()
        const id = ids[index]
        if (
          syncActiveSessions.has(id) ||
          hasPendingSyncSession(id) ||
          sessionDeletionGate.hasActiveOperations(id)
        )
          return false
        return sessionDeletionGate.runWithSessionDeletion(id, async () => {
          if (syncActiveSessions.has(id)) return false
          await deepChatAgentHarness.cleanupSession(id)
          await acpAgentRuntime.cleanupSession(toAppSessionId(id))
          syncAppliedSessions.add(id)
          try {
            return await apply(index + 1)
          } finally {
            syncAppliedSessions.delete(id)
          }
        })
      }
      return apply(0)
    },
    applied: (kind, id, deleted) => {
      if (kind === 'session')
        publishDeepchatEvent('sessions.updated', {
          sessionIds: [id],
          reason: deleted ? 'deleted' : 'synced'
        })
      if (kind === 'provider') {
        providerSettings.invalidateSyncCaches()
        providerRuntime.handleProviderAtomicUpdate({
          operation: 'remove',
          providerId: id,
          requiresRebuild: true
        })
        const provider = providerSettings.getProviderById(id)
        if (provider)
          providerRuntime.handleProviderAtomicUpdate({
            operation: 'add',
            providerId: id,
            provider,
            requiresRebuild: false
          })
        publishDeepchatEvent('providers.changed', {
          reason: 'providers',
          providerIds: [id],
          version: Date.now()
        })
        publishDeepchatEvent('models.changed', {
          reason: 'runtime-refresh',
          providerId: id,
          version: Date.now()
        })
      }
      if (kind === 'setting' && id === 'customPrompts') promptSettings.invalidateSyncCache()
      if (kind === 'setting') {
        const key = (
          [
            'autoCompactionEnabled',
            'autoCompactionTriggerThreshold',
            'autoCompactionRetainRecentPairs',
            'copyWithCotEnabled'
          ] as const
        ).find((value) => value === id)
        if (key) {
          const values = {
            autoCompactionEnabled: agentDefaults.getAutoCompactionEnabled(),
            autoCompactionTriggerThreshold: agentDefaults.getAutoCompactionTriggerThreshold(),
            autoCompactionRetainRecentPairs: agentDefaults.getAutoCompactionRetainRecentPairs(),
            copyWithCotEnabled: desktopSettings.getCopyWithCotEnabled()
          }
          publishDeepchatEvent('settings.changed', {
            changedKeys: [key],
            version: Date.now(),
            values: { [key]: values[key] }
          })
        }
      }
      const refresh = async () => {
        if (kind === 'agent')
          await emitAgentCatalogChanged(agentSettings, publishDeepchatEvent, [id])
        if (kind === 'mcp') {
          mcpService.handleConfigChanged()
          publishDeepchatEvent('mcp.config.changed', {
            mcpServers: await dependencies.mcpSettings.getMcpServers(),
            mcpEnabled: await dependencies.mcpSettings.getMcpEnabled(),
            version: Date.now()
          })
          deepChatAgentHarness.refreshToolRegistry()
        }
        if (kind === 'setting' && id === 'customPrompts')
          publishDeepchatEvent('config.customPrompts.changed', {
            prompts: await promptSettings.getCustomPrompts(),
            version: Date.now()
          })
        if (kind === 'setting' && (id === 'systemPrompts' || id === 'default_system_prompt'))
          await promptSettings.publishSystemPromptState()
      }
      void refresh().catch((error) =>
        logger.warn('[Sync] Could not refresh imported settings', error)
      )
      publishDeepchatEvent('sync.device.changed', { version: Date.now() })
    }
  })
  const replicaEndpoint = new SyncReplicaEndpoint({
    store: syncReplica,
    directory: path.join(bootstrap.profileDirectory, 'sync-host'),
    hostId: () => syncHostService.getHostId(),
    available: () =>
      databaseRequests.state === 'running' &&
      !syncService.isBackupInProgress() &&
      !mainDatabase.getDatabasePassword()
  })
  const automaticSync = new AutomaticSync({
    store: syncReplica,
    directory: path.join(bootstrap.profileDirectory, 'sync-peer'),
    connection: () => syncPeerService.connection(),
    available: () =>
      databaseRequests.state === 'running' &&
      !syncService.isBackupInProgress() &&
      !mainDatabase.getDatabasePassword(),
    isEncrypted: () => Boolean(mainDatabase.getDatabasePassword()),
    changed: () => publishDeepchatEvent('sync.device.changed', { version: Date.now() })
  })
  syncPeerService.automatic = automaticSync
  const syncHostService = new SyncHostService({
    changed: () => publishDeepchatEvent('sync.device.changed', { version: Date.now() }),
    replica: replicaEndpoint,
    resolveCloudflared: () => toolchainService.resolve('cloudflared').cloudflared,
    ...syncTokenStorage,

    createBackup: () => {
      if (databaseRequests.state !== 'running') throw new Error('sync.tunnel.error.busy')
      return syncService.createHostBackup()
    },
    getFolderPath: () => syncSettings.getFolderPath(),
    getUserDataPath: () => bootstrap.profileDirectory,
    getAppVersion: () => bootstrap.appVersion,
    logger
  })
  // Define the storage root for built-in knowledge databases.
  const dbDir = path.join(bootstrap.profileDirectory, 'app_db')
  const knowledgeService = new KnowledgeService({
    config: knowledgeSettings,
    storageRoot: dbDir,
    extensionDirectory: path.join(
      bootstrap.appPath.replace('app.asar', 'app.asar.unpacked'),
      'runtime',
      'duckdb',
      'extensions'
    ),
    files: fileService,
    dialog: options.dialog,
    embeddings: providerRuntime,
    events: {
      publishFileUpdated: (file) =>
        publishDeepchatEvent('knowledge.file.updated', { ...file, version: Date.now() }),
      publishFileProgress: (fileId, progress) =>
        publishDeepchatEvent('knowledge.file.progress', {
          fileId,
          ...progress,
          version: Date.now()
        })
    }
  })
  const pluginRuntimeSupervisor = new PluginRuntimeSupervisor()
  const mcpService = new McpService(
    providerSettings,
    agentSettings,
    promptSettings,
    dependencies.mcpSettings,
    dependencies.privacySettings,
    createInMemoryServerFactory({
      sqlitePresenter: sessionData.database,
      sessions: appSessionService,
      transcript: sessionData.transcript,
      settings: sessionData.settings,
      locale: desktopSettings,
      promptSettings,
      knowledgeSettings,
      knowledgeService: knowledgeService
    }),
    providerRuntime,
    () => deepChatAgentHarness.refreshToolRegistry(),
    semanticNotifications,
    publishDeepchatEvent,
    dependencies.pluginToolPolicies,
    {
      homeDirectory: bootstrap.homeDirectory,
      appVersion: bootstrap.appVersion,
      toolchains: toolchainService,
      getProxyUrl: options.getProxyUrl
    },
    {
      store: new McpOAuthCredentialStore({
        filePath: path.join(bootstrap.profileDirectory, 'mcp-oauth', 'credentials.json'),
        crypto: options.secureCrypto
      }),
      openExternal: (url) => options.openExternal(url)
    },
    options.cacheImage,
    pluginRuntimeSupervisor,
    options.mcpPreview,
    {
      registry: options.mcpApps.registry,
      desktop: options.mcpApps.desktop,
      permissionBroker: toolPermissionBroker,
      getPermissionMode: async (conversationId) =>
        sessionData.settings.get(conversationId)?.permission_mode ?? 'default',
      validateSource: (input) => {
        const message = sessionData.database.deepchatMessagesTable.get(input.messageId)
        return Boolean(
          message?.session_id === input.conversationId &&
          sessionData.database.deepchatAssistantBlocksTable.matchesMcpAppSource(
            input.messageId,
            input.blockId,
            input.descriptor,
            input.toolInput
          )
        )
      },
      persistModelContext: (messageId, blockId, descriptor, toolInput, context) =>
        sessionData.database.deepchatAssistantBlocksTable.updateMcpAppModelContext(
          messageId,
          blockId,
          descriptor,
          toolInput,
          context
        )
    },
    () => options.reportStartupFailure('mcp', 'unknown')
  )
  await noteNodeDemandFromMcp(dependencies.mcpSettings, toolchainService).catch((error) => {
    logger.warn('[ToolchainService] Failed to note MCP Node demand', error)
  })
  const skillSessionStatePort: SkillSessionStatePort = {
    hasNewSession: async (conversationId) => Boolean(await sessionQuery.getSession(conversationId)),
    getPersistedNewSessionSkills: (conversationId) =>
      sessionData.database.newSessionsTable.getActiveSkills(conversationId),
    setPersistedNewSessionSkills: (conversationId, skills) => {
      sessionData.database.newSessionsTable.updateActiveSkills(conversationId, skills)
      projectDatabase.newEnvironmentsTable.syncForSession(conversationId)
      projectService.notifyEnvironmentProjectionChanged()
    },
    repairImportedLegacySessionSkills: async (conversationId) => {
      return await legacyChatImportService.repairImportedLegacySessionSkills(conversationId)
    }
  }
  const skillService = new SkillService(
    skillSettings,
    skillSessionStatePort,
    fileWatcherService,
    publishDeepchatEvent,
    {
      homeDirectory: bootstrap.homeDirectory,
      tempDirectory: bootstrap.temporaryDirectory,
      userDataDirectory: bootstrap.profileDirectory,
      builtinSkillsDirectories: bootstrap.builtinSkillsDirectories,
      openSkillsDirectory: async (directory) => {
        await options.openPath(directory)
      }
    },
    {
      isDeepChatAgent: async (agentId) =>
        (await agentSettings.getAgent(agentId))?.type === 'deepchat',
      listDeepChatAgents: async () =>
        (await agentSettings.listAgents())
          .filter((agent) => agent.type === 'deepchat')
          .map((agent) => ({
            id: agent.id,
            enabledSkillNames: agent.config?.enabledSkillNames,
            protected: agent.protected
          })),
      getSessionAgentId: async (sessionId) =>
        (await sessionQuery.getSession(sessionId))?.agentId ?? null,
      getSessionProjectDir: async (sessionId) =>
        (await sessionQuery.getSession(sessionId))?.projectDir ?? null,
      listSessions: async () =>
        (await sessionQuery.listSessions({ includeSubagents: true })).map((session) => ({
          id: session.id,
          agentId: session.agentId
        }))
    }
  )
  const cliSkillService = new CliSkillService({
    skills: skillService,
    agentExists: async (agentId) => (await agentSettings.getAgent(agentId))?.type === 'deepchat',
    recordSettingsActivity: (input) => {
      void settingsDatabase.recordSettingsActivity(input).catch((error) => {
        logger.warn('[SettingsActivity] Failed to record CLI Skill activity:', error)
      })
    },
    log: logger
  })

  const resolveConversationExecutionAuthorityNow = (conversationId: string) => {
    const session = appSessionService.get(conversationId)
    if (!session) return null
    const resolveAgentConfig = (agentId: string) => {
      const config = agentRepository.resolveDeepChatAgentConfig(agentId)
      return {
        ...config,
        disabledAgentTools: Array.isArray(config.disabledAgentTools)
          ? config.disabledAgentTools
          : [...DEFAULT_DISABLED_AGENT_TOOLS]
      }
    }
    const agentType = agentRepository.getAgentType(session.agentId)
    const agentConfig = resolveAgentConfig(session.agentId)
    const persistedDisabledAgentTools = appSessionService.getDisabledAgentTools(session.id)
    let authority = composeSubagentAuthority({
      disabledAgentTools: persistedDisabledAgentTools,
      enabledMcpServerIds: agentConfig.enabledMcpServerIds
    })
    if (session.sessionKind === 'subagent') {
      const parentSessionId = session.parentSessionId?.trim()
      const parent = parentSessionId ? appSessionService.get(parentSessionId) : null
      if (!parent || parent.sessionKind !== 'regular') {
        throw new Error(`Subagent Session ${session.id} has no resolvable parent tool policy.`)
      }
      authority = composeSubagentAuthority(
        { disabledAgentTools: persistedDisabledAgentTools },
        { disabledAgentTools: appSessionService.getDisabledAgentTools(parent.id) },
        resolveAgentConfig(parent.agentId),
        agentConfig
      )
    }
    return {
      sessionId: session.id,
      agentId: session.agentId,
      projectDir: session.projectDir ?? null,
      sessionKind: session.sessionKind,
      disabledAgentTools: authority.disabledAgentTools,
      enabledMcpServerIds: authority.enabledMcpServerIds,
      subagentCapability: resolveDeepChatSubagentCapability({
        agentType,
        sessionKind: session.sessionKind,
        agentPolicyEnabled: agentConfig.subagentEnabled === true,
        slots: normalizeDeepChatSubagentSlots(agentConfig.subagents)
      })
    }
  }
  const backgroundExec = new BackgroundExecService(options.spawnBackgroundExecHost)
  const agentToolDependencies: AgentToolDependencies = {
    backgroundExec,
    readSession: (callerSessionId, input) =>
      sessionData.sessionReferences.read(callerSessionId, input),
    agentInvocationAdmission,
    sessions: {
      resolveConversationWorkdir: async (conversationId) => {
        try {
          const session = await sessionQuery.getSession(conversationId)
          const normalized = session?.projectDir?.trim()
          if (normalized) {
            return normalized
          }
        } catch (error) {
          console.warn('[Main] Failed to resolve new session workdir:', {
            conversationId,
            error
          })
        }

        return null
      },
      resolveConversationExecutionAuthorityNow,
      resolveConversationExecutionAuthority: async (conversationId) =>
        resolveConversationExecutionAuthorityNow(conversationId),
      resolveConversationSessionInfo: async (conversationId) => {
        const session = await sessionQuery.getSession(conversationId)
        if (!session) {
          return null
        }

        const agent = await agentSettings.getAgent(session.agentId)
        const agentType = await agentSettings.getAgentType(session.agentId)
        const permissionMode = await sessionAssignment.getPermissionMode(session.id)
        const generationSettings = await sessionAssignment.getSessionGenerationSettings(session.id)
        const disabledAgentTools = await sessionAssignment.getSessionDisabledAgentTools(session.id)
        const activeSkills = await skillService.getActiveSkills(session.id)
        const agentConfig = await agentSettings.resolveDeepChatAgentConfig(session.agentId)
        const availableSubagentSlots = normalizeDeepChatSubagentSlots(agentConfig.subagents)
        const subagentCapability = resolveDeepChatSubagentCapability({
          agentType,
          sessionKind: session.sessionKind,
          agentPolicyEnabled: agentConfig.subagentEnabled === true,
          slots: availableSubagentSlots
        })

        return {
          sessionId: session.id,
          agentId: session.agentId,
          agentName: agent?.name?.trim() || session.agentId,
          agentType,
          providerId: session.providerId,
          modelId: session.modelId,
          projectDir: session.projectDir ?? null,
          permissionMode,
          orchestrationPolicy: session.orchestrationPolicy,
          toolModeOverride: session.toolModeOverride ?? null,
          generationSettings,
          disabledAgentTools,
          activeSkills,
          sessionKind: session.sessionKind,
          parentSessionId: session.parentSessionId ?? null,
          subagentMeta: session.subagentMeta ?? null,
          subagentCapability,
          status: session.status
        }
      }
    },
    tape: {
      searchTape: async (conversationId, query, options) => {
        return await sessionQuery.searchTape(conversationId, query, options)
      },
      getTapeContext: async (conversationId, entryIds, options) => {
        return await sessionQuery.getTapeContext(conversationId, entryIds, options)
      }
    },
    memory: {
      isMemoryEnabled: (agentId) => memoryService.isEnabled(agentId),
      rememberMemory: async (agentId, input, sourceSession, model, beforeMutation) =>
        memoryService.rememberMemory(
          {
            kind: input.kind,
            category: input.category,
            content: input.content,
            importance: input.importance
          },
          { agentId, sourceSession },
          model,
          beforeMutation
        ),
      recallMemory: async (agentId, query, scopeContext) => {
        const items = await memoryService.recall(agentId, query, undefined, scopeContext)
        return items.map((item) => ({
          id: item.id,
          kind: item.kind,
          content: item.content
        }))
      },
      forgetMemory: async (agentId, memoryId, beforeMutation) =>
        await memoryService.forgetMemory(agentId, memoryId, beforeMutation)
    },
    cronJobs: {
      listCronJobs: async () => await cronJobs.list(),
      upsertCronJob: async (input, beforeMutation) =>
        (await cronJobs.upsert(input, beforeMutation)).job,
      deleteCronJob: async (id, beforeMutation) => {
        await cronJobs.delete(id, beforeMutation)
      },
      toggleCronJob: async (id, enabled, beforeMutation) =>
        (await cronJobs.toggle(id, enabled, beforeMutation)).job,
      runCronJobNow: async (id, beforeMutation) => (await cronJobs.runNow(id, beforeMutation)).run,
      listCronJobRuns: async (jobId, limit) => cronJobs.listRuns(jobId, limit),
      previewCronSchedule: async (input) => cronJobs.previewSchedule(input)
    },
    subagents: {
      createSubagentSession: async (input) => {
        const created = await sessionLifecycle.createSubagentSession(input)
        return await agentToolDependencies.sessions.resolveConversationSessionInfo(created.id)
      },
      linkSubagentTape: async (input) => await sessionAssignment.linkSubagentTape(input),
      sendConversationMessage: async (conversationId, content) => {
        await sessionTurn.sendMessage(conversationId, content)
      },
      cancelConversation: async (conversationId) => {
        await sessionTurn.cancelGeneration(conversationId)
      },
      subscribeSessionRuntimeUpdates: (listener) => sessionRuntimeEvents.subscribe(listener)
    },
    liveDelegation: liveDelegationService,
    skills: skillService,
    skillExecutionAuthority: new SkillExecutionAuthorityResolver({
      tape: createSkillExecutionAuthorityTapePort(sessionData.tapeStore),
      environments: skillService
    }),
    browser: options.browser,
    files: {
      getMimeType: (filePath) => fileService.getMimeType(filePath),
      prepareFileCompletely: (absPath, typeInfo, contentType) =>
        fileService.prepareFileCompletely(absPath, typeInfo, contentType)
    },
    provider: {
      executeWithRateLimit: (providerId, options) =>
        providerRuntime.executeWithRateLimit(providerId, options),
      generateCompletionStandalone: (
        providerId,
        messages,
        modelId,
        temperature,
        maxTokens,
        options
      ) =>
        providerRuntime.generateCompletionStandalone(
          providerId,
          messages,
          modelId,
          temperature,
          maxTokens,
          options
        ),
      generateImageStandalone: (providerId, prompt, modelId, imageOptions, options) =>
        providerRuntime.generateImageStandalone(providerId, prompt, modelId, imageOptions, options)
    },
    cacheImage: options.cacheImage,
    desktop: options.agentDesktop,
    permissions: {
      getApprovedFilePaths: (conversationId, requiredPermission, provisionalLeaseId) =>
        filePermissionService.getApprovedPaths(
          conversationId,
          requiredPermission,
          provisionalLeaseId
        ),
      consumeSettingsApproval: (conversationId, toolName, provisionalLeaseId) =>
        settingsPermissionService.consumeApproval(conversationId, toolName, provisionalLeaseId)
    }
  }

  // Initialize the merged MCP and built-in Tool service.
  const toolService = new ToolService({
    pluginToolPolicies: dependencies.pluginToolPolicies,
    spawnCodeModeHost: options.spawnCodeModeHost,
    mcpService: mcpService,
    providerSettings: providerSettings,
    settings: dependencies.settingsStore,
    agentSettings,
    skillSettings,
    desktopSettings: appSettingsService,
    commandPermissionHandler,
    commandEnvironment: options.commandEnvironment,
    permissionBroker: toolPermissionBroker,
    liveDelegationConsent,
    agentTools: agentToolDependencies,
    effectObserver: {
      beforeToolAuthorization: async (observation, signal) => {
        const permissionMode = await liveDelegationService.beforeToolAuthorization(
          observation,
          signal
        )
        return permissionMode ? { permissionMode } : null
      },
      beforeToolExecution: async (observation, signal) => {
        await liveDelegationService.beforeToolExecution(observation, signal)
      }
    }
  })

  // Plugin activation is a shared startup barrier for Skill migration and MCP startup.
  const pluginService = new PluginService({
    workingDirectory: bootstrap.workingDirectory,
    profileDirectory: bootstrap.profileDirectory,
    homeDirectory: bootstrap.homeDirectory,
    appPath: bootstrap.appPath,
    appVersion: bootstrap.appVersion,
    isPackaged: bootstrap.isPackaged,
    resourcesPath: bootstrap.resourcesPath,
    openExternal: (url) => options.openExternal(url),
    openPath: (filePath) => options.openPath(filePath),
    hookEnvironment: () =>
      toolchainService.prependResolvedToEnv(
        createMinimalProcessEnvironment(process.env, process.platform)
      ),
    toolPolicies: dependencies.pluginToolPolicies,
    nowledgeMem: nowledgeMemConnections,
    exportNowledgeSession: (input) =>
      coreExecution.agentSessionExportService.submitToNowledgeMem(input),
    contextTape: sessionData.tapeStore,
    mcpSettings: dependencies.mcpSettings,
    mcpService: mcpService,
    skillService: skillService,
    settingsWindow: options.pluginSettingsWindow,
    runtimeSupervisor: pluginRuntimeSupervisor
  })

  // Initialize Skill Sync service
  const skillSyncService = new SkillSyncService(skillService, skillSettings, publishDeepchatEvent)

  const hookService = new HookService(
    hookSettings,
    { getSession: (sessionId) => sessionQuery.getSession(sessionId) },
    bootstrap.appVersion
  )
  const providerCatalogPort: ProviderCatalogPort = {
    getProviderModels: (providerId) => providerSettings.getProviderModels(providerId),
    getCustomModels: (providerId) => providerSettings.getCustomModels(providerId),
    getAgentType: async (agentId) => await agentSettings.getAgentType(agentId)
  }
  const sessionPermissionPort = createSessionPermissionPort({
    agentCliTokenAuthority,
    commandPermissionService,
    filePermissionService,
    settingsPermissionService,
    toolPermissionBroker
  })
  const memoryService = new MemoryService({
    repository: createLivePort(() => memoryDatabase.agentMemoryTable),
    directiveRepository: createLivePort(() => memoryDatabase.agentMemoryDirectiveTable),
    auditRepository: createLivePort(() => memoryDatabase.agentMemoryAuditTable),
    resolveAgentConfig: (agentId) => agentRepository.resolveDeepChatAgentConfig(agentId),
    resolveAgentDefaultModel: (agentId) => {
      const config = agentRepository.resolveDeepChatAgentConfig(agentId)
      const model = config.assistantModel ?? config.defaultModelPreset
      return model?.providerId && model?.modelId
        ? { providerId: model.providerId, modelId: model.modelId }
        : null
    },
    // Management memory APIs only read/write real DeepChat agents.
    isManagedAgent: (agentId) => agentRepository.getDeepChatAgentConfig(agentId) !== null,
    listManagedAgentConfigs: () => agentRepository.listResolvedDeepChatAgentConfigs(),
    listManagedMemoryAgentIds: () =>
      agentRepository
        .listAgents({ agentType: 'deepchat', enabled: true })
        .map((agent) => agent.id)
        .filter(
          (agentId) => agentRepository.resolveDeepChatAgentConfig(agentId).memoryEnabled === true
        ),
    ...createMemoryProviderBindings(providerRuntime),
    createVectorStore: (agentId, embedding, dimensions) =>
      memoryVectorStores.createVectorStore(agentId, embedding, dimensions),
    resetVectorStore: (agentId) => memoryVectorStores.resetVectorStore(agentId),
    markVectorStoreQuarantined: (agentId) => memoryVectorStores.markVectorStoreQuarantined(agentId),
    onMemoryChanged: (agentId, reason, context) =>
      publishDeepchatEvent('memory.updated', {
        agentId,
        reason,
        version: Date.now(),
        ...(typeof context?.memoryId === 'string' ? { memoryId: context.memoryId } : {}),
        ...(typeof context?.directiveId === 'string' ? { directiveId: context.directiveId } : {}),
        ...(typeof context?.sessionId === 'string' ? { sessionId: context.sessionId } : {}),
        ...(context?.createdIds?.length ? { createdIds: context.createdIds } : {})
      })
  })

  coreExecution = createCoreExecution({
    harness: {
      providerRuntime,
      providerSettings,
      agentSettings,
      database: sessionData.database,
      sessionData,
      toolService,
      hookObserver: hookService,
      pluginContext: pluginService.contextHooks,
      onSessionCompleted: options.onSessionCompleted,
      publishEvent: publishDeepchatEvent,
      publishSessionUpdate: (update) => {
        sessionRuntimeEvents.publish(update)
        if (update.kind === 'status') {
          if (update.status === 'generating') syncActiveSessions.add(update.sessionId)
          else {
            syncActiveSessions.delete(update.sessionId)
            syncReplica?.wake()
          }
        }
        if (update.kind === 'status' && (update.status === 'idle' || update.status === 'error')) {
          options.onSessionInactive(update.sessionId)
        }
      },
      providerCatalogPort,
      sessionPermissionPort,
      acpAsLlmProviderPermission: acpAsLlmProviderPermission,
      sessionUiPort,
      memoryPort: memoryService,
      getMemoryIngestionProjection: () => memoryDatabase.ingestionProjectionTable,
      cacheImage: options.cacheImage,
      runJournalObserver: options.runJournalObserver,
      skillService: skillService,
      skillSettings,
      traceSettings,
      commandShell: commandShellService,
      promptSettings,
      attachmentRouter,
      toolSurfaceRunMode: toolSurfaceRollout,
      agentCliTokenAuthority,
      programmaticToolParents
    },
    agentRepository,
    appSessionService,
    acpRuntimeOwner,
    acpSessionPersistence,
    acpAsLlmProviderSessionControl,
    agentLifecycle,
    sessionDeletionGate,
    projectDatabase,
    projectService,
    agentToolDependencies,
    agentInvocationAdmission,
    liveDelegationRepository,
    liveDelegationConsent,
    nowledgeMemConnections,
    databaseRequests,
    ...options.execution
  })
  deepChatAgentHarness = coreExecution.deepChatAgentHarness
  sessionQuery = coreExecution.sessionQuery
  sessionAssignment = coreExecution.sessionAssignment
  sessionTurn = coreExecution.sessionTurn
  sessionLifecycle = coreExecution.sessionLifecycle
  acpAgentRuntime = coreExecution.acpAgentRuntime
  const remoteService = new RemoteService({
    profileDirectory: bootstrap.profileDirectory,
    authWindows: options.remoteAuthWindows,
    settings: dependencies.settingsStore,
    catalog: {
      getAgentType: (agentId) => agentSettings.getAgentType(agentId),
      listAgents: async () =>
        (await agentSettings.listAgents())
          .filter((agent) => agent.enabled !== false)
          .map((agent) => ({
            agentId: agent.id,
            agentName: agent.name || agent.id,
            agentType: agent.type,
            source: agent.source
          })),
      listModelProviders: async () => {
        const enabledProviders = providerSettings.getEnabledProviders()
        const enabledModelGroups = await providerSettings.getAllEnabledModels()
        const providerNameById = new Map(
          enabledProviders.map((provider) => [provider.id, provider.name])
        )
        return enabledModelGroups
          .filter((group) => providerNameById.has(group.providerId) && group.models.length > 0)
          .map((group) => ({
            providerId: group.providerId,
            providerName: providerNameById.get(group.providerId) ?? group.providerId,
            models: group.models.map((model) => ({
              modelId: model.id,
              modelName: model.name || model.id
            }))
          }))
      }
    },
    workspace: {
      getDefaultProjectPath: async () => projectService.getDefaultProjectPath(),
      prepareFile: (filePath, type) => fileService.prepareFile(filePath, type)
    },
    lifecycle: sessionLifecycle,
    turn: {
      sendMessage: (...args) => sessionTurn.sendMessage(...args),
      respondToolInteraction: (...args) => sessionTurn.respondToolInteraction(...args),
      cancelGeneration: (sessionId) => sessionTurn.cancelGeneration(sessionId)
    },
    assignment: sessionAssignment,
    projection: sessionQuery,
    desktop: {
      openSession: options.openRemoteSession
    },
    notifications: {
      showNotification: options.showNotification
    }
  })
  const cronJobs = new SchedulerService({
    createSchedulerManager: (deps) =>
      new SchedulerProcessManager({ ...deps, spawnHost: options.spawnSchedulerHost }),
    database: schedulerDatabase,
    agentSettings,
    sessionEvents: sessionRuntimeEvents,
    runSessionStarter: createCronJobRunSessionStarter({
      lifecycle: sessionLifecycle,
      turn: sessionTurn,
      agentCatalog: agentSettings
    }),
    remoteDeliveryPort: remoteService
  })
  async function initializeSkills(): Promise<void> {
    if (!skillSettings.isEnabled()) {
      logger.info('SkillService disabled by config')
      return
    }
    await ensureSkillServicesInitialized()
  }

  async function ensureSkillServicesInitialized(): Promise<void> {
    if (options.isStopping()) {
      throw new Error('Cannot initialize Skill services while app is stopping')
    }
    if (!skillInitializationPromise) {
      const initialization = (async () => {
        await initializePlugins()
        await skillService.initialize()
        logger.info('SkillService initialized')
        await skillSyncService.initialize()
      })()
      skillInitializationPromise = initialization
      void initialization.catch(() => {
        if (skillInitializationPromise === initialization) {
          skillInitializationPromise = null
        }
      })
    }
    await skillInitializationPromise
  }

  async function initializePlugins(): Promise<void> {
    if (!pluginInitializationPromise) {
      const initialization = pluginService.initialize()
      pluginInitializationPromise = initialization
      void initialization.catch(() => {
        if (pluginInitializationPromise === initialization) {
          pluginInitializationPromise = null
        }
      })
    }
    try {
      await pluginInitializationPromise
    } catch (error) {
      options.reportStartupFailure('plugin_host', 'unknown')
      console.error('[PluginHost] Failed to initialize plugins:', error)
    }
  }

  async function initializeSkillSyncScan(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted || options.isStopping()) {
      return
    }
    if (!skillSyncScanPromise) {
      const scan = (async () => {
        try {
          if (!skillSettings.isEnabled() || signal?.aborted) return
          await ensureSkillServicesInitialized()
          if (signal?.aborted) return
          await skillSyncService.scanAndDetectNewDiscoveries()
          logger.info('SkillSyncService background scan completed')
        } catch (error) {
          options.reportStartupFailure('skill_sync', 'unknown')
          console.error('Failed to run SkillSyncService background scan:', error)
        }
      })()
      skillSyncScanPromise = scan
      void scan.finally(() => {
        if (skillSyncScanPromise === scan) {
          skillSyncScanPromise = null
        }
      })
    }
    await skillSyncScanPromise
  }

  async function initializeMcp() {
    await initializePlugins()

    try {
      await options.whenProxyReady()
      await mcpService.initialize()
    } catch (error) {
      options.reportStartupFailure('mcp', 'unknown')
      console.error('Failed to initialize McpService:', error)
      return
    }
    try {
      await pluginRuntimeSupervisor.reconcileAll()
    } catch (error) {
      options.reportStartupFailure('plugin_runtime', 'unknown')
      console.error('[PluginHost] Failed to reconcile eager plugin runtimes:', error)
    }

    try {
      deepChatAgentHarness.refreshToolRegistry()
      options.mcpReadinessChanged(!options.isStopping() && databaseRequests.state === 'running')
    } catch (error) {
      options.reportStartupFailure('mcp_integration', 'unknown')
      console.error('Failed to finish MCP startup integration:', error)
    }
  }

  async function initializeRemoteControl() {
    try {
      await remoteService.initialize()
    } catch (error) {
      options.reportStartupFailure('remote_runtime', 'unknown')
      console.error('RemoteService.initialize failed:', error)
    }
  }

  async function drainInitialization(
    runDestroyStep: (name: string, step: () => Promise<void>) => Promise<void>
  ): Promise<void> {
    const pendingSkillInitialization = skillInitializationPromise
    if (pendingSkillInitialization) {
      await runDestroyStep('skillInitialization.drain', async () => {
        await pendingSkillInitialization
      })
    }
    const pendingPluginInitialization = pluginInitializationPromise
    if (pendingPluginInitialization) {
      await runDestroyStep('pluginInitialization.drain', async () => {
        await pendingPluginInitialization
      })
    }
    const pendingSkillSyncScan = skillSyncScanPromise
    if (pendingSkillSyncScan) {
      await runDestroyStep('skillSyncScan.drain', async () => {
        await pendingSkillSyncScan
      })
    }
  }
  return {
    execution: coreExecution,
    projectService,
    exporter,
    fileService,
    syncSettings,
    syncService,
    syncPeerService,
    syncReplica,
    automaticSync,
    syncHostService,
    replicaEndpoint,
    knowledgeSettings,
    knowledgeService,
    mcpService,
    skillService,
    skillSyncService,
    cliSkillService,
    toolService,
    pluginService,
    hookService,
    memoryService,
    remoteService,
    cronJobs,
    backgroundExec,
    sessionPermissionPort,
    initializeSkills,
    ensureSkillServicesInitialized,
    initializeSkillSyncScan,
    initializeMcp,
    initializeRemoteControl,
    drainInitialization
  }
}
