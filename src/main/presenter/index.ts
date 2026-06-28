import logger from '@shared/logger'
import path from 'path'
import { DialogPresenter } from './dialogPresenter/index'
import { ipcMain, app } from 'electron'
import { WindowPresenter } from './windowPresenter'
import { ShortcutPresenter } from './shortcutPresenter'
import {
  IConfigPresenter,
  IDeeplinkPresenter,
  IDevicePresenter,
  IDialogPresenter,
  IFilePresenter,
  IKnowledgePresenter,
  ILifecycleManager,
  ILlmProviderPresenter,
  IMCPPresenter,
  INotificationPresenter,
  IPresenter,
  IShortcutPresenter,
  ISQLitePresenter,
  ISyncPresenter,
  ITabPresenter,
  IConversationExporter,
  IUpgradePresenter,
  IWindowPresenter,
  IWorkspacePresenter,
  IToolPresenter,
  IYoBrowserPresenter,
  ISkillPresenter,
  ISkillSyncPresenter,
  IAgentSessionPresenter,
  IProjectPresenter,
  IRemoteControlPresenter
} from '@shared/presenter'
import { eventBus } from '@/eventbus'
import { LLMProviderPresenter } from './llmProviderPresenter'
import { SessionPresenter } from './sessionPresenter'
import { MessageManager } from './sessionPresenter/managers/messageManager'
import { DevicePresenter } from './devicePresenter'
import { UpgradePresenter } from './upgradePresenter'
import { FilePresenter } from './filePresenter/FilePresenter'
import { McpPresenter } from './mcpPresenter'
import { SyncPresenter } from './syncPresenter'
import { DeeplinkPresenter } from './deeplinkPresenter'
import { NotificationPresenter } from './notificationPresenter'
import { TabPresenter } from './tabPresenter'
import { TrayPresenter } from './trayPresenter'
import { OAuthPresenter } from './oauthPresenter'
import { FloatingButtonPresenter } from './floatingButtonPresenter'
import { YoBrowserPresenter } from './browser/YoBrowserPresenter'
import { CONFIG_EVENTS } from '@/events'
import { KnowledgePresenter } from './knowledgePresenter'
import { WorkspacePresenter } from './workspacePresenter'
import { ToolPresenter } from './toolPresenter'
import {
  CommandPermissionService,
  FilePermissionService,
  SettingsPermissionService
} from './permission'
import type { AgentToolRuntimePort } from './toolPresenter/runtimePorts'

import { ConversationExporterService } from './exporter'
import { SkillPresenter } from './skillPresenter'
import type { SkillSessionStatePort } from './skillPresenter'
import { SkillSyncPresenter } from './skillSyncPresenter'
import { HooksNotificationsService } from './hooksNotifications'
import { NewSessionHooksBridge } from './hooksNotifications/newSessionBridge'
import { ScheduledTasksService } from './scheduledTasks'
import { AgentSessionPresenter } from './agentSessionPresenter'
import { AgentRuntimePresenter } from './agentRuntimePresenter'
import { MemoryPresenter, isSafeAgentId } from './memoryPresenter'
import { MemoryVectorStore } from './memoryPresenter/memoryVectorStore'
import { ProjectPresenter } from './projectPresenter'
import { RemoteControlPresenter } from './remoteControlPresenter'
import type { RemoteControlPresenterLike } from './remoteControlPresenter/interface'
import { PluginPresenter } from './pluginPresenter'
import { AgentRepository, BUILTIN_DEEPCHAT_AGENT_ID } from './agentRepository'
import type { SQLitePresenter } from './sqlitePresenter'
import { DatabaseSecurityPresenter } from './databaseSecurityPresenter'
import { normalizeDeepChatSubagentSlots } from '@shared/lib/deepchatSubagents'
import { subscribeDeepChatInternalSessionUpdates } from './agentRuntimePresenter/internalSessionEvents'
import type {
  ProviderCatalogPort,
  ProviderSessionPort,
  SessionPermissionPort,
  SessionUiPort
} from './runtimePorts'
import { createMainKernelRouteRuntime, registerMainKernelRoutes } from '@/routes'
import {
  publishDeepchatEvent,
  setDeepchatEventWindowPresenter
} from '@/routes/publishDeepchatEvent'
import { StartupWorkloadCoordinator } from './startupWorkloadCoordinator'
import type { StartupWorkloadTaskContext } from './startupWorkloadCoordinator'

type MemoryMaintenanceConfigChangeTarget = Pick<
  MemoryPresenter,
  'onAgentMemoryMaintenanceConfigChanged' | 'onBuiltinDeepChatMemoryMaintenanceConfigChanged'
>

export const routeDeepChatAgentMemoryMaintenanceConfigChanged = (
  memoryPresenter: MemoryMaintenanceConfigChangeTarget,
  agentId: string
): void => {
  if (agentId === BUILTIN_DEEPCHAT_AGENT_ID) {
    memoryPresenter.onBuiltinDeepChatMemoryMaintenanceConfigChanged()
  } else {
    memoryPresenter.onAgentMemoryMaintenanceConfigChanged(agentId)
  }
}

