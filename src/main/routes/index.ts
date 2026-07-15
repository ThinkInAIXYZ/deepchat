import { BrowserWindow, app, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import type {
  IConfigPresenter,
  IConversationExporter,
  IDevicePresenter,
  IDialogPresenter,
  ISQLitePresenter,
  ISyncPresenter,
  IUpgradePresenter,
  IWindowPresenter,
  CloudSyncResult
} from '@shared/presenter'
import { DEEPCHAT_ROUTE_INVOKE_CHANNEL } from '@shared/contracts/channels'
import { sessionsUpdatedEvent } from '@shared/contracts/events'
import { publishDeepchatEvent } from './publishDeepchatEvent'
import {
  acpTerminalInputRoute,
  acpTerminalKillRoute,
  chatRespondToolInteractionRoute,
  chatSendMessageRoute,
  chatSteerActiveTurnRoute,
  chatStopStreamRoute,
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
  dialogErrorRoute,
  dialogRespondRoute,
  deviceGetAppVersionRoute,
  deviceGetInfoRoute,
  deviceRestartAppRoute,
  deviceResetDataByTypeRoute,
  deviceSanitizeSvgRoute,
  deviceSelectDirectoryRoute,
  deviceSelectFilesRoute,
  hasDeepchatRouteContract,
  mcpGetClientsRoute,
  mcpGetEnabledRoute,
  mcpGetNpmRegistryStatusRoute,
  mcpGetServersRoute,
  modelsGetProviderCatalogRoute,
  onboardingCompleteRoute,
  onboardingGetStateRoute,
  onboardingResetRoute,
  onboardingSetStepStatusRoute,
  onboardingStartRoute,
  nowledgeMemGetConfigRoute,
  nowledgeMemTestConnectionRoute,
  nowledgeMemUpdateConfigRoute,
  providersListOllamaModelsRoute,
  providersListOllamaRunningModelsRoute,
  providersListSummariesRoute,
  sessionsActivateRoute,
  sessionsClearMessagesRoute,
  sessionsCompactRoute,
  sessionsConvertPendingInputToSteerRoute,
  sessionsCreateRoute,
  sessionsDeleteAgentSessionsRoute,
  sessionsDeleteMessageRoute,
  sessionsDeletePendingInputRoute,
  sessionsDeleteRoute,
  sessionsDeactivateRoute,
  sessionsEditUserMessageRoute,
  sessionsEnsureAcpDraftRoute,
  sessionsExportMessageTapeReplaySliceRoute,
  sessionsExportRoute,
  sessionsForkRoute,
  sessionsGetAcpSessionCommandsRoute,
  sessionsGetAcpSessionConfigOptionsRoute,
  sessionsGetActiveRoute,
  sessionsGetAgentsRoute,
  sessionsGetAgentTransferImpactRoute,
  sessionsGetDisabledAgentToolsRoute,
  sessionsGetLightweightByIdsRoute,
  sessionsGetGenerationSettingsRoute,
  sessionsGetPermissionModeRoute,
  sessionsGetSearchResultsRoute,
  sessionsGetTapeContextRoute,
  sessionsGetUsageDashboardRoute,
  sessionsListLightweightRoute,
  sessionsListMessagesPageRoute,
  sessionsListRoute,
  sessionsListMessageTracesRoute,
  sessionsListPendingInputsRoute,
  sessionsMoveAgentSessionsRoute,
  sessionsMoveQueuedInputRoute,
  sessionsMoveToAgentRoute,
  sessionsQueuePendingInputRoute,
  sessionsRenameRoute,
  sessionsRetryRtkHealthCheckRoute,
  sessionsRetryMessageRoute,
  sessionsRestoreRoute,
  sessionsSearchHistoryRoute,
  sessionsSetAcpSessionConfigOptionRoute,
  sessionsSetModelRoute,
  sessionsSetPermissionModeRoute,
  sessionsSetProjectDirRoute,
  sessionsSetSubagentEnabledRoute,
  sessionsSteerPendingInputRoute,
  sessionsTogglePinnedRoute,
  sessionsTranslateTextRoute,
  sessionsUpdateDisabledAgentToolsRoute,
  sessionsUpdateGenerationSettingsRoute,
  sessionsUpdateQueuedInputRoute,
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
  systemOpenSettingsRoute,
  upgradeCheckRoute,
  upgradeClearMockRoute,
  upgradeGetStatusRoute,
  upgradeMockDownloadedRoute,
  upgradeOpenDownloadRoute,
  upgradeRestartToUpdateRoute,
  upgradeStartDownloadRoute,
  type DatabaseSecurityStatus,
  type SettingsActivityInput
} from '@shared/contracts/routes'
import { ChatService, type ChatServiceProjectionPort } from './chat/chatService'
import { dispatchConfigRoute } from './config/configRouteHandler'
import {
  completeGuidedOnboarding,
  readGuidedOnboardingState,
  resetGuidedOnboarding,
  setGuidedOnboardingStepStatus,
  startGuidedOnboarding
} from './onboarding/onboardingRouteSupport'
import { createNodeScheduler } from './scheduler'
import { createRouteRegistry, type DeepchatRouteMap, type RouteContext } from './routeRegistry'
import { createSettingsRouteAdapter } from './settings/settingsAdapter'
import { createSettingsRouteHandler } from './settings/settingsHandler'
import {
  SessionService,
  type SessionServiceDesktopPort,
  type SessionServiceProjectionPort
} from './sessions/sessionService'
import type { StartupWorkloadCoordinator } from '@/presenter/startupWorkloadCoordinator'
import type { DatabaseSecurityPresenter } from '@/presenter/databaseSecurityPresenter'
import type { SyncImportResult } from '@/presenter/syncPresenter'
import type { SessionPermissionPort } from '@/presenter/runtimePorts'
import { killTerminal, writeToTerminal } from '@/agent/acp/launch/acpInitHelper'
import type { UsageStatsService } from '@/presenter/usageStatsService'
import type { SessionHistorySearch } from './sessions/sessionHistorySearch'
import type { SessionTranslation } from './sessions/sessionTranslation'
import type { AgentSessionExportService } from '@/presenter/exporter/agentSessionExporter'
import { listAvailableAgents } from '@/agent/shared/availableAgentCatalog'
import type {
  SessionAgentAssignmentPort,
  SessionLifecyclePort,
  SessionTurnPort
} from '@/session/contracts'
import type { SessionQuery } from '@/session/query'

export type MainKernelRouteRuntime = {
  appDataReset: MainKernelAppDataResetPort
  appDatabaseMaintenance: MainKernelAppDatabaseMaintenancePort
  configPresenter: IConfigPresenter
  routeRegistry: DeepchatRouteMap
  sessionLifecyclePort: SessionLifecyclePort
  sessionProjectionPort: MainKernelSessionProjectionPort
  desktopSessionBinding: MainKernelDesktopSessionPort
  sessionTurnPort: SessionTurnPort
  sessionAssignmentPort: SessionAgentAssignmentPort
  exporter: IConversationExporter
  syncPresenter: ISyncPresenter
  upgradePresenter: IUpgradePresenter
  dialogPresenter: IDialogPresenter
  settingsHandler: ReturnType<typeof createSettingsRouteHandler>
  sqlitePresenter: ISQLitePresenter
  sessionService: SessionService
  chatService: ChatService
  windowPresenter: IWindowPresenter
  devicePresenter: IDevicePresenter
  ensureDefaultWorkspace(): Promise<string | null>
  startupWorkloadCoordinator: StartupWorkloadCoordinator
  databaseSecurityPresenter: DatabaseSecurityPresenter
  reconcileSchedulerAfterAgentChange(): Promise<void>
  usageStatsService: Pick<UsageStatsService, 'getDashboard'>
  rtkRuntimeService: { retryHealthCheck(): Promise<unknown> }
  sessionHistorySearch: Pick<SessionHistorySearch, 'search'>
  agentSessionExportService: Pick<AgentSessionExportService, 'export'>
  sessionTranslation: Pick<SessionTranslation, 'translate'>
}

export interface MainKernelAppDataResetPort {
  resetDataByType(resetType: 'chat' | 'knowledge' | 'config' | 'all'): Promise<void>
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

export type MainKernelSessionProjectionPort = SessionServiceProjectionPort &
  ChatServiceProjectionPort &
  Pick<
    SessionQuery,
    | 'listLightweight'
    | 'getLightweightByIds'
    | 'getSearchResults'
    | 'getTapeContext'
    | 'listMessageTraces'
    | 'listMessageViewManifests'
    | 'exportMessageTapeReplaySlice'
    | 'renameSession'
    | 'toggleSessionPinned'
  >

export interface MainKernelDesktopSessionPort extends SessionServiceDesktopPort {
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
  appDataReset: MainKernelAppDataResetPort
  appDatabaseMaintenance: MainKernelAppDatabaseMaintenancePort
  configPresenter: IConfigPresenter
  routeMaps: readonly DeepchatRouteMap[]
  sessionLifecyclePort: SessionLifecyclePort
  sessionProjectionPort: MainKernelSessionProjectionPort
  desktopSessionBinding: MainKernelDesktopSessionPort
  sessionTurnPort: SessionTurnPort
  sessionAssignmentPort: SessionAgentAssignmentPort
  sessionPermissionPort: Pick<SessionPermissionPort, 'clearSessionPermissions'>
  exporter: IConversationExporter
  syncPresenter: ISyncPresenter
  upgradePresenter: IUpgradePresenter
  dialogPresenter: IDialogPresenter
  sqlitePresenter?: ISQLitePresenter
  windowPresenter: IWindowPresenter
  devicePresenter: IDevicePresenter
  ensureDefaultWorkspace(): Promise<string | null>
  startupWorkloadCoordinator: StartupWorkloadCoordinator
  databaseSecurityPresenter: DatabaseSecurityPresenter
  reconcileSchedulerAfterAgentChange(): Promise<void>
  usageStatsService: Pick<UsageStatsService, 'getDashboard'>
  rtkRuntimeService: { retryHealthCheck(): Promise<unknown> }
  sessionHistorySearch: Pick<SessionHistorySearch, 'search'>
  agentSessionExportService: Pick<AgentSessionExportService, 'export'>
  sessionTranslation: Pick<SessionTranslation, 'translate'>
}): MainKernelRouteRuntime {
  const scheduler = createNodeScheduler()

  const sessionService = new SessionService({
    lifecycle: deps.sessionLifecyclePort,
    projection: deps.sessionProjectionPort,
    desktop: deps.desktopSessionBinding,
    scheduler
  })
  const chatService = new ChatService({
    turn: deps.sessionTurnPort,
    projection: deps.sessionProjectionPort,
    sessionPermissionPort: deps.sessionPermissionPort,
    scheduler
  })

  return {
    appDataReset: deps.appDataReset,
    appDatabaseMaintenance: deps.appDatabaseMaintenance,
    configPresenter: deps.configPresenter,
    routeRegistry: createRouteRegistry(deps.routeMaps),
    sessionLifecyclePort: deps.sessionLifecyclePort,
    sessionProjectionPort: deps.sessionProjectionPort,
    desktopSessionBinding: deps.desktopSessionBinding,
    sessionTurnPort: deps.sessionTurnPort,
    sessionAssignmentPort: deps.sessionAssignmentPort,
    exporter: deps.exporter,
    syncPresenter: deps.syncPresenter,
    upgradePresenter: deps.upgradePresenter,
    dialogPresenter: deps.dialogPresenter,
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
    sessionService,
    chatService,
    windowPresenter: deps.windowPresenter,
    devicePresenter: deps.devicePresenter,
    ensureDefaultWorkspace: deps.ensureDefaultWorkspace,
    startupWorkloadCoordinator: deps.startupWorkloadCoordinator,
    databaseSecurityPresenter: deps.databaseSecurityPresenter,
    reconcileSchedulerAfterAgentChange: deps.reconcileSchedulerAfterAgentChange,
    usageStatsService: deps.usageStatsService,
    rtkRuntimeService: deps.rtkRuntimeService,
    sessionHistorySearch: deps.sessionHistorySearch,
    agentSessionExportService: deps.agentSessionExportService,
    sessionTranslation: deps.sessionTranslation
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
  const getSettingsWindowId = (
    runtime.windowPresenter as IWindowPresenter & { getSettingsWindowId?: () => number | null }
  ).getSettingsWindowId

  if (context.windowId == null || typeof getSettingsWindowId !== 'function') {
    return false
  }

  return getSettingsWindowId.call(runtime.windowPresenter) === context.windowId
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
    case acpTerminalInputRoute.name: {
      const input = acpTerminalInputRoute.input.parse(rawInput)
      writeToTerminal(input.data)
      return acpTerminalInputRoute.output.parse({ sent: true })
    }

    case acpTerminalKillRoute.name: {
      acpTerminalKillRoute.input.parse(rawInput)
      killTerminal()
      return acpTerminalKillRoute.output.parse({ killed: true })
    }

    case deviceGetAppVersionRoute.name: {
      deviceGetAppVersionRoute.input.parse(rawInput)
      return deviceGetAppVersionRoute.output.parse({
        version: await runtime.devicePresenter.getAppVersion()
      })
    }

    case deviceGetInfoRoute.name: {
      deviceGetInfoRoute.input.parse(rawInput)
      return deviceGetInfoRoute.output.parse({
        info: await runtime.devicePresenter.getDeviceInfo()
      })
    }

    case deviceSelectDirectoryRoute.name: {
      deviceSelectDirectoryRoute.input.parse(rawInput)
      return deviceSelectDirectoryRoute.output.parse(
        await runtime.devicePresenter.selectDirectory()
      )
    }

    case deviceSelectFilesRoute.name: {
      const input = deviceSelectFilesRoute.input.parse(rawInput)
      return deviceSelectFilesRoute.output.parse(await runtime.devicePresenter.selectFiles(input))
    }

    case deviceRestartAppRoute.name: {
      deviceRestartAppRoute.input.parse(rawInput)
      await runtime.devicePresenter.restartApp()
      return deviceRestartAppRoute.output.parse({ restarted: true })
    }

    case deviceResetDataByTypeRoute.name: {
      const input = deviceResetDataByTypeRoute.input.parse(rawInput)
      await runtime.appDataReset.resetDataByType(input.resetType)
      return deviceResetDataByTypeRoute.output.parse({ reset: true })
    }

    case deviceSanitizeSvgRoute.name: {
      const input = deviceSanitizeSvgRoute.input.parse(rawInput)
      return deviceSanitizeSvgRoute.output.parse({
        content: await runtime.devicePresenter.sanitizeSvgContent(input.svgContent)
      })
    }

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

    case onboardingGetStateRoute.name: {
      onboardingGetStateRoute.input.parse(rawInput)
      const state = readGuidedOnboardingState(runtime.configPresenter)
      return onboardingGetStateRoute.output.parse({ state })
    }

    case onboardingStartRoute.name: {
      const input = onboardingStartRoute.input.parse(rawInput)
      const state = startGuidedOnboarding(runtime.configPresenter, input)
      return onboardingStartRoute.output.parse({ state })
    }

    case onboardingSetStepStatusRoute.name: {
      const input = onboardingSetStepStatusRoute.input.parse(rawInput)
      const state = setGuidedOnboardingStepStatus(runtime.configPresenter, input)
      return onboardingSetStepStatusRoute.output.parse({ state })
    }

    case onboardingCompleteRoute.name: {
      const input = onboardingCompleteRoute.input.parse(rawInput)
      const state = completeGuidedOnboarding(runtime.configPresenter, Date.now(), {
        force: input.force
      })
      return onboardingCompleteRoute.output.parse({ state })
    }

    case onboardingResetRoute.name: {
      onboardingResetRoute.input.parse(rawInput)
      const state = resetGuidedOnboarding(runtime.configPresenter)
      return onboardingResetRoute.output.parse({ state })
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
        const activeSessionId = runtime.desktopSessionBinding.getActiveId(context.webContentsId)
        const activeSession = activeSessionId
          ? ((await runtime.sessionProjectionPort.getLightweightByIds([activeSessionId]))[0] ??
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
          const activeSessionId = runtime.desktopSessionBinding.getActiveId(context.webContentsId)
          const activeSession = activeSessionId
            ? ((await runtime.sessionProjectionPort.getLightweightByIds([activeSessionId]))[0] ??
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

    case sessionsCreateRoute.name: {
      const input = sessionsCreateRoute.input.parse(rawInput)
      const session = await runtime.sessionService.createSession(input, context)
      return sessionsCreateRoute.output.parse({ session })
    }

    case sessionsRestoreRoute.name: {
      const input = sessionsRestoreRoute.input.parse(rawInput)
      const result = await runtime.sessionService.restoreSession(input.sessionId, input.limit)
      return sessionsRestoreRoute.output.parse(result)
    }

    case sessionsListMessagesPageRoute.name: {
      const input = sessionsListMessagesPageRoute.input.parse(rawInput)
      const page = await runtime.sessionService.listMessagesPage(input.sessionId, {
        cursor: input.cursor ?? null,
        limit: input.limit
      })
      return sessionsListMessagesPageRoute.output.parse(page)
    }

    case sessionsListRoute.name: {
      const input = sessionsListRoute.input.parse(rawInput)
      const sessions = await runtime.sessionService.listSessions(input)
      return sessionsListRoute.output.parse({ sessions })
    }

    case sessionsListLightweightRoute.name: {
      return await runTrackedRouteTask(runtime, routeName, context, async () => {
        const input = sessionsListLightweightRoute.input.parse(rawInput)
        const page = await runtime.sessionProjectionPort.listLightweight(input)
        return sessionsListLightweightRoute.output.parse(page)
      })
    }

    case sessionsGetLightweightByIdsRoute.name: {
      const input = sessionsGetLightweightByIdsRoute.input.parse(rawInput)
      const items = await runtime.sessionProjectionPort.getLightweightByIds(input.sessionIds)
      return sessionsGetLightweightByIdsRoute.output.parse({ items })
    }

    case sessionsActivateRoute.name: {
      const input = sessionsActivateRoute.input.parse(rawInput)
      await runtime.sessionService.activateSession(context, input.sessionId)
      return sessionsActivateRoute.output.parse({ activated: true })
    }

    case sessionsDeactivateRoute.name: {
      sessionsDeactivateRoute.input.parse(rawInput)
      await runtime.sessionService.deactivateSession(context)
      return sessionsDeactivateRoute.output.parse({ deactivated: true })
    }

    case sessionsGetActiveRoute.name: {
      sessionsGetActiveRoute.input.parse(rawInput)
      const session = await runtime.sessionService.getActiveSession(context)
      return sessionsGetActiveRoute.output.parse({ session })
    }

    case sessionsEnsureAcpDraftRoute.name: {
      const input = sessionsEnsureAcpDraftRoute.input.parse(rawInput)
      const session = await runtime.sessionLifecyclePort.ensureAcpDraftSession(input)
      return sessionsEnsureAcpDraftRoute.output.parse({ session })
    }

    case sessionsListPendingInputsRoute.name: {
      const input = sessionsListPendingInputsRoute.input.parse(rawInput)
      const items = await runtime.sessionTurnPort.listPendingInputs(input.sessionId)
      return sessionsListPendingInputsRoute.output.parse({ items })
    }

    case sessionsQueuePendingInputRoute.name: {
      const input = sessionsQueuePendingInputRoute.input.parse(rawInput)
      const item = await runtime.sessionTurnPort.queuePendingInput(input.sessionId, input.content)
      return sessionsQueuePendingInputRoute.output.parse({ item })
    }

    case sessionsUpdateQueuedInputRoute.name: {
      const input = sessionsUpdateQueuedInputRoute.input.parse(rawInput)
      const item = await runtime.sessionTurnPort.updateQueuedInput(
        input.sessionId,
        input.itemId,
        input.content
      )
      return sessionsUpdateQueuedInputRoute.output.parse({ item })
    }

    case sessionsMoveQueuedInputRoute.name: {
      const input = sessionsMoveQueuedInputRoute.input.parse(rawInput)
      const items = await runtime.sessionTurnPort.moveQueuedInput(
        input.sessionId,
        input.itemId,
        input.toIndex
      )
      return sessionsMoveQueuedInputRoute.output.parse({ items })
    }

    case sessionsConvertPendingInputToSteerRoute.name: {
      const input = sessionsConvertPendingInputToSteerRoute.input.parse(rawInput)
      const item = await runtime.sessionTurnPort.convertPendingInputToSteer(
        input.sessionId,
        input.itemId
      )
      return sessionsConvertPendingInputToSteerRoute.output.parse({ item })
    }

    case sessionsSteerPendingInputRoute.name: {
      const input = sessionsSteerPendingInputRoute.input.parse(rawInput)
      const item = await runtime.sessionTurnPort.steerPendingInput(input.sessionId, input.itemId)
      return sessionsSteerPendingInputRoute.output.parse({ item })
    }

    case sessionsDeletePendingInputRoute.name: {
      const input = sessionsDeletePendingInputRoute.input.parse(rawInput)
      await runtime.sessionTurnPort.deletePendingInput(input.sessionId, input.itemId)
      return sessionsDeletePendingInputRoute.output.parse({ deleted: true })
    }

    case sessionsRetryMessageRoute.name: {
      const input = sessionsRetryMessageRoute.input.parse(rawInput)
      await runtime.sessionTurnPort.retryMessage(input.sessionId, input.messageId)
      return sessionsRetryMessageRoute.output.parse({ retried: true })
    }

    case sessionsDeleteMessageRoute.name: {
      const input = sessionsDeleteMessageRoute.input.parse(rawInput)
      await runtime.sessionTurnPort.deleteMessage(input.sessionId, input.messageId)
      return sessionsDeleteMessageRoute.output.parse({ deleted: true })
    }

    case sessionsEditUserMessageRoute.name: {
      const input = sessionsEditUserMessageRoute.input.parse(rawInput)
      const message = await runtime.sessionTurnPort.editUserMessage(
        input.sessionId,
        input.messageId,
        input.text
      )
      return sessionsEditUserMessageRoute.output.parse({ message })
    }

    case sessionsForkRoute.name: {
      const input = sessionsForkRoute.input.parse(rawInput)
      const session = await runtime.sessionLifecyclePort.forkSession(
        input.sourceSessionId,
        input.targetMessageId,
        input.newTitle
      )
      return sessionsForkRoute.output.parse({ session })
    }

    case sessionsSearchHistoryRoute.name: {
      const input = sessionsSearchHistoryRoute.input.parse(rawInput)
      const hits = await runtime.sessionHistorySearch.search(input.query, input.options)
      return sessionsSearchHistoryRoute.output.parse({ hits })
    }

    case sessionsGetSearchResultsRoute.name: {
      const input = sessionsGetSearchResultsRoute.input.parse(rawInput)
      const results = await runtime.sessionProjectionPort.getSearchResults(
        input.messageId,
        input.searchId
      )
      return sessionsGetSearchResultsRoute.output.parse({ results })
    }

    case sessionsGetTapeContextRoute.name: {
      const input = sessionsGetTapeContextRoute.input.parse(rawInput)
      const context = await runtime.sessionProjectionPort.getTapeContext(
        input.sessionId,
        input.entryIds,
        input.options
      )
      return sessionsGetTapeContextRoute.output.parse({ context })
    }

    case sessionsListMessageTracesRoute.name: {
      const input = sessionsListMessageTracesRoute.input.parse(rawInput)
      const traces = await runtime.sessionProjectionPort.listMessageTraces(input.messageId)
      const manifests = await runtime.sessionProjectionPort.listMessageViewManifests(
        input.messageId
      )
      return sessionsListMessageTracesRoute.output.parse({ traces, manifests })
    }

    case sessionsExportMessageTapeReplaySliceRoute.name: {
      const input = sessionsExportMessageTapeReplaySliceRoute.input.parse(rawInput)
      const slice = await runtime.sessionProjectionPort.exportMessageTapeReplaySlice(
        input.messageId,
        input.options
      )
      return sessionsExportMessageTapeReplaySliceRoute.output.parse({ slice })
    }

    case sessionsTranslateTextRoute.name: {
      const input = sessionsTranslateTextRoute.input.parse(rawInput)
      const text = await runtime.sessionTranslation.translate(
        input.text,
        input.locale,
        input.agentId
      )
      return sessionsTranslateTextRoute.output.parse({ text })
    }

    case sessionsGetAgentsRoute.name: {
      sessionsGetAgentsRoute.input.parse(rawInput)
      const agents = await listAvailableAgents(runtime.configPresenter)
      return sessionsGetAgentsRoute.output.parse({ agents })
    }

    case sessionsGetUsageDashboardRoute.name: {
      sessionsGetUsageDashboardRoute.input.parse(rawInput)
      const dashboard = await runtime.usageStatsService.getDashboard()
      return sessionsGetUsageDashboardRoute.output.parse({ dashboard })
    }

    case sessionsRetryRtkHealthCheckRoute.name: {
      sessionsRetryRtkHealthCheckRoute.input.parse(rawInput)
      await runtime.rtkRuntimeService.retryHealthCheck()
      return sessionsRetryRtkHealthCheckRoute.output.parse({ retried: true })
    }

    case sessionsRenameRoute.name: {
      const input = sessionsRenameRoute.input.parse(rawInput)
      await runtime.sessionProjectionPort.renameSession(input.sessionId, input.title)
      return sessionsRenameRoute.output.parse({ updated: true })
    }

    case sessionsTogglePinnedRoute.name: {
      const input = sessionsTogglePinnedRoute.input.parse(rawInput)
      await runtime.sessionProjectionPort.toggleSessionPinned(input.sessionId, input.pinned)
      return sessionsTogglePinnedRoute.output.parse({ updated: true })
    }

    case sessionsClearMessagesRoute.name: {
      const input = sessionsClearMessagesRoute.input.parse(rawInput)
      await runtime.sessionTurnPort.clearSessionMessages(input.sessionId)
      return sessionsClearMessagesRoute.output.parse({ cleared: true })
    }

    case sessionsCompactRoute.name: {
      const input = sessionsCompactRoute.input.parse(rawInput)
      const result = await runtime.sessionTurnPort.compactSession(input.sessionId)
      return sessionsCompactRoute.output.parse(result)
    }

    case sessionsExportRoute.name: {
      const input = sessionsExportRoute.input.parse(rawInput)
      const result = await runtime.agentSessionExportService.export(input.sessionId, input.format)
      return sessionsExportRoute.output.parse(result)
    }

    case sessionsDeleteRoute.name: {
      const input = sessionsDeleteRoute.input.parse(rawInput)
      await runtime.sessionLifecyclePort.deleteSession(input.sessionId)
      return sessionsDeleteRoute.output.parse({ deleted: true })
    }

    case sessionsGetAgentTransferImpactRoute.name: {
      const input = sessionsGetAgentTransferImpactRoute.input.parse(rawInput)
      const impact = await runtime.sessionAssignmentPort.getAgentTransferImpact(input.agentId)
      return sessionsGetAgentTransferImpactRoute.output.parse({ impact })
    }

    case sessionsMoveAgentSessionsRoute.name: {
      const input = sessionsMoveAgentSessionsRoute.input.parse(rawInput)
      const result = await runtime.sessionAssignmentPort.moveAgentSessions(
        input.fromAgentId,
        input.toAgentId
      )
      return sessionsMoveAgentSessionsRoute.output.parse(result)
    }

    case sessionsDeleteAgentSessionsRoute.name: {
      const input = sessionsDeleteAgentSessionsRoute.input.parse(rawInput)
      const deletedSessionIds = await runtime.sessionAssignmentPort.deleteAgentSessions(
        input.agentId
      )
      return sessionsDeleteAgentSessionsRoute.output.parse({ deletedSessionIds })
    }

    case sessionsMoveToAgentRoute.name: {
      const input = sessionsMoveToAgentRoute.input.parse(rawInput)
      const session = await runtime.sessionAssignmentPort.moveSessionToAgent(
        input.sessionId,
        input.toAgentId
      )
      return sessionsMoveToAgentRoute.output.parse({ session })
    }

    case sessionsGetAcpSessionCommandsRoute.name: {
      const input = sessionsGetAcpSessionCommandsRoute.input.parse(rawInput)
      const commands = await runtime.sessionAssignmentPort.getAcpSessionCommands(input.sessionId)
      return sessionsGetAcpSessionCommandsRoute.output.parse({ commands })
    }

    case sessionsGetAcpSessionConfigOptionsRoute.name: {
      const input = sessionsGetAcpSessionConfigOptionsRoute.input.parse(rawInput)
      const state = await runtime.sessionAssignmentPort.getAcpSessionConfigOptions(input.sessionId)
      return sessionsGetAcpSessionConfigOptionsRoute.output.parse({ state })
    }

    case sessionsSetAcpSessionConfigOptionRoute.name: {
      const input = sessionsSetAcpSessionConfigOptionRoute.input.parse(rawInput)
      const state = await runtime.sessionAssignmentPort.setAcpSessionConfigOption(
        input.sessionId,
        input.configId,
        input.value
      )
      return sessionsSetAcpSessionConfigOptionRoute.output.parse({ state })
    }

    case sessionsGetPermissionModeRoute.name: {
      const input = sessionsGetPermissionModeRoute.input.parse(rawInput)
      const mode = await runtime.sessionAssignmentPort.getPermissionMode(input.sessionId)
      return sessionsGetPermissionModeRoute.output.parse({ mode })
    }

    case sessionsSetPermissionModeRoute.name: {
      const input = sessionsSetPermissionModeRoute.input.parse(rawInput)
      await runtime.sessionAssignmentPort.setPermissionMode(input.sessionId, input.mode)
      return sessionsSetPermissionModeRoute.output.parse({ updated: true })
    }

    case sessionsSetSubagentEnabledRoute.name: {
      const input = sessionsSetSubagentEnabledRoute.input.parse(rawInput)
      const session = await runtime.sessionAssignmentPort.setSessionSubagentEnabled(
        input.sessionId,
        input.enabled
      )
      return sessionsSetSubagentEnabledRoute.output.parse({ session })
    }

    case sessionsSetModelRoute.name: {
      const input = sessionsSetModelRoute.input.parse(rawInput)
      const session = await runtime.sessionAssignmentPort.setSessionModel(
        input.sessionId,
        input.providerId,
        input.modelId
      )
      return sessionsSetModelRoute.output.parse({ session })
    }

    case sessionsSetProjectDirRoute.name: {
      const input = sessionsSetProjectDirRoute.input.parse(rawInput)
      const session = await runtime.sessionAssignmentPort.setSessionProjectDir(
        input.sessionId,
        input.projectDir
      )
      return sessionsSetProjectDirRoute.output.parse({ session })
    }

    case sessionsGetGenerationSettingsRoute.name: {
      const input = sessionsGetGenerationSettingsRoute.input.parse(rawInput)
      const settings = await runtime.sessionAssignmentPort.getSessionGenerationSettings(
        input.sessionId
      )
      return sessionsGetGenerationSettingsRoute.output.parse({ settings })
    }

    case sessionsGetDisabledAgentToolsRoute.name: {
      const input = sessionsGetDisabledAgentToolsRoute.input.parse(rawInput)
      const disabledAgentTools = await runtime.sessionAssignmentPort.getSessionDisabledAgentTools(
        input.sessionId
      )
      return sessionsGetDisabledAgentToolsRoute.output.parse({ disabledAgentTools })
    }

    case sessionsUpdateDisabledAgentToolsRoute.name: {
      const input = sessionsUpdateDisabledAgentToolsRoute.input.parse(rawInput)
      const disabledAgentTools =
        await runtime.sessionAssignmentPort.updateSessionDisabledAgentTools(
          input.sessionId,
          input.disabledAgentTools
        )
      return sessionsUpdateDisabledAgentToolsRoute.output.parse({ disabledAgentTools })
    }

    case sessionsUpdateGenerationSettingsRoute.name: {
      const input = sessionsUpdateGenerationSettingsRoute.input.parse(rawInput)
      const settings = await runtime.sessionAssignmentPort.updateSessionGenerationSettings(
        input.sessionId,
        input.settings
      )
      return sessionsUpdateGenerationSettingsRoute.output.parse({ settings })
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

    case upgradeGetStatusRoute.name: {
      upgradeGetStatusRoute.input.parse(rawInput)
      const snapshot = runtime.upgradePresenter.getUpdateStatus()
      return upgradeGetStatusRoute.output.parse({ snapshot })
    }

    case upgradeCheckRoute.name: {
      const input = upgradeCheckRoute.input.parse(rawInput)
      await runtime.upgradePresenter.checkUpdate(input.type)
      return upgradeCheckRoute.output.parse({ checked: true })
    }

    case upgradeOpenDownloadRoute.name: {
      const input = upgradeOpenDownloadRoute.input.parse(rawInput)
      await runtime.upgradePresenter.goDownloadUpgrade(input.type)
      return upgradeOpenDownloadRoute.output.parse({ opened: true })
    }

    case upgradeStartDownloadRoute.name: {
      upgradeStartDownloadRoute.input.parse(rawInput)
      const started = runtime.upgradePresenter.startDownloadUpdate()
      return upgradeStartDownloadRoute.output.parse({ started })
    }

    case upgradeMockDownloadedRoute.name: {
      upgradeMockDownloadedRoute.input.parse(rawInput)
      const updated = runtime.upgradePresenter.mockDownloadedUpdate()
      return upgradeMockDownloadedRoute.output.parse({ updated })
    }

    case upgradeClearMockRoute.name: {
      upgradeClearMockRoute.input.parse(rawInput)
      const updated = runtime.upgradePresenter.clearMockUpdate()
      return upgradeClearMockRoute.output.parse({ updated })
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

    case upgradeRestartToUpdateRoute.name: {
      upgradeRestartToUpdateRoute.input.parse(rawInput)
      const restarted = runtime.upgradePresenter.restartToUpdate()
      return upgradeRestartToUpdateRoute.output.parse({ restarted })
    }

    case dialogRespondRoute.name: {
      const input = dialogRespondRoute.input.parse(rawInput)
      await runtime.dialogPresenter.handleDialogResponse(input)
      return dialogRespondRoute.output.parse({ handled: true })
    }

    case dialogErrorRoute.name: {
      const input = dialogErrorRoute.input.parse(rawInput)
      await runtime.dialogPresenter.handleDialogError(input.id)
      return dialogErrorRoute.output.parse({ handled: true })
    }

    case chatSendMessageRoute.name: {
      const input = chatSendMessageRoute.input.parse(rawInput)
      return chatSendMessageRoute.output.parse(
        await runtime.chatService.sendMessage(input.sessionId, input.content)
      )
    }

    case chatSteerActiveTurnRoute.name: {
      const input = chatSteerActiveTurnRoute.input.parse(rawInput)
      return chatSteerActiveTurnRoute.output.parse(
        await runtime.chatService.steerActiveTurn(input.sessionId, input.content)
      )
    }

    case chatStopStreamRoute.name: {
      const input = chatStopStreamRoute.input.parse(rawInput)
      return chatStopStreamRoute.output.parse(await runtime.chatService.stopStream(input))
    }

    case chatRespondToolInteractionRoute.name: {
      const input = chatRespondToolInteractionRoute.input.parse(rawInput)
      return chatRespondToolInteractionRoute.output.parse(
        await runtime.chatService.respondToolInteraction(input)
      )
    }

    case systemOpenSettingsRoute.name: {
      const input = systemOpenSettingsRoute.input.parse(rawInput)
      const navigation =
        input.routeName || input.params || input.section
          ? {
              routeName: input.routeName ?? 'settings-common',
              params: input.params,
              section: input.section
            }
          : undefined

      const windowId = await runtime.windowPresenter.createSettingsWindow(navigation)
      return systemOpenSettingsRoute.output.parse({ windowId })
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
