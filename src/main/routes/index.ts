import { BrowserWindow, app, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import type {
  IConfigPresenter,
  IConversationExporter,
  ISQLitePresenter,
  ISyncPresenter,
  IWindowPresenter,
  CloudSyncResult
} from '@shared/presenter'
import { DEEPCHAT_ROUTE_INVOKE_CHANNEL } from '@shared/contracts/channels'
import { sessionsUpdatedEvent } from '@shared/contracts/events'
import { publishDeepchatEvent } from './publishDeepchatEvent'
import {
  configAddCustomPromptRoute,
  configAddSystemPromptRoute,
  configClearDefaultSystemPromptRoute,
  configDeleteCustomPromptRoute,
  configDeleteDeepChatAgentRoute,
  configDeleteSystemPromptRoute,
  configRemoveManualAcpAgentRoute,
  configResetDefaultSystemPromptRoute,
  configResetShortcutKeysRoute,
  configSetAcpAgentEnabledRoute,
  configSetAcpEnabledRoute,
  configSetAcpSharedMcpSelectionsRoute,
  configSetCustomPromptsRoute,
  configSetDefaultSystemPromptIdRoute,
  configSetDefaultSystemPromptRoute,
  configSetKnowledgeConfigsRoute,
  configSetSystemPromptsRoute,
  configUninstallAcpRegistryAgentRoute,
  configUpdateCustomPromptRoute,
  configUpdateDeepChatAgentRoute,
  configUpdateManualAcpAgentRoute,
  configUpdateSystemPromptRoute,
  databaseSecurityChangePasswordRoute,
  databaseSecurityDisableRoute,
  databaseSecurityEnableRoute,
  databaseSecurityGetStatusRoute,
  databaseSecurityRepairSchemaRoute,
  debugCreateMockChatSessionRoute,
  hasDeepchatRouteContract,
  mcpGetClientsRoute,
  mcpGetEnabledRoute,
  mcpGetNpmRegistryStatusRoute,
  mcpGetServersRoute,
  modelsGetProviderCatalogRoute,
  nowledgeMemGetConfigRoute,
  nowledgeMemTestConnectionRoute,
  nowledgeMemUpdateConfigRoute,
  providersListOllamaModelsRoute,
  providersListOllamaRunningModelsRoute,
  providersListSummariesRoute,
  sessionsListLightweightRoute,
  settingsActivityListRoute,
  settingsGetSnapshotRoute,
  settingsListSystemFontsRoute,
  settingsUpdateRoute,
  startupGetBootstrapRoute,
  skillsListMetadataRoute,
  syncGetBackupStatusRoute,
  syncImportRoute,
  syncListBackupsRoute,
  syncOpenFolderRoute,
  syncStartBackupRoute,
  syncGetCloudConfigRoute,
  syncSetCloudConfigRoute,
  syncTestCloudRoute,
  syncUploadToCloudRoute,
  syncPullFromCloudRoute,
  type DatabaseSecurityStatus,
  type SettingsActivityInput
} from '@shared/contracts/routes'
import { dispatchConfigRoute } from './config/configRouteHandler'
import { createRouteRegistry, type DeepchatRouteMap, type RouteContext } from './routeRegistry'
import { createSettingsRouteAdapter } from './settings/settingsAdapter'
import { createSettingsRouteHandler } from './settings/settingsHandler'
import type { StartupWorkloadCoordinator } from '@/presenter/startupWorkloadCoordinator'
import type { DatabaseSecurityPresenter } from '@/presenter/databaseSecurityPresenter'
import type { SyncImportResult } from '@/presenter/syncPresenter'
import type { SessionQuery } from '@/session/query'

export type MainKernelRouteRuntime = {
  appDatabaseMaintenance: MainKernelAppDatabaseMaintenancePort
  configPresenter: IConfigPresenter
  routeRegistry: DeepchatRouteMap
  startupSessionProjection: Pick<SessionQuery, 'getLightweightByIds'>
  startupDesktopSession: MainKernelDesktopSessionPort
  settingsWindow: Pick<IWindowPresenter, 'getSettingsWindowId'>
  exporter: IConversationExporter
  syncPresenter: ISyncPresenter
  settingsHandler: ReturnType<typeof createSettingsRouteHandler>
  sqlitePresenter: ISQLitePresenter
  ensureDefaultWorkspace(): Promise<string | null>
  startupWorkloadCoordinator: StartupWorkloadCoordinator
  databaseSecurityPresenter: DatabaseSecurityPresenter
  reconcileSchedulerAfterAgentChange(): Promise<void>
}

export interface MainKernelAppDatabaseMaintenancePort {
  assertRouteAllowed(routeName: string): void
  enableDatabaseEncryption(password: string): Promise<DatabaseSecurityStatus>
  changeDatabasePassword(
    currentPassword: string,
    newPassword: string
  ): Promise<DatabaseSecurityStatus>
  disableDatabaseEncryption(currentPassword: string): Promise<DatabaseSecurityStatus>
  importFromSync(
    backupFileName: string,
    importMode?: 'increment' | 'overwrite'
  ): Promise<SyncImportResult>
  pullLatestBackupFromCloud(importMode?: 'increment' | 'overwrite'): Promise<CloudSyncResult>
}

export interface MainKernelDesktopSessionPort {
  getActiveId(webContentsId: number): string | null
}

const CRON_JOB_AGENT_CHANGE_ROUTES: ReadonlySet<string> = new Set([
  configSetAcpEnabledRoute.name,
  configSetAcpAgentEnabledRoute.name,
  configUninstallAcpRegistryAgentRoute.name,
  configUpdateManualAcpAgentRoute.name,
  configRemoveManualAcpAgentRoute.name,
  configUpdateDeepChatAgentRoute.name,
  configDeleteDeepChatAgentRoute.name
])

async function reconcileCronJobsAfterAgentChange(
  runtime: MainKernelRouteRuntime,
  routeName: string
): Promise<void> {
  if (!CRON_JOB_AGENT_CHANGE_ROUTES.has(routeName)) {
    return
  }
  try {
    await runtime.reconcileSchedulerAfterAgentChange()
  } catch (error) {
    console.warn('[CronJobs] Failed to reconcile jobs after agent change:', error)
  }
}

export function createMainKernelRouteRuntime(deps: {
  appDatabaseMaintenance: MainKernelAppDatabaseMaintenancePort
  configPresenter: IConfigPresenter
  routeMaps: readonly DeepchatRouteMap[]
  startupSessionProjection: Pick<SessionQuery, 'getLightweightByIds'>
  startupDesktopSession: MainKernelDesktopSessionPort
  settingsWindow: Pick<IWindowPresenter, 'getSettingsWindowId'>
  exporter: IConversationExporter
  syncPresenter: ISyncPresenter
  sqlitePresenter?: ISQLitePresenter
  ensureDefaultWorkspace(): Promise<string | null>
  startupWorkloadCoordinator: StartupWorkloadCoordinator
  databaseSecurityPresenter: DatabaseSecurityPresenter
  reconcileSchedulerAfterAgentChange(): Promise<void>
}): MainKernelRouteRuntime {
  return {
    appDatabaseMaintenance: deps.appDatabaseMaintenance,
    configPresenter: deps.configPresenter,
    routeRegistry: createRouteRegistry(deps.routeMaps),
    startupSessionProjection: deps.startupSessionProjection,
    startupDesktopSession: deps.startupDesktopSession,
    settingsWindow: deps.settingsWindow,
    exporter: deps.exporter,
    syncPresenter: deps.syncPresenter,
    settingsHandler: createSettingsRouteHandler(createSettingsRouteAdapter(deps.configPresenter)),
    sqlitePresenter:
      deps.sqlitePresenter ??
      ({
        recordSettingsActivity: async (input: SettingsActivityInput) => ({
          id: 'noop',
          category: input.category,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId ?? null,
          targetLabel: input.targetLabel ?? '',
          routeName: input.routeName ?? null,
          routeParams: input.routeParams ?? {},
          summaryKey: input.summaryKey,
          summaryParams: input.summaryParams ?? {},
          createdAt: Date.now()
        }),
        listSettingsActivity: async () => []
      } as unknown as ISQLitePresenter),
    ensureDefaultWorkspace: deps.ensureDefaultWorkspace,
    startupWorkloadCoordinator: deps.startupWorkloadCoordinator,
    databaseSecurityPresenter: deps.databaseSecurityPresenter,
    reconcileSchedulerAfterAgentChange: deps.reconcileSchedulerAfterAgentChange
  }
}

function recordSettingsActivity(
  runtime: MainKernelRouteRuntime,
  activity: SettingsActivityInput
): void {
  void runtime.sqlitePresenter.recordSettingsActivity(activity).catch((error) => {
    console.warn('[SettingsActivity] Failed to record settings activity:', error)
  })
}

function readPromptUpdateName(input: unknown): string | null {
  if (!input || typeof input !== 'object' || !('updates' in input)) {
    return null
  }

  const updates = (input as { updates?: { name?: unknown } }).updates
  return updates && typeof updates.name === 'string' ? updates.name : null
}

function recordConfigRouteActivity(
  runtime: MainKernelRouteRuntime,
  routeName: string,
  rawInput: unknown
): void {
  try {
    switch (routeName) {
      case configSetKnowledgeConfigsRoute.name: {
        const input = configSetKnowledgeConfigsRoute.input.parse(rawInput)
        recordSettingsActivity(runtime, {
          category: 'knowledge',
          action: 'updated',
          targetType: 'knowledge-configs',
          targetLabel: 'Knowledge sources',
          routeName: 'settings-knowledge-base',
          summaryKey: 'settings.controlCenter.activity.settingUpdated',
          summaryParams: {
            key: `knowledge sources (${input.configs.length})`
          }
        })
        return
      }
      case configSetCustomPromptsRoute.name: {
        const input = configSetCustomPromptsRoute.input.parse(rawInput)
        recordSettingsActivity(runtime, {
          category: 'prompt',
          action: 'updated',
          targetType: 'custom-prompts',
          targetLabel: 'Custom prompts',
          routeName: 'settings-prompt',
          summaryKey: 'settings.controlCenter.activity.settingUpdated',
          summaryParams: {
            key: `custom prompts (${input.prompts.length})`
          }
        })
        return
      }
      case configAddCustomPromptRoute.name:
      case configUpdateCustomPromptRoute.name:
      case configDeleteCustomPromptRoute.name: {
        const input =
          routeName === configAddCustomPromptRoute.name
            ? configAddCustomPromptRoute.input.parse(rawInput)
            : routeName === configUpdateCustomPromptRoute.name
              ? configUpdateCustomPromptRoute.input.parse(rawInput)
              : configDeleteCustomPromptRoute.input.parse(rawInput)
        const targetId =
          'prompt' in input ? input.prompt.id : 'promptId' in input ? input.promptId : null
        const targetLabel =
          'prompt' in input
            ? input.prompt.name
            : readPromptUpdateName(input)
              ? readPromptUpdateName(input)!
              : (targetId ?? 'custom prompt')
        recordSettingsActivity(runtime, {
          category: 'prompt',
          action:
            routeName === configAddCustomPromptRoute.name
              ? 'created'
              : routeName === configDeleteCustomPromptRoute.name
                ? 'removed'
                : 'updated',
          targetType: 'custom-prompt',
          targetId,
          targetLabel,
          routeName: 'settings-prompt',
          summaryKey: 'settings.controlCenter.activity.settingUpdated',
          summaryParams: {
            key: targetLabel
          }
        })
        return
      }
      case configSetSystemPromptsRoute.name: {
        const input = configSetSystemPromptsRoute.input.parse(rawInput)
        recordSettingsActivity(runtime, {
          category: 'prompt',
          action: 'updated',
          targetType: 'system-prompts',
          targetLabel: 'System prompts',
          routeName: 'settings-prompt',
          summaryKey: 'settings.controlCenter.activity.settingUpdated',
          summaryParams: {
            key: `system prompts (${input.prompts.length})`
          }
        })
        return
      }
      case configAddSystemPromptRoute.name:
      case configUpdateSystemPromptRoute.name:
      case configDeleteSystemPromptRoute.name: {
        const input =
          routeName === configAddSystemPromptRoute.name
            ? configAddSystemPromptRoute.input.parse(rawInput)
            : routeName === configUpdateSystemPromptRoute.name
              ? configUpdateSystemPromptRoute.input.parse(rawInput)
              : configDeleteSystemPromptRoute.input.parse(rawInput)
        const targetId =
          'prompt' in input ? input.prompt.id : 'promptId' in input ? input.promptId : null
        const targetLabel =
          'prompt' in input
            ? input.prompt.name
            : readPromptUpdateName(input)
              ? readPromptUpdateName(input)!
              : (targetId ?? 'system prompt')
        recordSettingsActivity(runtime, {
          category: 'prompt',
          action:
            routeName === configAddSystemPromptRoute.name
              ? 'created'
              : routeName === configDeleteSystemPromptRoute.name
                ? 'removed'
                : 'updated',
          targetType: 'system-prompt',
          targetId,
          targetLabel,
          routeName: 'settings-prompt',
          summaryKey: 'settings.controlCenter.activity.settingUpdated',
          summaryParams: {
            key: targetLabel
          }
        })
        return
      }
      case configSetDefaultSystemPromptRoute.name:
      case configResetDefaultSystemPromptRoute.name:
      case configClearDefaultSystemPromptRoute.name:
      case configSetDefaultSystemPromptIdRoute.name: {
        const targetLabel =
          routeName === configSetDefaultSystemPromptIdRoute.name
            ? configSetDefaultSystemPromptIdRoute.input.parse(rawInput).promptId
            : 'default system prompt'
        recordSettingsActivity(runtime, {
          category: 'prompt',
          action: 'updated',
          targetType: 'default-system-prompt',
          targetId: null,
          targetLabel,
          routeName: 'settings-prompt',
          summaryKey: 'settings.controlCenter.activity.settingUpdated',
          summaryParams: {
            key: targetLabel
          }
        })
        return
      }
      case configSetAcpSharedMcpSelectionsRoute.name: {
        const input = configSetAcpSharedMcpSelectionsRoute.input.parse(rawInput)
        recordSettingsActivity(runtime, {
          category: 'agent',
          action: 'updated',
          targetType: 'acp-shared-mcp',
          targetLabel: 'ACP shared MCP',
          routeName: 'settings-acp',
          summaryKey: 'settings.controlCenter.activity.settingUpdated',
          summaryParams: {
            key: `ACP shared MCP (${input.selections.length})`
          }
        })
        return
      }
      case configResetShortcutKeysRoute.name: {
        configResetShortcutKeysRoute.input.parse(rawInput)
        recordSettingsActivity(runtime, {
          category: 'shortcut',
          action: 'reset',
          targetType: 'shortcut',
          targetLabel: 'Shortcuts',
          routeName: 'settings-shortcut',
          summaryKey: 'settings.controlCenter.activity.settingUpdated',
          summaryParams: {
            key: 'shortcuts'
          }
        })
      }
    }
  } catch (error) {
    console.warn('[SettingsActivity] Failed to record config route activity:', error)
  }
}

type StartupTrackedRouteTask = {
  target: 'main' | 'settings'
  visibleId:
    | 'main.bootstrap'
    | 'main.session.firstPage'
    | 'main.provider.warmup'
    | 'settings.providers.summary'
    | 'settings.provider.models'
    | 'settings.ollama'
    | 'settings.skills.catalog'
    | 'settings.mcp.runtime'
  phase: 'interactive' | 'deferred' | 'background'
  resource: 'cpu' | 'io'
  labelKey: string
  id: string
  dedupeKey?: string
}

function isSettingsWindowContext(runtime: MainKernelRouteRuntime, context: RouteContext): boolean {
  if (context.windowId == null) {
    return false
  }
  return runtime.settingsWindow.getSettingsWindowId() === context.windowId
}

function resolveTrackedRouteTask(
  runtime: MainKernelRouteRuntime,
  routeName: string,
  context: RouteContext
): StartupTrackedRouteTask | null {
  const isSettings = isSettingsWindowContext(runtime, context)

  if (routeName === providersListSummariesRoute.name && isSettings) {
    return {
      target: 'settings',
      visibleId: 'settings.providers.summary',
      phase: 'interactive',
      resource: 'io',
      labelKey: 'startup.settings.providers.summary',
      id: 'settings.providers.summary:route',
      dedupeKey: 'settings.providers.summary:route'
    }
  }

  if (routeName === modelsGetProviderCatalogRoute.name) {
    if (isSettings) {
      return {
        target: 'settings',
        visibleId: 'settings.provider.models',
        phase: 'deferred',
        resource: 'io',
        labelKey: 'startup.settings.provider.models',
        id: 'settings.provider.models:route'
      }
    }

    return {
      target: 'main',
      visibleId: 'main.provider.warmup',
      phase: 'deferred',
      resource: 'io',
      labelKey: 'startup.main.provider.warmup',
      id: 'main.provider.warmup:route'
    }
  }

  if (
    isSettings &&
    (routeName === providersListOllamaModelsRoute.name ||
      routeName === providersListOllamaRunningModelsRoute.name)
  ) {
    return {
      target: 'settings',
      visibleId: 'settings.ollama',
      phase: 'deferred',
      resource: 'io',
      labelKey: 'startup.settings.ollama',
      id: `settings.ollama:${routeName}`
    }
  }

  if (routeName === sessionsListLightweightRoute.name && !isSettings) {
    return {
      target: 'main',
      visibleId: 'main.session.firstPage',
      phase: 'interactive',
      resource: 'io',
      labelKey: 'startup.main.session.firstPage',
      id: 'main.session.firstPage:route',
      dedupeKey: 'main.session.firstPage:route'
    }
  }

  if (routeName === skillsListMetadataRoute.name && isSettings) {
    return {
      target: 'settings',
      visibleId: 'settings.skills.catalog',
      phase: 'deferred',
      resource: 'cpu',
      labelKey: 'startup.settings.skills.catalog',
      id: 'settings.skills.catalog:route'
    }
  }

  const isSettingsMcpRuntimeRoute =
    routeName === mcpGetServersRoute.name ||
    routeName === mcpGetEnabledRoute.name ||
    routeName === mcpGetClientsRoute.name ||
    routeName === mcpGetNpmRegistryStatusRoute.name

  if (isSettings && isSettingsMcpRuntimeRoute) {
    return {
      target: 'settings',
      visibleId: 'settings.mcp.runtime',
      phase: 'deferred',
      resource: 'io',
      labelKey: 'startup.settings.mcp.runtime',
      id: `settings.mcp.runtime:${routeName}`
    }
  }

  return null
}

async function runTrackedRouteTask<T>(
  runtime: MainKernelRouteRuntime,
  routeName: string,
  context: RouteContext,
  action: () => Promise<T>
): Promise<T> {
  const coordinator = (runtime as Partial<MainKernelRouteRuntime>).startupWorkloadCoordinator
  if (!coordinator) {
    return await action()
  }

  const trackedTask = resolveTrackedRouteTask(runtime, routeName, context)
  if (!trackedTask) {
    return await action()
  }

  return await coordinator.scheduleTask({
    id: trackedTask.id,
    target: trackedTask.target,
    phase: trackedTask.phase,
    resource: trackedTask.resource,
    labelKey: trackedTask.labelKey,
    visibleId: trackedTask.visibleId,
    dedupeKey: trackedTask.dedupeKey,
    runId: coordinator.getRunId(trackedTask.target),
    run: async () => {
      return await action()
    }
  })
}

export async function dispatchDeepchatRoute(
  runtime: MainKernelRouteRuntime,
  routeName: string,
  rawInput: unknown,
  context: RouteContext
): Promise<unknown> {
  runtime.appDatabaseMaintenance.assertRouteAllowed(routeName)
  if (!hasDeepchatRouteContract(routeName)) {
    throw new Error(`Unknown deepchat route: ${routeName}`)
  }

  const registeredRoute = runtime.routeRegistry.get(routeName)
  if (registeredRoute) {
    return await runTrackedRouteTask(runtime, routeName, context, async () => {
      return await registeredRoute(rawInput, context)
    })
  }

  const configResult = await dispatchConfigRoute(runtime.configPresenter, routeName, rawInput)
  if (configResult !== undefined) {
    recordConfigRouteActivity(runtime, routeName, rawInput)
    await reconcileCronJobsAfterAgentChange(runtime, routeName)
    return configResult
  }

  switch (routeName) {
    case settingsGetSnapshotRoute.name: {
      return runtime.settingsHandler.getSnapshot(rawInput)
    }

    case settingsListSystemFontsRoute.name: {
      return await runtime.settingsHandler.listSystemFonts(rawInput)
    }

    case settingsUpdateRoute.name: {
      const input = settingsUpdateRoute.input.parse(rawInput)
      const result = runtime.settingsHandler.update(input)
      for (const change of input.changes) {
        recordSettingsActivity(runtime, {
          category:
            change.key === 'privacyModeEnabled'
              ? 'privacy'
              : change.key === 'fontSizeLevel' ||
                  change.key === 'fontFamily' ||
                  change.key === 'codeFontFamily' ||
                  change.key === 'artifactsEffectEnabled' ||
                  change.key === 'contentProtectionEnabled'
                ? 'appearance'
                : 'system',
          action:
            typeof change.value === 'boolean' ? (change.value ? 'enabled' : 'disabled') : 'updated',
          targetType: 'setting',
          targetId: change.key,
          targetLabel: change.key,
          routeName: change.key === 'privacyModeEnabled' ? 'settings-database' : 'settings-common',
          summaryKey: 'settings.controlCenter.activity.settingUpdated',
          summaryParams: {
            key: change.key
          }
        })
      }
      return result
    }

    case settingsActivityListRoute.name: {
      const input = settingsActivityListRoute.input.parse(rawInput)
      const activities = await runtime.sqlitePresenter.listSettingsActivity(input.limit)
      return settingsActivityListRoute.output.parse({ activities })
    }

    case databaseSecurityGetStatusRoute.name: {
      databaseSecurityGetStatusRoute.input.parse(rawInput)
      return databaseSecurityGetStatusRoute.output.parse({
        status: runtime.databaseSecurityPresenter.getStatus()
      })
    }

    case databaseSecurityEnableRoute.name: {
      const input = databaseSecurityEnableRoute.input.parse(rawInput)
      const status = await runtime.appDatabaseMaintenance.enableDatabaseEncryption(input.password)
      recordSettingsActivity(runtime, {
        category: 'privacy',
        action: 'enabled',
        targetType: 'database-encryption',
        targetId: 'agent.db',
        targetLabel: 'SQLite database encryption',
        routeName: 'settings-database',
        summaryKey: 'settings.controlCenter.activity.settingUpdated',
        summaryParams: {
          key: 'databaseEncryption'
        }
      })
      return databaseSecurityEnableRoute.output.parse({ status })
    }

    case databaseSecurityChangePasswordRoute.name: {
      const input = databaseSecurityChangePasswordRoute.input.parse(rawInput)
      const status = await runtime.appDatabaseMaintenance.changeDatabasePassword(
        input.currentPassword,
        input.newPassword
      )
      recordSettingsActivity(runtime, {
        category: 'privacy',
        action: 'updated',
        targetType: 'database-encryption',
        targetId: 'agent.db',
        targetLabel: 'SQLite database encryption',
        routeName: 'settings-database',
        summaryKey: 'settings.controlCenter.activity.settingUpdated',
        summaryParams: {
          key: 'databaseEncryptionPassword'
        }
      })
      return databaseSecurityChangePasswordRoute.output.parse({ status })
    }

    case databaseSecurityDisableRoute.name: {
      const input = databaseSecurityDisableRoute.input.parse(rawInput)
      const status = await runtime.appDatabaseMaintenance.disableDatabaseEncryption(
        input.currentPassword
      )
      recordSettingsActivity(runtime, {
        category: 'privacy',
        action: 'disabled',
        targetType: 'database-encryption',
        targetId: 'agent.db',
        targetLabel: 'SQLite database encryption',
        routeName: 'settings-database',
        summaryKey: 'settings.controlCenter.activity.settingUpdated',
        summaryParams: {
          key: 'databaseEncryption'
        }
      })
      return databaseSecurityDisableRoute.output.parse({ status })
    }

    case databaseSecurityRepairSchemaRoute.name: {
      databaseSecurityRepairSchemaRoute.input.parse(rawInput)
      return databaseSecurityRepairSchemaRoute.output.parse({
        report: await runtime.sqlitePresenter.repairSchema()
      })
    }

    case nowledgeMemGetConfigRoute.name: {
      nowledgeMemGetConfigRoute.input.parse(rawInput)
      return nowledgeMemGetConfigRoute.output.parse({
        config: runtime.exporter.getNowledgeMemConfig()
      })
    }

    case nowledgeMemUpdateConfigRoute.name: {
      const input = nowledgeMemUpdateConfigRoute.input.parse(rawInput)
      await runtime.exporter.updateNowledgeMemConfig(input.config)
      return nowledgeMemUpdateConfigRoute.output.parse({
        config: runtime.exporter.getNowledgeMemConfig()
      })
    }

    case nowledgeMemTestConnectionRoute.name: {
      nowledgeMemTestConnectionRoute.input.parse(rawInput)
      return nowledgeMemTestConnectionRoute.output.parse({
        result: await runtime.exporter.testNowledgeMemConnection()
      })
    }

    case startupGetBootstrapRoute.name: {
      startupGetBootstrapRoute.input.parse(rawInput)
      const coordinator = (runtime as Partial<MainKernelRouteRuntime>).startupWorkloadCoordinator

      if (!coordinator) {
        const activeSessionId = runtime.startupDesktopSession.getActiveId(context.webContentsId)
        const activeSession = activeSessionId
          ? ((await runtime.startupSessionProjection.getLightweightByIds([activeSessionId]))[0] ??
            null)
          : null
        const [agents, acpEnabled, defaultChatWorkspacePath] = await Promise.all([
          runtime.configPresenter.listAgents(),
          runtime.configPresenter.getAcpEnabled(),
          runtime.ensureDefaultWorkspace()
        ])

        const bootstrap = {
          startupRunId: `startup:${context.webContentsId}:${Date.now()}`,
          activeSessionId,
          activeSession,
          agents: agents
            .filter((agent) => agent.type === 'deepchat' || acpEnabled)
            .map((agent) => ({
              id: agent.id,
              name: agent.name,
              type: agent.type,
              agentType: agent.agentType,
              enabled: agent.enabled,
              protected: agent.protected,
              icon: agent.icon,
              description: agent.description,
              source: agent.source,
              avatar: agent.avatar
            })),
          defaultProjectPath: runtime.configPresenter.getDefaultProjectPath(),
          defaultChatWorkspacePath
        }

        return startupGetBootstrapRoute.output.parse({ bootstrap })
      }

      return await coordinator.scheduleTask({
        id: 'main.bootstrap:route',
        target: 'main',
        phase: 'interactive',
        resource: 'io',
        labelKey: 'startup.main.bootstrap',
        visibleId: 'main.bootstrap',
        dedupeKey: 'main.bootstrap:route',
        runId: coordinator.getRunId('main'),
        run: async () => {
          const startupRunId = coordinator.getRunId('main')
          const activeSessionId = runtime.startupDesktopSession.getActiveId(context.webContentsId)
          const activeSession = activeSessionId
            ? ((await runtime.startupSessionProjection.getLightweightByIds([activeSessionId]))[0] ??
              null)
            : null
          const [agents, acpEnabled, defaultChatWorkspacePath] = await Promise.all([
            runtime.configPresenter.listAgents(),
            runtime.configPresenter.getAcpEnabled(),
            runtime.ensureDefaultWorkspace()
          ])

          const bootstrap = {
            startupRunId,
            activeSessionId,
            activeSession,
            agents: agents
              .filter((agent) => agent.type === 'deepchat' || acpEnabled)
              .map((agent) => ({
                id: agent.id,
                name: agent.name,
                type: agent.type,
                agentType: agent.agentType,
                enabled: agent.enabled,
                protected: agent.protected,
                icon: agent.icon,
                description: agent.description,
                source: agent.source,
                avatar: agent.avatar
              })),
            defaultProjectPath: runtime.configPresenter.getDefaultProjectPath(),
            defaultChatWorkspacePath
          }

          coordinator.replayTarget('main')
          return startupGetBootstrapRoute.output.parse({ bootstrap })
        }
      })
    }

    case syncGetBackupStatusRoute.name: {
      syncGetBackupStatusRoute.input.parse(rawInput)
      const status = await runtime.syncPresenter.getBackupStatus()
      return syncGetBackupStatusRoute.output.parse({ status })
    }

    case syncListBackupsRoute.name: {
      syncListBackupsRoute.input.parse(rawInput)
      const backups = await runtime.syncPresenter.listBackups()
      return syncListBackupsRoute.output.parse({ backups })
    }

    case syncStartBackupRoute.name: {
      syncStartBackupRoute.input.parse(rawInput)
      const backup = await runtime.syncPresenter.startBackup()
      if (backup) {
        recordSettingsActivity(runtime, {
          category: 'data',
          action: 'backup_created',
          targetType: 'backup',
          targetId: backup.fileName,
          targetLabel: backup.fileName,
          routeName: 'settings-database',
          summaryKey: 'settings.controlCenter.activity.backupCreated',
          summaryParams: {
            name: backup.fileName
          }
        })
      }
      return syncStartBackupRoute.output.parse({ backup })
    }

    case syncImportRoute.name: {
      const input = syncImportRoute.input.parse(rawInput)
      const result = await runtime.appDatabaseMaintenance.importFromSync(
        input.backupFile,
        input.mode
      )
      if (result?.success) {
        recordSettingsActivity(runtime, {
          category: 'data',
          action: 'imported',
          targetType: 'backup',
          targetId: input.backupFile,
          targetLabel: input.backupFile,
          routeName: 'settings-database',
          summaryKey: 'settings.controlCenter.activity.backupImported',
          summaryParams: {
            name: input.backupFile
          }
        })
      }
      return syncImportRoute.output.parse({ result })
    }

    case syncOpenFolderRoute.name: {
      syncOpenFolderRoute.input.parse(rawInput)
      await runtime.syncPresenter.openSyncFolder()
      return syncOpenFolderRoute.output.parse({ opened: true })
    }

    case syncGetCloudConfigRoute.name: {
      syncGetCloudConfigRoute.input.parse(rawInput)
      const config = runtime.configPresenter.getCloudSyncConfig()
      return syncGetCloudConfigRoute.output.parse({ config })
    }

    case syncSetCloudConfigRoute.name: {
      const input = syncSetCloudConfigRoute.input.parse(rawInput)
      const config = runtime.configPresenter.setCloudSyncConfig(input.config)
      return syncSetCloudConfigRoute.output.parse({ config })
    }

    case syncTestCloudRoute.name: {
      syncTestCloudRoute.input.parse(rawInput)
      const result = await runtime.syncPresenter.testCloudConnection()
      return syncTestCloudRoute.output.parse({ result })
    }

    case syncUploadToCloudRoute.name: {
      syncUploadToCloudRoute.input.parse(rawInput)
      const result = await runtime.syncPresenter.uploadLatestBackupToCloud()
      if (result?.success) {
        recordSettingsActivity(runtime, {
          category: 'data',
          action: 'backup_created',
          targetType: 'backup',
          targetId: result.fileName ?? 'cloud',
          targetLabel: result.fileName ?? 'cloud',
          routeName: 'settings-database',
          summaryKey: 'settings.controlCenter.activity.backupCreated',
          summaryParams: {
            name: result.fileName ?? ''
          }
        })
      }
      return syncUploadToCloudRoute.output.parse({ result })
    }

    case syncPullFromCloudRoute.name: {
      const input = syncPullFromCloudRoute.input.parse(rawInput)
      const result = await runtime.appDatabaseMaintenance.pullLatestBackupFromCloud(input.mode)
      if (result?.success) {
        recordSettingsActivity(runtime, {
          category: 'data',
          action: 'imported',
          targetType: 'backup',
          targetId: result.fileName ?? 'cloud',
          targetLabel: result.fileName ?? 'cloud',
          routeName: 'settings-database',
          summaryKey: 'settings.controlCenter.activity.backupImported',
          summaryParams: {
            name: result.fileName ?? ''
          }
        })
      }
      return syncPullFromCloudRoute.output.parse({ result })
    }

    case debugCreateMockChatSessionRoute.name: {
      debugCreateMockChatSessionRoute.input.parse(rawInput)
      if (!import.meta.env.DEV || app.isPackaged) {
        return debugCreateMockChatSessionRoute.output.parse({
          created: false,
          sessionId: null,
          title: null,
          messageCount: 0
        })
      }

      const { createDebugMockChatSession } = await import('./debug/createMockChatSession')
      const result = createDebugMockChatSession(runtime.sqlitePresenter.getDatabase())
      if (result.sessionId) {
        publishDeepchatEvent(sessionsUpdatedEvent.name, {
          sessionIds: [result.sessionId],
          reason: 'created'
        })
      }
      return debugCreateMockChatSessionRoute.output.parse(result)
    }
  }

  throw new Error(`Unhandled deepchat route: ${routeName}`)
}

export function registerMainKernelRoutes(
  ipcMain: IpcMain,
  getRuntime: () => MainKernelRouteRuntime | undefined
): void {
  ipcMain.removeHandler(DEEPCHAT_ROUTE_INVOKE_CHANNEL)
  ipcMain.handle(
    DEEPCHAT_ROUTE_INVOKE_CHANNEL,
    async (event: IpcMainInvokeEvent, routeName: string, rawInput: unknown) => {
      const runtime = getRuntime()
      if (!runtime) {
        throw new Error('Main kernel routes are not available before presenter initialization')
      }

      return await dispatchDeepchatRoute(runtime, routeName, rawInput, {
        webContentsId: event.sender.id,
        windowId: BrowserWindow.fromWebContents(event.sender)?.id ?? null
      })
    }
  )
}