// Coordinates presenters and owns main-process IPC wiring.
export class Presenter implements IPresenter {
  private static instance: Presenter

  windowPresenter: IWindowPresenter
  sqlitePresenter: ISQLitePresenter
  llmproviderPresenter: ILlmProviderPresenter
  configPresenter: IConfigPresenter

  exporter: IConversationExporter
  devicePresenter: IDevicePresenter
  upgradePresenter: IUpgradePresenter
  shortcutPresenter: IShortcutPresenter
  filePresenter: IFilePresenter
  mcpPresenter: IMCPPresenter
  syncPresenter: ISyncPresenter
  deeplinkPresenter: IDeeplinkPresenter
  notificationPresenter: INotificationPresenter
  tabPresenter: ITabPresenter
  trayPresenter: TrayPresenter
  oauthPresenter: OAuthPresenter
  floatingButtonPresenter: FloatingButtonPresenter
  knowledgePresenter: IKnowledgePresenter
  workspacePresenter: IWorkspacePresenter
  toolPresenter: IToolPresenter
  yoBrowserPresenter: IYoBrowserPresenter
  dialogPresenter: IDialogPresenter
  lifecycleManager: ILifecycleManager
  skillPresenter: ISkillPresenter
  skillSyncPresenter: ISkillSyncPresenter
  agentSessionPresenter: IAgentSessionPresenter
  memoryPresenter: MemoryPresenter
  projectPresenter: IProjectPresenter
  remoteControlPresenter: IRemoteControlPresenter
  pluginPresenter: PluginPresenter
  databaseSecurityPresenter: DatabaseSecurityPresenter
  hooksNotifications: HooksNotificationsService
  scheduledTasks: ScheduledTasksService
  commandPermissionService: CommandPermissionService
  filePermissionService: FilePermissionService
  settingsPermissionService: SettingsPermissionService
  startupWorkloadCoordinator: StartupWorkloadCoordinator
  private sessionMessageManager: MessageManager
  private sessionPresenterInternal?: SessionPresenter
  private hasInitialized = false
  #remoteControlPresenter: RemoteControlPresenterLike

  private constructor(lifecycleManager: ILifecycleManager) {
    // Store lifecycle manager reference for component access
    // If the initialization is successful, there should be no null here
    this.lifecycleManager = lifecycleManager
    const context = lifecycleManager.getLifecycleContext()
    this.configPresenter = context.config as IConfigPresenter
    this.sqlitePresenter = context.database as ISQLitePresenter
    this.databaseSecurityPresenter =
      (context.databaseSecurity as DatabaseSecurityPresenter | undefined) ??
      new DatabaseSecurityPresenter()
    const agentRepository = new AgentRepository(this.sqlitePresenter as unknown as SQLitePresenter)
    ;(
      this.configPresenter as IConfigPresenter & {
        setAgentRepository?: (repository: AgentRepository) => void
      }
    ).setAgentRepository?.(agentRepository)
    ;(
      this.configPresenter as IConfigPresenter & {
        setSQLitePresenter?: (sqlitePresenter: SQLitePresenter) => void
      }
    ).setSQLitePresenter?.(this.sqlitePresenter as unknown as SQLitePresenter)
    this.startupWorkloadCoordinator = new StartupWorkloadCoordinator()

    // Initialize presenters and their dependencies.
    this.windowPresenter = new WindowPresenter(
      this.configPresenter,
      this.startupWorkloadCoordinator
    )
    this.tabPresenter = new TabPresenter(this.windowPresenter)
    this.llmproviderPresenter = new LLMProviderPresenter(
      this.configPresenter,
      this.sqlitePresenter,
      {
        getNpmRegistry: () => this.mcpPresenter.getNpmRegistry?.() ?? null,
        getUvRegistry: () => this.mcpPresenter.getUvRegistry?.() ?? null
      }
    )
    const commandPermissionHandler = new CommandPermissionService()
    this.commandPermissionService = commandPermissionHandler
    this.filePermissionService = new FilePermissionService()
    this.settingsPermissionService = new SettingsPermissionService()
    const messageManager = new MessageManager(this.sqlitePresenter)
    this.sessionMessageManager = messageManager
    const devicePresenter = new DevicePresenter()
    this.devicePresenter = devicePresenter
    this.exporter = new ConversationExporterService({
      sqlitePresenter: this.sqlitePresenter,
      configPresenter: this.configPresenter
    })
    this.mcpPresenter = new McpPresenter(this.configPresenter, (data) =>
      this.devicePresenter.cacheImage(data)
    )
    this.upgradePresenter = new UpgradePresenter(this.configPresenter)
    this.shortcutPresenter = new ShortcutPresenter(this.configPresenter)
    this.filePresenter = new FilePresenter(this.configPresenter)
    this.syncPresenter = new SyncPresenter(this.configPresenter, this.sqlitePresenter)
    this.deeplinkPresenter = new DeeplinkPresenter()
    this.notificationPresenter = new NotificationPresenter()
    this.oauthPresenter = new OAuthPresenter()
    this.trayPresenter = new TrayPresenter()
    this.floatingButtonPresenter = new FloatingButtonPresenter(this.configPresenter)
    this.dialogPresenter = new DialogPresenter()
    this.yoBrowserPresenter = new YoBrowserPresenter(this.windowPresenter)

    // Define dbDir for knowledge presenter
    const dbDir = path.join(app.getPath('userData'), 'app_db')
    this.knowledgePresenter = new KnowledgePresenter(
      this.configPresenter,
      dbDir,
      this.filePresenter
    )
    devicePresenter.setResetRuntime({
      closeSqlite: () => this.sqlitePresenter.close(),
      destroyKnowledge: () => this.knowledgePresenter.destroy()
    })

    // Initialize generic Workspace presenter (for all Agent modes)
    this.workspacePresenter = new WorkspacePresenter(this.filePresenter)

    const agentToolRuntime: AgentToolRuntimePort = {
      resolveConversationWorkdir: async (conversationId) => {
        try {
          const session = await this.agentSessionPresenter?.getSession(conversationId)
          const normalized = session?.projectDir?.trim()
          if (normalized) {
            return normalized
          }
        } catch (error) {
          console.warn('[Presenter] Failed to resolve new session workdir:', {
            conversationId,
            error
          })
        }

        return null
      },
      resolveConversationSessionInfo: async (conversationId) => {
        const session = await this.agentSessionPresenter?.getSession(conversationId)
        if (!session) {
          return null
        }

        const agent = await this.configPresenter.getAgent(session.agentId)
        const agentType = await this.configPresenter.getAgentType(session.agentId)
        const permissionMode =
          typeof this.agentSessionPresenter?.getPermissionMode === 'function'
            ? await this.agentSessionPresenter.getPermissionMode(session.id)
            : 'full_access'
        const generationSettings =
          typeof this.agentSessionPresenter?.getSessionGenerationSettings === 'function'
            ? await this.agentSessionPresenter.getSessionGenerationSettings(session.id)
            : null
        const disabledAgentTools =
          typeof this.agentSessionPresenter?.getSessionDisabledAgentTools === 'function'
            ? await this.agentSessionPresenter.getSessionDisabledAgentTools(session.id)
            : []
        const activeSkills = await this.skillPresenter.getActiveSkills(session.id)
        const availableSubagentSlots =
          agentType === 'deepchat' && session.sessionKind === 'regular'
            ? normalizeDeepChatSubagentSlots(
                (await this.configPresenter.resolveDeepChatAgentConfig(session.agentId)).subagents
              )
            : []

        return {
          sessionId: session.id,
          agentId: session.agentId,
          agentName: agent?.name?.trim() || session.agentId,
          agentType,
          providerId: session.providerId,
          modelId: session.modelId,
          projectDir: session.projectDir ?? null,
          permissionMode,
          generationSettings,
          disabledAgentTools,
          activeSkills,
          sessionKind: session.sessionKind,
          parentSessionId: session.parentSessionId ?? null,
          subagentEnabled: session.subagentEnabled,
          subagentMeta: session.subagentMeta ?? null,
          availableSubagentSlots
        }
      },
      getTapeInfo: async (conversationId) => {
        return await this.agentSessionPresenter.getTapeInfo(conversationId)
      },
      searchTape: async (conversationId, query, options) => {
        return await this.agentSessionPresenter.searchTape(conversationId, query, options)
      },
      getTapeContext: async (conversationId, entryIds, options) => {
        return await this.agentSessionPresenter.getTapeContext(conversationId, entryIds, options)
      },
      listTapeAnchors: async (conversationId, options) => {
        return await this.agentSessionPresenter.listTapeAnchors(conversationId, options)
      },
      handoffTape: async (conversationId, name, state) => {
        return await this.agentSessionPresenter.handoffTape(conversationId, name, state)
      },
      isMemoryEnabled: (agentId) => this.memoryPresenter.isEnabled(agentId),
      rememberMemory: async (agentId, input, sourceSession, model) =>
        this.memoryPresenter.rememberMemory(
          {
            kind: input.kind,
            category: input.category,
            content: input.content,
            importance: input.importance
          },
          { agentId, sourceSession },
          model
        ),
      recallMemory: async (agentId, query) => {
        const items = await this.memoryPresenter.recall(agentId, query)
        return items.map((item) => ({
          id: item.id,
          kind: item.kind,
          content: item.content
        }))
      },
      forgetMemory: async (agentId, memoryId) =>
        await this.memoryPresenter.forgetMemory(agentId, memoryId),
      createSubagentSession: async (input) => {
        const agentSessionPresenter = this.agentSessionPresenter as IAgentSessionPresenter & {
          createSubagentSession?: (createInput: typeof input) => Promise<{
            id: string
          } | null>
        }
        const created = await agentSessionPresenter.createSubagentSession?.(input)
        if (!created?.id) {
          return null
        }

        return await agentToolRuntime.resolveConversationSessionInfo(created.id)
      },
      mergeSubagentTape: async (parentSessionId, childSessionId, meta) => {
        await this.agentSessionPresenter.mergeSubagentTape(parentSessionId, childSessionId, meta)
      },
      discardSubagentTape: async (parentSessionId, childSessionId, meta) => {
        await this.agentSessionPresenter.discardSubagentTape(parentSessionId, childSessionId, meta)
      },
      sendConversationMessage: async (conversationId, content) => {
        await this.agentSessionPresenter.sendMessage(conversationId, content)
      },
      cancelConversation: async (conversationId) => {
        await this.agentSessionPresenter.cancelGeneration(conversationId)
      },
      subscribeDeepChatSessionUpdates: (listener) =>
        subscribeDeepChatInternalSessionUpdates(listener),
      getSkillPresenter: () => this.skillPresenter,
      getYoBrowserToolHandler: () => this.yoBrowserPresenter.toolHandler,
      getFilePresenter: () => ({
        getMimeType: (filePath) => this.filePresenter.getMimeType(filePath),
        prepareFileCompletely: (absPath, typeInfo, contentType) =>
          this.filePresenter.prepareFileCompletely(absPath, typeInfo, contentType)
      }),
      getLlmProviderPresenter: () => ({
        executeWithRateLimit: (providerId, options) =>
          this.llmproviderPresenter.executeWithRateLimit(providerId, options),
        generateCompletionStandalone: (
          providerId,
          messages,
          modelId,
          temperature,
          maxTokens,
          options
        ) =>
          this.llmproviderPresenter.generateCompletionStandalone(
            providerId,
            messages,
            modelId,
            temperature,
            maxTokens,
            options
          ),
        generateImageStandalone: (providerId, prompt, modelId, imageOptions, options) =>
          this.llmproviderPresenter.generateImageStandalone(
            providerId,
            prompt,
            modelId,
            imageOptions,
            options
          ),
        generateVideoStandalone: (providerId, prompt, modelId, videoOptions, options) =>
          this.llmproviderPresenter.generateVideoStandalone(
            providerId,
            prompt,
            modelId,
            videoOptions,
            options
          )
      }),
      cacheImage: (data) => this.devicePresenter.cacheImage(data),
      createSettingsWindow: () => this.windowPresenter.createSettingsWindow(),
      sendToWindow: (windowId, channel, ...args) =>
        this.windowPresenter.sendToWindow(windowId, channel, ...args),
      sendSettingsNavigation: (windowId, navigation) =>
        this.windowPresenter.sendSettingsNavigation(windowId, navigation),
      getApprovedFilePaths: (conversationId, requiredPermission) =>
        this.filePermissionService.getApprovedPaths(conversationId, requiredPermission),
      consumeSettingsApproval: (conversationId, toolName) =>
        this.settingsPermissionService.consumeApproval(conversationId, toolName)
    }

    // Initialize unified Tool presenter (for routing MCP and Agent tools)
    this.toolPresenter = new ToolPresenter({
      mcpPresenter: this.mcpPresenter,
      configPresenter: this.configPresenter,
      commandPermissionHandler,
      agentToolRuntime
    })

    const skillSessionStatePort: SkillSessionStatePort = {
      hasNewSession: async (conversationId) => {
        try {
          return Boolean(await this.agentSessionPresenter?.getSession(conversationId))
        } catch {
          return false
        }
      },
      getPersistedNewSessionSkills: (conversationId) =>
        (
          this.sqlitePresenter as unknown as import('./sqlitePresenter').SQLitePresenter
        ).newSessionsTable?.getActiveSkills(conversationId) ?? [],
      setPersistedNewSessionSkills: (conversationId, skills) => {
        const sqlitePresenter = this
          .sqlitePresenter as unknown as import('./sqlitePresenter').SQLitePresenter
        sqlitePresenter.newSessionsTable?.updateActiveSkills(conversationId, skills)
        sqlitePresenter.newEnvironmentsTable?.syncForSession(conversationId)
      },
      repairImportedLegacySessionSkills: async (conversationId) => {
        const agentSessionPresenter = this.agentSessionPresenter as IAgentSessionPresenter & {
          repairImportedLegacySessionSkills?: (sessionId: string) => Promise<string[]>
        }
        return (
          (await agentSessionPresenter.repairImportedLegacySessionSkills?.(conversationId)) ?? []
        )
      }
    }

    // Initialize Skill presenter
    this.skillPresenter = new SkillPresenter(this.configPresenter, skillSessionStatePort)

    // Initialize official plugin host. Plugins are activated before MCP startup so managed
    // MCP servers are present when the regular MCP presenter starts enabled servers.
    this.pluginPresenter = new PluginPresenter({
      configPresenter: this.configPresenter,
      mcpPresenter: this.mcpPresenter,
      skillPresenter: this.skillPresenter
    })

    // Initialize Skill Sync presenter
    this.skillSyncPresenter = new SkillSyncPresenter(this.skillPresenter, this.configPresenter)

    // Initialize new agent architecture presenters first (needed by hooksNotifications)
    this.hooksNotifications = new HooksNotificationsService(this.configPresenter, {
      getSession: async () => null,
      getMessage: async () => null
    })
    this.scheduledTasks = new ScheduledTasksService({
      configPresenter: this.configPresenter,
      notificationPresenter: this.notificationPresenter,
      windowPresenter: this.windowPresenter
    })
    const newSessionHooksBridge = new NewSessionHooksBridge(this.hooksNotifications)
    const providerCatalogPort: ProviderCatalogPort = {
      getProviderModels: (providerId) => this.configPresenter.getProviderModels?.(providerId) ?? [],
      getCustomModels: (providerId) => this.configPresenter.getCustomModels?.(providerId) ?? [],
      getAgentType: async (agentId) => await this.configPresenter.getAgentType(agentId)
    }
    const sessionUiPort: SessionUiPort = {
      refreshSessionUi: () => {
        try {
          void this.floatingButtonPresenter.refreshWidgetState()
        } catch (error) {
          console.warn('[Presenter] Failed to refresh floating widget state:', error)
        }
      }
    }
    const sessionPermissionPort: SessionPermissionPort = {
      clearSessionPermissions: (sessionId) => {
        this.commandPermissionService.clearConversation(sessionId)
        this.filePermissionService.clearConversation(sessionId)
        this.settingsPermissionService.clearConversation(sessionId)
      },
      approvePermission: async (sessionId, permission) => {
        const permissionType = permission.permissionType
        const serverName = permission.serverName || ''
        const toolName = permission.toolName || ''

        if (permissionType === 'command') {
          const command = permission.command || permission.commandInfo?.command || ''
          const signature =
            permission.commandSignature ||
            permission.commandInfo?.signature ||
            (command ? this.commandPermissionService.extractCommandSignature(command) : '')
          if (signature) {
            this.commandPermissionService.approve(sessionId, signature, false)
          }
          return
        }

        if (
          serverName === 'agent-filesystem' &&
          Array.isArray(permission.paths) &&
          permission.paths.length > 0
        ) {
          this.filePermissionService.approve(sessionId, permission.paths, permissionType, false)
          return
        }

        if (serverName === 'deepchat-settings' && toolName) {
          this.settingsPermissionService.approve(sessionId, toolName, false)
          return
        }

        if (
          serverName &&
          (permissionType === 'read' || permissionType === 'write' || permissionType === 'all')
        ) {
          await this.mcpPresenter.grantPermission(serverName, permissionType, false, sessionId)
        }
      }
    }
    const providerSessionPort: ProviderSessionPort = {
      setAcpWorkdir: async (conversationId, agentId, workdir) =>
        await this.llmproviderPresenter.setAcpWorkdir(conversationId, agentId, workdir),
      prepareAcpSession: async (conversationId, agentId, workdir) =>
        await this.llmproviderPresenter.prepareAcpSession(conversationId, agentId, workdir),
      getAcpSessionConfigOptions: async (conversationId) =>
        await this.llmproviderPresenter.getAcpSessionConfigOptions(conversationId),
      setAcpSessionConfigOption: async (conversationId, configId, value) =>
        await this.llmproviderPresenter.setAcpSessionConfigOption(conversationId, configId, value),
      getAcpSessionCommands: async (conversationId) =>
        await this.llmproviderPresenter.getAcpSessionCommands(conversationId),
      clearAcpSession: async (conversationId) =>
        await this.llmproviderPresenter.clearAcpSession(conversationId)
    }

    // Initialize agent memory layer (opt-in per agent; vectors stored separately from knowledge base)
    const memoryDbDir = path.join(dbDir, 'AgentMemory')
    const memoryVectorDbPath = (agentId: string) => path.join(memoryDbDir, `${agentId}.duckdb`)
    this.memoryPresenter = new MemoryPresenter({
      repository: (this.sqlitePresenter as unknown as import('./sqlitePresenter').SQLitePresenter)
        .agentMemoryTable,
      auditRepository: (
        this.sqlitePresenter as unknown as import('./sqlitePresenter').SQLitePresenter
      ).agentMemoryAuditTable,
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
      getEmbeddings: (providerId, modelId, texts) =>
        this.llmproviderPresenter.getEmbeddings(providerId, modelId, texts),
      getDimensions: (providerId, modelId) =>
        this.llmproviderPresenter.getDimensions(providerId, modelId),
      generateText: async (providerId, modelId, prompt) =>
        (await this.llmproviderPresenter.generateText(providerId, prompt, modelId, 0.2)).content ??
        '',
      createVectorStore: (agentId, embedding, dimensions) => {
        if (!isSafeAgentId(agentId)) {
          throw new Error(`[Memory] refusing to open vector store for unsafe agentId: ${agentId}`)
        }
        return MemoryVectorStore.create(memoryVectorDbPath(agentId), dimensions, embedding)
      },
      resetVectorStore: async (agentId) => {
        if (!isSafeAgentId(agentId)) {
          throw new Error(`[Memory] refusing to reset vector store for unsafe agentId: ${agentId}`)
        }
        MemoryVectorStore.destroyFile(memoryVectorDbPath(agentId))
      },
      onMemoryChanged: (agentId, reason) =>
        publishDeepchatEvent('memory.updated', {
          agentId,
          reason,
          version: Date.now()
        })
    })
    ;(
      this.configPresenter as IConfigPresenter & {
        setDeepChatAgentDeleteCleanup?: (cleanup: (agentId: string) => Promise<void>) => void
      }
    ).setDeepChatAgentDeleteCleanup?.(async (agentId) => {
      await this.memoryPresenter.cleanupDeletedAgentResources(agentId)
    })
    ;(
      this.configPresenter as IConfigPresenter & {
        setDeepChatAgentMemoryMaintenanceConfigChanged?: (
          callback: (agentId: string) => void
        ) => void
      }
    ).setDeepChatAgentMemoryMaintenanceConfigChanged?.((agentId) =>
      routeDeepChatAgentMemoryMaintenanceConfigChanged(this.memoryPresenter, agentId)
    )

    // Initialize new agent architecture presenters
    const agentRuntimePresenter = new AgentRuntimePresenter(
      this.llmproviderPresenter as unknown as ILlmProviderPresenter,
      this.configPresenter,
      this.sqlitePresenter as unknown as import('./sqlitePresenter').SQLitePresenter,
      this.toolPresenter,
      newSessionHooksBridge,
      {
        providerCatalogPort,
        sessionPermissionPort,
        sessionUiPort,
        memoryPort: this.memoryPresenter,
        cacheImage: (data) => this.devicePresenter.cacheImage(data),
        skillPresenter: this.skillPresenter
      }
    )
    this.agentSessionPresenter = new AgentSessionPresenter(
      agentRuntimePresenter,
      this.llmproviderPresenter as unknown as ILlmProviderPresenter,
      this.configPresenter,
      this.sqlitePresenter as unknown as import('./sqlitePresenter').SQLitePresenter,
      this.skillPresenter,
      undefined,
      {
        providerSessionPort,
        sessionPermissionPort,
        sessionUiPort
      }
    )
    this.projectPresenter = new ProjectPresenter(
      this.sqlitePresenter as unknown as import('./sqlitePresenter').SQLitePresenter,
      this.devicePresenter,
      this.configPresenter
    )
    this.#remoteControlPresenter = new RemoteControlPresenter({
      configPresenter: this.configPresenter,
      agentSessionPresenter: this.agentSessionPresenter,
      filePresenter: this.filePresenter,
      agentRuntimePresenter,
      windowPresenter: this.windowPresenter,
      tabPresenter: this.tabPresenter
    })
    this.remoteControlPresenter = this.#remoteControlPresenter

    // Update hooksNotifications with actual dependencies now that agentSessionPresenter is ready
    this.hooksNotifications = new HooksNotificationsService(this.configPresenter, {
      getSession: this.agentSessionPresenter.getSession.bind(this.agentSessionPresenter),
      getMessage: this.agentSessionPresenter.getMessage.bind(this.agentSessionPresenter)
    })

    this.setupEventBus()
  }

  getActiveConversationIdSync(webContentsId: number): string | null {
    return this.sessionPresenterInternal?.getActiveConversationIdSync(webContentsId) ?? null
  }

  async broadcastConversationThreadListUpdate(): Promise<void> {
    await this.getSessionPresenter().broadcastThreadListUpdate()
  }

  async cleanupConversationRuntimeArtifacts(conversationId: string): Promise<void> {
    try {
      await this.llmproviderPresenter.clearAcpSession(conversationId)
    } catch (error) {
      console.warn('[Presenter] Failed to clear ACP session:', error)
    }
  }

  private getSessionPresenter(): SessionPresenter {
    if (!this.sessionPresenterInternal) {
      this.sessionPresenterInternal = new SessionPresenter({
        messageManager: this.sessionMessageManager,
        sqlitePresenter: this.sqlitePresenter,
        llmProviderPresenter: this.llmproviderPresenter,
        configPresenter: this.configPresenter,
        exporter: this.exporter,
        commandPermissionService: this.commandPermissionService
      })
    }

    this.sessionPresenterInternal.initializeLegacyRuntime()
    return this.sessionPresenterInternal
  }

  public static getInstance(lifecycleManager: ILifecycleManager): Presenter {
    if (!Presenter.instance) {
      Presenter.instance = new Presenter(lifecycleManager)
    }
    return Presenter.instance
  }

  setupEventBus() {
    setDeepchatEventWindowPresenter(this.windowPresenter)

    this.setupSpecialEventHandlers()
  }

  private setupSpecialEventHandlers() {
    eventBus.on(CONFIG_EVENTS.PROVIDER_CHANGED, () => {
      const providers = this.configPresenter.getProviders()
      this.llmproviderPresenter.setProviders(providers)
    })
  }
  setupTray() {
    console.info('setupTray', !!this.trayPresenter)
    if (!this.trayPresenter) {
      this.trayPresenter = new TrayPresenter()
    }
    this.trayPresenter.init()
  }

  init() {
    if (this.hasInitialized) {
      console.info('[Startup][Main] Presenter.init skipped because startup already ran')
      return
    }

    this.hasInitialized = true

    const providers = this.configPresenter.getProviders()
    console.info(`[Startup][Main] Presenter.init begin providers=${providers.length}`)
    this.llmproviderPresenter.setProviders(providers)
    const mainRunId = this.startupWorkloadCoordinator.createRun('main')

    void this.startupWorkloadCoordinator.scheduleTask({
      id: 'main:floating-button',
      target: 'main',
      phase: 'deferred',
      resource: 'io',
      labelKey: 'startup.main.floatingButton',
      runId: mainRunId,
      run: async () => {
        await this.initializeFloatingButton()
      }
    })

    void this.startupWorkloadCoordinator.scheduleTask({
      id: 'main:yo-browser',
      target: 'main',
      phase: 'background',
      resource: 'io',
      labelKey: 'startup.main.yoBrowser',
      runId: mainRunId,
      run: async () => {
        await this.initializeYoBrowser()
      }
    })

    void this.startupWorkloadCoordinator.scheduleTask({
      id: 'main:skills-init',
      target: 'main',
      phase: 'background',
      resource: 'cpu',
      labelKey: 'startup.main.skillsInit',
      runId: mainRunId,
      run: async () => {
        await this.initializeSkills()
      }
    })

    void this.startupWorkloadCoordinator.scheduleTask({
      id: 'main:skills-sync-scan',
      target: 'main',
      phase: 'background',
      resource: 'cpu',
      labelKey: 'startup.main.skillsSyncScan',
      runId: mainRunId,
      run: async (taskContext) => {
        await taskContext.yield()
        await this.initializeSkillSyncScan()
      }
    })

    void this.startupWorkloadCoordinator.scheduleTask({
      id: 'main:mcp-init',
      target: 'main',
      phase: 'background',
      resource: 'io',
      labelKey: 'startup.main.mcpInit',
      runId: mainRunId,
      run: async (taskContext) => {
        await taskContext.yield()
        await this.initializeMcp()
      }
    })

    void this.startupWorkloadCoordinator.scheduleTask({
      id: 'main:remote-runtime',
      target: 'main',
      phase: 'background',
      resource: 'io',
      labelKey: 'startup.main.remoteRuntime',
      runId: mainRunId,
      run: async (taskContext) => {
        await taskContext.yield()
        await this.initializeRemoteControl()
      }
    })

    void this.startupWorkloadCoordinator
      .whenIdle('main', async () => {
        await this.startupWorkloadCoordinator.scheduleTask({
          id: 'main:provider-warmup-idle',
          target: 'main',
          phase: 'background',
          resource: 'io',
          labelKey: 'startup.main.provider.warmup',
          visibleId: 'main.provider.warmup',
          dedupeKey: 'main.provider.warmup:idle',
          runId: mainRunId,
          run: async (taskContext) => {
            await this.initializeIdleProviderWarmup(taskContext)
          }
        })
      })
      .catch((error) => {
        console.error('Failed to schedule idle provider warmup:', error)
      })
  }

  private async initializeFloatingButton() {
    try {
      await this.floatingButtonPresenter.initialize()
      logger.info('FloatingButtonPresenter initialized successfully')
    } catch (error) {
      console.error('Failed to initialize FloatingButtonPresenter:', error)
    }
  }

  private async initializeYoBrowser() {
    try {
      await this.yoBrowserPresenter.initialize()
      logger.info('YoBrowserPresenter initialized')
    } catch (error) {
      console.error('Failed to initialize YoBrowserPresenter:', error)
    }
  }

  private async initializeSkills() {
    try {
      const { enableSkills } = this.configPresenter.getSkillSettings()
      if (!enableSkills) {
        logger.info('SkillPresenter disabled by config')
        return
      }
      await (this.skillPresenter as SkillPresenter).initialize()
      logger.info('SkillPresenter initialized')
      await this.skillSyncPresenter.initialize()
    } catch (error) {
      console.error('Failed to initialize SkillPresenter:', error)
    }
  }

  private async initializeSkillSyncScan() {
    try {
      const { enableSkills } = this.configPresenter.getSkillSettings()
      if (!enableSkills) {
        return
      }
      await this.skillSyncPresenter.initialize()
      await this.skillSyncPresenter.scanAndDetectNewDiscoveries()
      logger.info('SkillSyncPresenter background scan completed')
    } catch (error) {
      console.error('Failed to run SkillSyncPresenter background scan:', error)
    }
  }

  private async initializeMcp() {
    try {
      await this.pluginPresenter.initialize()
    } catch (error) {
      console.error('[PluginHost] Failed to initialize plugins:', error)
    }

    try {
      await this.mcpPresenter.initialize()
    } catch (error) {
      console.error('Failed to initialize McpPresenter:', error)
    }
  }

  private async initializeRemoteControl() {
    try {
      await this.#remoteControlPresenter.initialize()
    } catch (error) {
      console.error('RemoteControlPresenter.initialize failed:', error)
    }
  }

  private async initializeIdleProviderWarmup(taskContext: StartupWorkloadTaskContext) {
    const enabledProviders = this.configPresenter
      .getEnabledProviders()
      .map((provider) => provider.id)
      .filter((providerId, index, ids) => ids.indexOf(providerId) === index)

    if (enabledProviders.length === 0) {
      taskContext.reportProgress(1)
      return
    }

    console.info(
      `[Startup][Main] startup.provider.warmup.deferred begin providers=${enabledProviders.length}`
    )

    for (const [index, providerId] of enabledProviders.entries()) {
      if (taskContext.signal.aborted) {
        const error = new Error(`Provider warmup aborted for ${providerId}`)
        error.name = 'AbortError'
        throw error
      }

      const providerModels = this.configPresenter.getProviderModels(providerId)
      const customModels = this.configPresenter.getCustomModels(providerId)
      this.configPresenter.getDbProviderModels(providerId)
      this.configPresenter.getBatchModelStatus(providerId, [
        ...providerModels.map((model) => model.id),
        ...customModels.map((model) => model.id)
      ])

      taskContext.reportProgress((index + 1) / enabledProviders.length)
      await taskContext.yield()
    }

    console.info(
      `[Startup][Main] startup.provider.warmup.deferred done providers=${enabledProviders.length}`
    )
  }

  getStartupWorkloadCoordinator(): StartupWorkloadCoordinator {
    return this.startupWorkloadCoordinator
  }

  async destroy(): Promise<void> {
    try {
      await this.pluginPresenter.shutdown()
    } catch (error) {
      console.error('PluginPresenter.shutdown failed during presenter destroy:', error)
    }

    try {
      await this.mcpPresenter.shutdown()
    } catch (error) {
      console.error('McpPresenter.shutdown failed during presenter destroy:', error)
    }

    await this.destroyRemoteControl()
    this.floatingButtonPresenter.destroy()
    this.tabPresenter.destroy()
    // Drain in-flight memory consolidation before the shared SQLite connection closes, so a pass
    // that already fired cannot write to a closed database during teardown.
    await this.memoryPresenter.dispose()
    this.sqlitePresenter.close()
    this.shortcutPresenter.destroy()
    this.syncPresenter.destroy()
    this.notificationPresenter.clearAllNotifications()
    this.knowledgePresenter.destroy()
    await (this.workspacePresenter as WorkspacePresenter).destroy()
    await (this.skillPresenter as SkillPresenter).destroy()
    ;(this.skillSyncPresenter as SkillSyncPresenter).destroy()
  }

  private async destroyRemoteControl() {
    try {
      await this.#remoteControlPresenter.destroy()
    } catch (error) {
      console.error('RemoteControlPresenter.destroy failed:', error)
    }
  }
}

// Export presenter instance - will be initialized with database during lifecycle
export let presenter: Presenter
// The route runtime is cached against the process-wide Presenter singleton.
// If Presenter ever supports reinitialization, this cache must be reset with it.
let cachedMainKernelRouteRuntime: ReturnType<typeof createMainKernelRouteRuntime> | undefined

const buildMainKernelRouteRuntime = () =>
  createMainKernelRouteRuntime({
    configPresenter: presenter.configPresenter,
    llmProviderPresenter: presenter.llmproviderPresenter,
    agentSessionPresenter: presenter.agentSessionPresenter,
    skillPresenter: presenter.skillPresenter,
    skillSyncPresenter: presenter.skillSyncPresenter,
    exporter: presenter.exporter,
    oauthPresenter: presenter.oauthPresenter,
    mcpPresenter: presenter.mcpPresenter,
    remoteControlPresenter: presenter.remoteControlPresenter,
    shortcutPresenter: presenter.shortcutPresenter,
    syncPresenter: presenter.syncPresenter,
    upgradePresenter: presenter.upgradePresenter,
    dialogPresenter: presenter.dialogPresenter,
    toolPresenter: presenter.toolPresenter,
    sqlitePresenter: presenter.sqlitePresenter,
    windowPresenter: presenter.windowPresenter,
    devicePresenter: presenter.devicePresenter,
    projectPresenter: presenter.projectPresenter,
    filePresenter: presenter.filePresenter,
    knowledgePresenter: presenter.knowledgePresenter,
    workspacePresenter: presenter.workspacePresenter,
    yoBrowserPresenter: presenter.yoBrowserPresenter,
    tabPresenter: presenter.tabPresenter,
    startupWorkloadCoordinator: presenter.startupWorkloadCoordinator,
    pluginPresenter: presenter.pluginPresenter,
    databaseSecurityPresenter: presenter.databaseSecurityPresenter,
    memoryPresenter: presenter.memoryPresenter,
    scheduledTasks: presenter.scheduledTasks
  })

export function getMainKernelRouteRuntime(): ReturnType<typeof createMainKernelRouteRuntime> {
  if (!presenter) {
    throw new Error('Presenter must be initialized before accessing the kernel route runtime')
  }
  if (!cachedMainKernelRouteRuntime) {
    cachedMainKernelRouteRuntime = buildMainKernelRouteRuntime()
  }
  return cachedMainKernelRouteRuntime
}

// Initialize presenter with database instance and optional lifecycle manager
export function getInstance(lifecycleManager: ILifecycleManager): Presenter {
  // only allow initialize once
  if (presenter == null) presenter = Presenter.getInstance(lifecycleManager)
  return presenter
}

registerMainKernelRoutes(ipcMain, () => (presenter ? getMainKernelRouteRuntime() : undefined))
