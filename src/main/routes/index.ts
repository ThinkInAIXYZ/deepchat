import { BrowserWindow, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import type {
  IAgentSessionPresenter,
  IConfigPresenter,
  IConversationExporter,
  IDevicePresenter,
  IDialogPresenter,
  IFilePresenter,
  IKnowledgePresenter,
  ILlmProviderPresenter,
  IMCPPresenter,
  IOAuthPresenter,
  IProjectPresenter,
  IRemoteControlPresenter,
  ISQLitePresenter,
  IShortcutPresenter,
  ISkillSyncPresenter,
  ISkillPresenter,
  ISyncPresenter,
  ITabPresenter,
  IToolPresenter,
  IUpgradePresenter,
  IWindowPresenter,
  IWorkspacePresenter,
  IYoBrowserPresenter
} from '@shared/presenter'
import { DEEPCHAT_ROUTE_INVOKE_CHANNEL } from '@shared/contracts/channels'
import { projectEnvironmentsChangedEvent } from '@shared/contracts/events'
import { isAgentMemoryCategory } from '@shared/types/agent-memory'
import { DEV_EVENTS } from '../events'
import { publishDeepchatEvent } from './publishDeepchatEvent'
import {
  acpTerminalInputRoute,
  acpTerminalKillRoute,
  browserAttachCurrentWindowRoute,
  browserClearSandboxDataRoute,
  browserDestroyRoute,
  browserDetachRoute,
  browserGetStatusRoute,
  browserGoBackRoute,
  browserGoForwardRoute,
  browserLoadUrlRoute,
  browserReloadRoute,
  browserUpdateCurrentWindowBoundsRoute,
  chatRespondToolInteractionRoute,
  chatSendMessageRoute,
  chatSteerActiveTurnRoute,
  chatStopStreamRoute,
  configAddCustomPromptRoute,
  configAddSystemPromptRoute,
  configClearDefaultSystemPromptRoute,
  configDeleteCustomPromptRoute,
  configDeleteSystemPromptRoute,
  configResetDefaultSystemPromptRoute,
  configResetShortcutKeysRoute,
  configSetAcpSharedMcpSelectionsRoute,
  configSetCustomPromptsRoute,
  configSetDefaultSystemPromptIdRoute,
  configSetDefaultSystemPromptRoute,
  configSetKnowledgeConfigsRoute,
  configSetSystemPromptsRoute,
  configUpdateCustomPromptRoute,
  configUpdateSystemPromptRoute,
  databaseSecurityChangePasswordRoute,
  databaseSecurityDisableRoute,
  databaseSecurityEnableRoute,
  databaseSecurityGetStatusRoute,
  databaseSecurityRepairSchemaRoute,
  memoryAddRoute,
  memoryApprovePersonaDraftRoute,
  memoryClearRoute,
  memoryDeleteRoute,
  memoryGetSourceSpanRoute,
  memoryGetHealthRoute,
  memoryGetArchiveCandidateLifecyclePreviewRoute,
  memoryGetLifecycleRoute,
  memoryGetStatusRoute,
  memoryListAuditEventsRoute,
  memoryListConflictsRoute,
  memoryListPersonaDraftsRoute,
  memoryListPersonaVersionsRoute,
  memoryListRoute,
  memoryListViewManifestsRoute,
  memoryRejectPersonaDraftRoute,
  memoryResolveConflictRoute,
  memoryRestoreRoute,
  memoryRollbackPersonaRoute,
  memorySearchRoute,
  memorySetPersonaAnchorRoute,
  dialogErrorRoute,
  dialogRespondRoute,
  deviceGetAppVersionRoute,
  deviceGetInfoRoute,
  deviceRestartAppRoute,
  deviceResetDataByTypeRoute,
  deviceSanitizeSvgRoute,
  deviceSelectDirectoryRoute,
  deviceSelectFilesRoute,
  fileCopyImageRoute,
  fileGetMimeTypeRoute,
  fileIsDirectoryRoute,
  filePrepareDirectoryRoute,
  filePrepareFileRoute,
  fileReadFileRoute,
  fileSaveImageRoute,
  fileWriteImageBase64Route,
  hasDeepchatRouteContract,
  knowledgeAddFileRoute,
  knowledgeDeleteFileRoute,
  knowledgeGetSeparatorsForLanguageRoute,
  knowledgeGetSupportedFileExtensionsRoute,
  knowledgeGetSupportedLanguagesRoute,
  knowledgeIsSupportedRoute,
  knowledgeListFilesRoute,
  knowledgePauseAllRunningTasksRoute,
  knowledgeReAddFileRoute,
  knowledgeResumeAllPausedTasksRoute,
  knowledgeSimilarityQueryRoute,
  knowledgeValidateFileRoute,
  mcpAddServerRoute,
  mcpCallToolRoute,
  mcpCancelSamplingRequestRoute,
  mcpClearNpmRegistryCacheRoute,
  mcpGetClientsRoute,
  mcpGetEnabledRoute,
  mcpGetNpmRegistryStatusRoute,
  mcpGetPromptRoute,
  mcpGetServersRoute,
  mcpIsServerRunningRoute,
  mcpListPromptsRoute,
  mcpListResourcesRoute,
  mcpListToolDefinitionsRoute,
  mcpReadResourceRoute,
  mcpRefreshNpmRegistryRoute,
  mcpRemoveServerRoute,
  mcpRouterGetApiKeyRoute,
  mcpRouterInstallServerRoute,
  mcpRouterIsServerInstalledRoute,
  mcpRouterListServersRoute,
  mcpRouterSetApiKeyRoute,
  mcpRouterUpdateServersAuthRoute,
  mcpSetAutoDetectNpmRegistryRoute,
  mcpSetCustomNpmRegistryRoute,
  mcpSetEnabledRoute,
  mcpSetServerEnabledRoute,
  mcpStartServerRoute,
  mcpStopServerRoute,
  mcpSubmitSamplingDecisionRoute,
  mcpUpdateServerRoute,
  modelsGetProviderCatalogRoute,
  onboardingCompleteRoute,
  onboardingGetStateRoute,
  onboardingResetRoute,
  onboardingSetStepStatusRoute,
  onboardingStartRoute,
  nowledgeMemGetConfigRoute,
  nowledgeMemTestConnectionRoute,
  nowledgeMemUpdateConfigRoute,
  oauthGithubCopilotStartDeviceFlowLoginRoute,
  oauthGithubCopilotStartLoginRoute,
  oauthOpenAICodexCancelLoginRoute,
  oauthOpenAICodexGetStatusRoute,
  oauthOpenAICodexLogoutRoute,
  oauthOpenAICodexStartBrowserLoginRoute,
  remoteControlCancelFeishuAuthRoute,
  remoteControlCancelFeishuInstallRoute,
  remoteControlClearChannelPairCodeRoute,
  remoteControlCreateChannelPairCodeRoute,
  remoteControlGetChannelBindingsRoute,
  remoteControlGetChannelPairingSnapshotRoute,
  remoteControlGetChannelSettingsRoute,
  remoteControlGetChannelStatusRoute,
  remoteControlGetTelegramStatusRoute,
  remoteControlGetWeixinIlinkStatusRoute,
  remoteControlListChannelsRoute,
  remoteControlRemoveChannelBindingRoute,
  remoteControlRemoveChannelPrincipalRoute,
  remoteControlRemoveWeixinIlinkAccountRoute,
  remoteControlRestartWeixinIlinkAccountRoute,
  remoteControlSaveChannelSettingsRoute,
  remoteControlStartFeishuAuthRoute,
  remoteControlStartFeishuInstallRoute,
  remoteControlStartWeixinIlinkLoginRoute,
  remoteControlWaitForFeishuAuthRoute,
  remoteControlWaitForFeishuInstallRoute,
  remoteControlWaitForWeixinIlinkLoginRoute,
  pluginsDisableRoute,
  pluginsEnableRoute,
  pluginsGetRoute,
  pluginsInvokeActionRoute,
  pluginsListRoute,
  projectArchiveEnvironmentRoute,
  projectListEnvironmentsRoute,
  projectListRecentRoute,
  projectOpenDirectoryRoute,
  projectPathExistsRoute,
  projectRemoveEnvironmentRoute,
  projectReorderEnvironmentsRoute,
  projectRestoreEnvironmentRoute,
  projectSelectDirectoryRoute,
  modelsSetBatchStatusRoute,
  modelsSetStatusRoute,
  providersAddRoute,
  providersListModelsRoute,
  providersListOllamaModelsRoute,
  providersListOllamaRunningModelsRoute,
  providersListSummariesRoute,
  providersRefreshModelsRoute,
  providersRemoveRoute,
  providersTestConnectionRoute,
  providersUpdateRoute,
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
  shortcutDestroyRoute,
  shortcutRegisterRoute,
  shortcutUnregisterRoute,
  startupGetBootstrapRoute,
  skillsGetActiveRoute,
  skillsGetDirectoryRoute,
  skillsGetExtensionRoute,
  skillsGetFolderTreeRoute,
  skillsGetSyncConfigRoute,
  skillsExecuteSyncDirectoryExportRoute,
  skillsExecuteSyncDirectoryImportRoute,
  skillsInstallFromGitRoute,
  skillsInstallFromFolderRoute,
  skillsInstallFromUrlRoute,
  skillsInstallFromZipRoute,
  skillsListCatalogRoute,
  skillsListMetadataRoute,
  skillsListScriptsRoute,
  skillsOpenFolderRoute,
  skillsPreviewSyncDirectoryExportRoute,
  skillsPreviewSyncDirectoryImportRoute,
  skillsReadFileRoute,
  skillsScanGitRepoRoute,
  skillsSaveExtensionRoute,
  skillsSaveWithExtensionRoute,
  skillsSetActiveRoute,
  skillsSetDisabledRoute,
  skillsSetSyncDirectoryRoute,
  skillsUninstallRoute,
  skillsUpdateFileRoute,
  skillSyncAcknowledgeDiscoveriesRoute,
  skillSyncExecuteAdoptAgentSkillRoute,
  skillSyncExecuteExportRoute,
  skillSyncExecuteImportRoute,
  skillSyncExecuteLinkDeepChatSkillsRoute,
  skillSyncGetAgentDetailRoute,
  skillSyncGetAgentSkillDetailRoute,
  skillSyncGetNewDiscoveriesRoute,
  skillSyncGetRegisteredToolsRoute,
  skillSyncPreviewAdoptAgentSkillRoute,
  skillSyncPreviewExportRoute,
  skillSyncPreviewImportRoute,
  skillSyncPreviewLinkDeepChatSkillsRoute,
  skillSyncRemoveAgentSkillLinkRoute,
  skillSyncRepairAgentSkillLinkRoute,
  skillSyncScanAgentsRoute,
  skillSyncScanExternalToolsRoute,
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
  tabCaptureCurrentAreaRoute,
  tabNotifyRendererActivatedRoute,
  tabNotifyRendererReadyRoute,
  tabStitchImagesWithWatermarkRoute,
  toolsListDefinitionsRoute,
  upgradeCheckRoute,
  upgradeClearMockRoute,
  upgradeGetStatusRoute,
  upgradeMockDownloadedRoute,
  upgradeOpenDownloadRoute,
  upgradeRestartToUpdateRoute,
  upgradeStartDownloadRoute,
  windowCloseCurrentRoute,
  windowCloseFloatingCurrentRoute,
  windowCloseSettingsRoute,
  windowConsumePendingSettingsProviderInstallRoute,
  windowFocusMainRoute,
  windowGetCurrentStateRoute,
  windowGetRuntimeIdentityRoute,
  windowMinimizeCurrentRoute,
  windowNotifySettingsReadyRoute,
  windowPreviewFileRoute,
  windowRequeuePendingSettingsProviderInstallRoute,
  windowStartGuidedOnboardingRoute,
  windowToggleMaximizeCurrentRoute,
  workspaceExpandDirectoryRoute,
  workspaceGetGitDiffRoute,
  workspaceGetGitStatusRoute,
  workspaceOpenFileRoute,
  workspaceReadDirectoryRoute,
  workspaceReadFilePreviewRoute,
  workspaceRegisterRoute,
  workspaceResolveMarkdownLinkedFileRoute,
  workspaceRevealFileInFolderRoute,
  workspaceSearchFilesRoute,
  workspaceUnregisterRoute,
  workspaceUnwatchRoute,
  workspaceWatchRoute,
  type SettingsActivityInput
} from '@shared/contracts/routes'
import {
  createEmptyArchiveCandidateLifecyclePreview,
  createEmptyMemoryHealth
} from '@shared/contracts/routes/memory.routes'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import { buildEffectiveTapeView } from '../presenter/agentRuntimePresenter/tapeEffectiveView'
import { ChatService } from './chat/chatService'
import { dispatchConfigRoute } from './config/configRouteHandler'
import { createPresenterHotPathPorts } from './hotPathPorts'
import { dispatchModelRoute } from './models/modelRouteHandler'
import {
  completeGuidedOnboarding,
  readGuidedOnboardingState,
  resetGuidedOnboarding,
  setGuidedOnboardingStepStatus,
  startGuidedOnboarding
} from './onboarding/onboardingRouteSupport'
import { dispatchProviderRoute } from './providers/providerRouteHandler'
import { createNodeScheduler } from './scheduler'
import { ProviderImportService } from './providers/providerImportService'
import { ProviderService } from './providers/providerService'
import { createSettingsRouteAdapter } from './settings/settingsAdapter'
import { createSettingsRouteHandler } from './settings/settingsHandler'
import { SessionService } from './sessions/sessionService'
import type { StartupWorkloadCoordinator } from '@/presenter/startupWorkloadCoordinator'
import type { PluginPresenter } from '@/presenter/pluginPresenter'
import type { DatabaseSecurityPresenter } from '@/presenter/databaseSecurityPresenter'
import type { MemoryPresenter } from '@/presenter/memoryPresenter'
import type { MemoryWriteOutcome } from '@/presenter/memoryPresenter/types'
import type { AgentMemoryRow } from '@/presenter/sqlitePresenter/tables/agentMemory'
import type { AgentMemoryAuditRow } from '@/presenter/sqlitePresenter/tables/agentMemoryAudit'
import type { DeepChatTapeEntryRow } from '@/presenter/sqlitePresenter/tables/deepchatTapeEntries'
import type { SQLitePresenter } from '@/presenter/sqlitePresenter'
import type { ScheduledTasksService } from '@/presenter/scheduledTasks'
import { killTerminal, writeToTerminal } from '@/presenter/configPresenter/acpInitHelper'
import {
  scheduledTasksDeleteRoute,
  scheduledTasksFireNowRoute,
  scheduledTasksListRoute,
  scheduledTasksToggleRoute,
  scheduledTasksUpsertRoute
} from '@shared/contracts/routes/scheduledTasks.routes'

const MEMORY_PERSONA_STATES = ['draft', 'active', 'superseded', 'rejected'] as const
type MemoryPersonaState = (typeof MEMORY_PERSONA_STATES)[number]
const MEMORY_PERSONA_STATE_SET: ReadonlySet<string> = new Set(MEMORY_PERSONA_STATES)

export type MainKernelRouteRuntime = {
  configPresenter: IConfigPresenter
  llmProviderPresenter: ILlmProviderPresenter
  agentSessionPresenter: IAgentSessionPresenter
  skillPresenter: ISkillPresenter
  skillSyncPresenter: ISkillSyncPresenter
  exporter: IConversationExporter
  oauthPresenter: IOAuthPresenter
  mcpPresenter: IMCPPresenter
  remoteControlPresenter: IRemoteControlPresenter
  shortcutPresenter: IShortcutPresenter
  syncPresenter: ISyncPresenter
  upgradePresenter: IUpgradePresenter
  dialogPresenter: IDialogPresenter
  toolPresenter: IToolPresenter
  settingsHandler: ReturnType<typeof createSettingsRouteHandler>
  sqlitePresenter: ISQLitePresenter
  sessionService: SessionService
  chatService: ChatService
  providerService: ProviderService
  providerImportService: ProviderImportService
  windowPresenter: IWindowPresenter
  devicePresenter: IDevicePresenter
  projectPresenter: IProjectPresenter
  filePresenter: IFilePresenter
  knowledgePresenter: IKnowledgePresenter
  workspacePresenter: IWorkspacePresenter
  yoBrowserPresenter: IYoBrowserPresenter
  tabPresenter: ITabPresenter
  startupWorkloadCoordinator: StartupWorkloadCoordinator
  pluginPresenter: PluginPresenter
  databaseSecurityPresenter: DatabaseSecurityPresenter
  memoryPresenter: MemoryPresenter
  scheduledTasks: ScheduledTasksService
}

function parseSourceEntryIds(raw: string | null): number[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const ids = parsed.filter((v): v is number => Number.isInteger(v) && v >= 0)
    return ids.length ? ids : null
  } catch {
    return null
  }
}

export function formatMemorySourceRecordContent(record: ChatMessageRecord): string {
  try {
    const parsed = JSON.parse(record.content) as unknown
    if (record.role === 'user') {
      const text = (parsed as { text?: unknown })?.text
      return typeof text === 'string' ? text.trim() : ''
    }
    const blockText = (block: unknown): string => {
      const b = block as {
        type?: string
        content?: unknown
      }
      if (b?.type === 'content' && typeof b.content === 'string') return b.content
      return ''
    }
    if (Array.isArray(parsed)) {
      return parsed.map(blockText).filter(Boolean).join(' ').trim()
    }
    const objectText = blockText(parsed)
    return objectText.trim()
  } catch {
    return ''
  }
}

function normalizeMemoryPersonaState(value: unknown): MemoryPersonaState | null {
  if (typeof value === 'string' && MEMORY_PERSONA_STATE_SET.has(value)) {
    return value as MemoryPersonaState
  }
  return null
}

function normalizeMemoryCategory(value: unknown) {
  return isAgentMemoryCategory(value) ? value : null
}

export function toMemoryItemDto(row: AgentMemoryRow) {
  return {
    id: row.id,
    agentId: row.agent_id,
    kind: row.kind,
    category: normalizeMemoryCategory(row.category),
    content: row.content,
    importance: row.importance,
    status: row.status,
    sourceSession: row.source_session,
    sourceEntryIds: parseSourceEntryIds(row.source_entry_ids),
    supersededBy: row.superseded_by,
    createdAt: row.created_at,
    confidence: row.confidence,
    conflictState: row.conflict_state,
    conflictWith: row.conflict_with,
    personaState: normalizeMemoryPersonaState(row.persona_state),
    isAnchor: row.is_anchor === 1
  }
}

function toMemoryAddResultDto(outcome: MemoryWriteOutcome) {
  switch (outcome.action) {
    case 'created':
      return { action: 'created' as const, memoryId: outcome.id }
    case 'updated':
      return { action: 'updated' as const, memoryId: outcome.id }
    case 'superseded':
      return {
        action: 'superseded' as const,
        memoryId: outcome.id,
        supersededId: outcome.supersededId
      }
    case 'challenged':
      return {
        action: 'challenged' as const,
        memoryId: outcome.challengerId,
        conflictWith: outcome.targetId
      }
    case 'noop':
      return { action: 'noop' as const, reason: outcome.reason }
  }
}

function parseJsonRecord(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {}
  return {}
}

function sanitizeRouteRefs(record: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {}
  const safeKey = /(id|ids|type|status|action|reason|policy|seq|count|hash)$/i
  for (const [key, value] of Object.entries(record)) {
    if (safeKey.test(key) || key === 'createdAt' || key === 'updatedAt') {
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        value === null
      ) {
        safe[key] = value
      } else if (Array.isArray(value)) {
        safe[key] = value.filter(
          (item) =>
            typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
        )
      } else {
        safe[key] = '{...}'
      }
    } else if (Array.isArray(value)) {
      safe[key] = `[${value.length}]`
    } else if (value && typeof value === 'object') {
      safe[key] = '{...}'
    } else if (value !== undefined) {
      safe[key] = '[redacted]'
    }
  }
  return safe
}

function toMemoryAuditEventDto(row: AgentMemoryAuditRow) {
  return {
    id: row.id,
    agentId: row.agent_id,
    eventType: row.event_type,
    actorType: row.actor_type,
    sessionId: row.session_id,
    inputRefs: sanitizeRouteRefs(parseJsonRecord(row.input_refs_json)),
    outputRefs: sanitizeRouteRefs(parseJsonRecord(row.output_refs_json)),
    modelProviderId: row.model_provider_id,
    modelId: row.model_id,
    status: row.status,
    reason: row.reason,
    createdAt: row.created_at
  }
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function toMemoryViewManifestDto(row: DeepChatTapeEntryRow) {
  const payload = parseJsonRecord(row.payload_json)
  const meta = parseJsonRecord(row.meta_json)
  const state = payload.state
  const manifest =
    state && typeof state === 'object' && !Array.isArray(state)
      ? (state as Record<string, unknown>)
      : null
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return null
  }
  const record = manifest as Record<string, unknown>
  const messageId = typeof meta.messageId === 'string' ? meta.messageId : null
  return {
    sessionId: row.session_id,
    messageId,
    entryId: row.entry_id,
    policyVersion:
      typeof record.policyVersion === 'number' && Number.isFinite(record.policyVersion)
        ? record.policyVersion
        : null,
    tokenBudget: readNumber(record.tokenBudget),
    estimatedTokens: readNumber(record.estimatedTokens),
    selectedCount: Array.isArray(record.selected) ? record.selected.length : 0,
    droppedCount: Array.isArray(record.dropped) ? record.dropped.length : 0,
    queryHash: typeof record.queryHash === 'string' ? record.queryHash : null,
    createdAt: row.created_at
  }
}

function getMemorySourceSpan(runtime: MainKernelRouteRuntime, agentId: string, memoryId: string) {
  const row = runtime.memoryPresenter.listMemories(agentId).find((memory) => memory.id === memoryId)
  if (!row || row.agent_id !== agentId || !row.source_session) return null
  const sourceEntryIds = parseSourceEntryIds(row.source_entry_ids)
  if (!sourceEntryIds?.length) return null
  const sourceSet = new Set(sourceEntryIds)
  const tapeEntriesTable = getMemorySourceTapeEntriesTable(runtime)
  if (!tapeEntriesTable) return null
  const rows = tapeEntriesTable.getBySession(row.source_session)
  const entries = buildEffectiveTapeView(rows)
    .messageEntries.filter((entry) => sourceSet.has(entry.entryId))
    .map((entry) => ({
      entryId: entry.entryId,
      role: entry.record.role,
      content: formatMemorySourceRecordContent(entry.record),
      orderSeq: entry.record.orderSeq
    }))
    .filter((entry) => entry.content.length > 0)
  if (!entries.length) return null
  return { sessionId: row.source_session, entries }
}

export function createMainKernelRouteRuntime(deps: {
  configPresenter: IConfigPresenter
  llmProviderPresenter: ILlmProviderPresenter
  agentSessionPresenter: IAgentSessionPresenter
  skillPresenter: ISkillPresenter
  skillSyncPresenter: ISkillSyncPresenter
  exporter: IConversationExporter
  oauthPresenter: IOAuthPresenter
  mcpPresenter: IMCPPresenter
  remoteControlPresenter: IRemoteControlPresenter
  shortcutPresenter: IShortcutPresenter
  syncPresenter: ISyncPresenter
  upgradePresenter: IUpgradePresenter
  dialogPresenter: IDialogPresenter
  toolPresenter: IToolPresenter
  sqlitePresenter?: ISQLitePresenter
  windowPresenter: IWindowPresenter
  devicePresenter: IDevicePresenter
  projectPresenter: IProjectPresenter
  filePresenter: IFilePresenter
  knowledgePresenter: IKnowledgePresenter
  workspacePresenter: IWorkspacePresenter
  yoBrowserPresenter: IYoBrowserPresenter
  tabPresenter: ITabPresenter
  startupWorkloadCoordinator: StartupWorkloadCoordinator
  pluginPresenter: PluginPresenter
  databaseSecurityPresenter: DatabaseSecurityPresenter
  memoryPresenter: MemoryPresenter
  scheduledTasks: ScheduledTasksService
}): MainKernelRouteRuntime {
  const scheduler = createNodeScheduler()
  const hotPathPorts = createPresenterHotPathPorts({
    agentSessionPresenter: deps.agentSessionPresenter as IAgentSessionPresenter & {
      clearSessionPermissions: (sessionId: string) => void | Promise<void>
    },
    configPresenter: deps.configPresenter,
    llmProviderPresenter: deps.llmProviderPresenter
  })

  const sessionService = new SessionService({
    sessionRepository: hotPathPorts.sessionRepository,
    messageRepository: hotPathPorts.messageRepository,
    scheduler
  })
  const chatService = new ChatService({
    sessionRepository: hotPathPorts.sessionRepository,
    messageRepository: hotPathPorts.messageRepository,
    providerExecutionPort: hotPathPorts.providerExecutionPort,
    providerCatalogPort: hotPathPorts.providerCatalogPort,
    sessionPermissionPort: hotPathPorts.sessionPermissionPort,
    scheduler
  })

  // Wire scheduled tasks -> sessions for the auto-send action.
  deps.scheduledTasks.setSessionCreator({
    async createSessionForTask(input) {
      const session = await sessionService.createSession(
        {
          agentId: input.agentId,
          message: input.message,
          providerId: input.providerId,
          modelId: input.modelId,
          ...(input.systemPrompt
            ? { generationSettings: { systemPrompt: input.systemPrompt } }
            : {})
        },
        {
          webContentsId: deps.windowPresenter.mainWindow?.webContents?.id ?? -1,
          windowId: deps.windowPresenter.mainWindow?.id ?? null
        }
      )
      if (!session?.id) {
        return { sessionId: null }
      }

      await chatService.sendMessage(session.id, input.message)
      return { sessionId: session.id }
    }
  })

  return {
    configPresenter: deps.configPresenter,
    llmProviderPresenter: deps.llmProviderPresenter,
    agentSessionPresenter: deps.agentSessionPresenter,
    skillPresenter: deps.skillPresenter,
    skillSyncPresenter: deps.skillSyncPresenter,
    exporter: deps.exporter,
    oauthPresenter: deps.oauthPresenter,
    mcpPresenter: deps.mcpPresenter,
    remoteControlPresenter: deps.remoteControlPresenter,
    shortcutPresenter: deps.shortcutPresenter,
    syncPresenter: deps.syncPresenter,
    upgradePresenter: deps.upgradePresenter,
    dialogPresenter: deps.dialogPresenter,
    toolPresenter: deps.toolPresenter,
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
    providerService: new ProviderService({
      providerCatalogPort: hotPathPorts.providerCatalogPort,
      providerExecutionPort: hotPathPorts.providerExecutionPort,
      scheduler
    }),
    providerImportService: new ProviderImportService(deps.configPresenter),
    windowPresenter: deps.windowPresenter,
    devicePresenter: deps.devicePresenter,
    projectPresenter: deps.projectPresenter,
    filePresenter: deps.filePresenter,
    knowledgePresenter: deps.knowledgePresenter,
    workspacePresenter: deps.workspacePresenter,
    yoBrowserPresenter: deps.yoBrowserPresenter,
    tabPresenter: deps.tabPresenter,
    startupWorkloadCoordinator: deps.startupWorkloadCoordinator,
    pluginPresenter: deps.pluginPresenter,
    databaseSecurityPresenter: deps.databaseSecurityPresenter,
    memoryPresenter: deps.memoryPresenter,
    scheduledTasks: deps.scheduledTasks
  }
}

type RouteContext = {
  webContentsId: number
  windowId: number | null
}

const publishProjectEnvironmentsChanged = (
  action: 'reorder' | 'archive' | 'restore' | 'remove',
  path: string | null
) => {
  publishDeepchatEvent(projectEnvironmentsChangedEvent.name, {
    action,
    path,
    version: Date.now()
  })
}

type WindowState = {
  windowId: number | null
  exists: boolean
  isMaximized: boolean
  isFullScreen: boolean
  isFocused: boolean
}

function readCurrentWindowState(
  runtime: MainKernelRouteRuntime,
  context: RouteContext
): WindowState {
  const window = context.windowId != null ? BrowserWindow.fromId(context.windowId) : null
  const exists = Boolean(window && !window.isDestroyed())

  return {
    windowId: context.windowId,
    exists,
    isMaximized: exists ? window!.isMaximized() : false,
    isFullScreen: exists ? window!.isFullScreen() : false,
    isFocused: exists ? runtime.windowPresenter.isMainWindowFocused(context.windowId!) : false
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

function getDatabaseSecuritySQLitePresenter(runtime: MainKernelRouteRuntime): SQLitePresenter {
  const sqlitePresenter = runtime.sqlitePresenter as Partial<SQLitePresenter>
  const requiredMethods: Array<keyof SQLitePresenter> = [
    'getDatabasePath',
    'getDatabase',
    'close',
    'reopenWithPassword'
  ]
  if (requiredMethods.some((method) => typeof sqlitePresenter[method] !== 'function')) {
    throw new Error('SQLite presenter is required for database encryption')
  }
  return runtime.sqlitePresenter as unknown as SQLitePresenter
}

function getMemorySourceTapeEntriesTable(
  runtime: MainKernelRouteRuntime
): SQLitePresenter['deepchatTapeEntriesTable'] | null {
  const table = (runtime.sqlitePresenter as Partial<SQLitePresenter>).deepchatTapeEntriesTable
  if (!table || typeof table.getBySession !== 'function') return null
  return table
}

function getMemoryViewManifestTapeEntriesTable(
  runtime: MainKernelRouteRuntime
): SQLitePresenter['deepchatTapeEntriesTable'] | null {
  const table = (runtime.sqlitePresenter as Partial<SQLitePresenter>).deepchatTapeEntriesTable
  if (!table || typeof table.listMemoryViewManifestAnchorsByAgent !== 'function') return null
  return table
}

function getMemoryAuditTable(
  runtime: MainKernelRouteRuntime
): SQLitePresenter['agentMemoryAuditTable'] | null {
  const table = (runtime.sqlitePresenter as Partial<SQLitePresenter>).agentMemoryAuditTable
  if (!table || typeof table.listByAgent !== 'function') return null
  return table
}

function recordSkillSettingsActivity(
  runtime: MainKernelRouteRuntime,
  action: SettingsActivityInput['action'],
  label: string,
  targetType = 'skill'
): void {
  recordSettingsActivity(runtime, {
    category: 'knowledge',
    action,
    targetType,
    targetId: label,
    targetLabel: label,
    routeName: 'settings-skills',
    summaryKey: 'settings.controlCenter.activity.settingUpdated',
    summaryParams: {
      key: label
    }
  })
}

function recordSkillRemovedActivity(runtime: MainKernelRouteRuntime, label: string): void {
  recordSkillSettingsActivity(runtime, 'removed', label)
}

function recordSkillUpdatedActivity(
  runtime: MainKernelRouteRuntime,
  label: string,
  targetType?: string
): void {
  recordSkillSettingsActivity(runtime, 'updated', label, targetType)
}

function didSkillOperationSucceed(result: { success?: boolean }): boolean {
  return result.success === true
}

function readPromptUpdateName(input: unknown): string | null {
  if (!input || typeof input !== 'object' || !('updates' in input)) {
    return null
  }

  const updates = (input as { updates?: { name?: unknown } }).updates
  return updates && typeof updates.name === 'string' ? updates.name : null
}

function recordProviderOrModelRouteActivity(
  runtime: MainKernelRouteRuntime,
  routeName: string,
  rawInput: unknown
): void {
  switch (routeName) {
    case providersUpdateRoute.name: {
      const input = providersUpdateRoute.input.parse(rawInput)
      const provider = runtime.configPresenter.getProviderById(input.providerId)
      const action =
        typeof input.updates.enable === 'boolean'
          ? input.updates.enable
            ? 'enabled'
            : 'disabled'
          : 'updated'
      recordSettingsActivity(runtime, {
        category: 'provider',
        action,
        targetType: 'provider',
        targetId: input.providerId,
        targetLabel: provider?.name ?? input.providerId,
        routeName: 'settings-provider',
        routeParams: {
          providerId: input.providerId
        },
        summaryKey: 'settings.controlCenter.activity.providerUpdated',
        summaryParams: {
          name: provider?.name ?? input.providerId
        }
      })
      return
    }
    case providersAddRoute.name: {
      const input = providersAddRoute.input.parse(rawInput)
      recordSettingsActivity(runtime, {
        category: 'provider',
        action: 'created',
        targetType: 'provider',
        targetId: input.provider.id,
        targetLabel: input.provider.name,
        routeName: 'settings-provider',
        routeParams: {
          providerId: input.provider.id
        },
        summaryKey: 'settings.controlCenter.activity.providerCreated',
        summaryParams: {
          name: input.provider.name
        }
      })
      return
    }
    case providersRemoveRoute.name: {
      const input = providersRemoveRoute.input.parse(rawInput)
      recordSettingsActivity(runtime, {
        category: 'provider',
        action: 'removed',
        targetType: 'provider',
        targetId: input.providerId,
        targetLabel: input.providerId,
        routeName: 'settings-provider',
        summaryKey: 'settings.controlCenter.activity.providerRemoved',
        summaryParams: {
          name: input.providerId
        }
      })
      return
    }
    case providersRefreshModelsRoute.name: {
      const input = providersRefreshModelsRoute.input.parse(rawInput)
      const provider = runtime.configPresenter.getProviderById(input.providerId)
      recordSettingsActivity(runtime, {
        category: 'provider',
        action: 'refreshed',
        targetType: 'provider',
        targetId: input.providerId,
        targetLabel: provider?.name ?? input.providerId,
        routeName: 'settings-provider',
        routeParams: {
          providerId: input.providerId
        },
        summaryKey: 'settings.controlCenter.activity.providerModelsRefreshed',
        summaryParams: {
          name: provider?.name ?? input.providerId
        }
      })
      return
    }
    case modelsSetStatusRoute.name: {
      const input = modelsSetStatusRoute.input.parse(rawInput)
      recordSettingsActivity(runtime, {
        category: 'model',
        action: input.enabled ? 'enabled' : 'disabled',
        targetType: 'model',
        targetId: input.modelId,
        targetLabel: input.modelId,
        routeName: 'settings-provider',
        routeParams: {
          providerId: input.providerId
        },
        summaryKey: 'settings.controlCenter.activity.modelStatusChanged',
        summaryParams: {
          model: input.modelId
        }
      })
      return
    }
    case modelsSetBatchStatusRoute.name: {
      const input = modelsSetBatchStatusRoute.input.parse(rawInput)
      recordSettingsActivity(runtime, {
        category: 'model',
        action: 'updated',
        targetType: 'model',
        targetId: input.providerId,
        targetLabel: input.providerId,
        routeName: 'settings-provider',
        routeParams: {
          providerId: input.providerId
        },
        summaryKey: 'settings.controlCenter.activity.modelBatchUpdated',
        summaryParams: {
          count: input.updates.length
        }
      })
    }
  }
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

async function readBrowserStatus(runtime: MainKernelRouteRuntime, sessionId: string) {
  return await runtime.yoBrowserPresenter.getBrowserStatus(sessionId)
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
  if (!hasDeepchatRouteContract(routeName)) {
    throw new Error(`Unknown deepchat route: ${routeName}`)
  }

  const configResult = await dispatchConfigRoute(runtime.configPresenter, routeName, rawInput)
  if (configResult !== undefined) {
    recordConfigRouteActivity(runtime, routeName, rawInput)
    return configResult
  }

  const providerResult = await runTrackedRouteTask(runtime, routeName, context, async () => {
    return await dispatchProviderRoute(
      {
        configPresenter: runtime.configPresenter,
        llmProviderPresenter: runtime.llmProviderPresenter,
        providerImportService: runtime.providerImportService
      },
      routeName,
      rawInput,
      context
    )
  })
  if (providerResult !== undefined) {
    recordProviderOrModelRouteActivity(runtime, routeName, rawInput)
    return providerResult
  }

  const modelResult = await runTrackedRouteTask(runtime, routeName, context, async () => {
    return await dispatchModelRoute(
      {
        configPresenter: runtime.configPresenter,
        llmProviderPresenter: runtime.llmProviderPresenter
      },
      routeName,
      rawInput
    )
  })
  if (modelResult !== undefined) {
    recordProviderOrModelRouteActivity(runtime, routeName, rawInput)
    return modelResult
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

    case shortcutRegisterRoute.name: {
      shortcutRegisterRoute.input.parse(rawInput)
      runtime.shortcutPresenter.registerShortcuts()
      return shortcutRegisterRoute.output.parse({ registered: true })
    }

    case shortcutUnregisterRoute.name: {
      shortcutUnregisterRoute.input.parse(rawInput)
      runtime.shortcutPresenter.unregisterShortcuts()
      return shortcutUnregisterRoute.output.parse({ unregistered: true })
    }

    case shortcutDestroyRoute.name: {
      shortcutDestroyRoute.input.parse(rawInput)
      runtime.shortcutPresenter.destroy()
      return shortcutDestroyRoute.output.parse({ destroyed: true })
    }

    case windowGetCurrentStateRoute.name: {
      windowGetCurrentStateRoute.input.parse(rawInput)
      return windowGetCurrentStateRoute.output.parse({
        state: readCurrentWindowState(runtime, context)
      })
    }

    case windowGetRuntimeIdentityRoute.name: {
      windowGetRuntimeIdentityRoute.input.parse(rawInput)
      return windowGetRuntimeIdentityRoute.output.parse({
        windowId: context.windowId,
        webContentsId: context.webContentsId
      })
    }

    case windowMinimizeCurrentRoute.name: {
      windowMinimizeCurrentRoute.input.parse(rawInput)
      if (context.windowId != null) {
        runtime.windowPresenter.minimize(context.windowId)
      }
      return windowMinimizeCurrentRoute.output.parse({
        state: readCurrentWindowState(runtime, context)
      })
    }

    case windowToggleMaximizeCurrentRoute.name: {
      windowToggleMaximizeCurrentRoute.input.parse(rawInput)
      if (context.windowId != null) {
        runtime.windowPresenter.maximize(context.windowId)
      }
      return windowToggleMaximizeCurrentRoute.output.parse({
        state: readCurrentWindowState(runtime, context)
      })
    }

    case windowCloseCurrentRoute.name: {
      windowCloseCurrentRoute.input.parse(rawInput)
      if (context.windowId != null) {
        runtime.windowPresenter.close(context.windowId)
        return windowCloseCurrentRoute.output.parse({ closed: true })
      }
      return windowCloseCurrentRoute.output.parse({ closed: false })
    }

    case windowCloseFloatingCurrentRoute.name: {
      windowCloseFloatingCurrentRoute.input.parse(rawInput)
      const floatingWindow = runtime.windowPresenter.getFloatingChatWindow()?.getWindow() ?? null
      if (
        floatingWindow &&
        !floatingWindow.isDestroyed() &&
        floatingWindow.webContents.id === context.webContentsId
      ) {
        runtime.windowPresenter.hide(floatingWindow.id)
        return windowCloseFloatingCurrentRoute.output.parse({ closed: true })
      }
      return windowCloseFloatingCurrentRoute.output.parse({ closed: false })
    }

    case windowPreviewFileRoute.name: {
      const input = windowPreviewFileRoute.input.parse(rawInput)
      runtime.windowPresenter.previewFile(input.filePath)
      return windowPreviewFileRoute.output.parse({ previewed: true })
    }

    case windowCloseSettingsRoute.name: {
      windowCloseSettingsRoute.input.parse(rawInput)
      const hadSettingsWindow = runtime.windowPresenter.getSettingsWindowId() != null
      runtime.windowPresenter.closeSettingsWindow()
      return windowCloseSettingsRoute.output.parse({ closed: hadSettingsWindow })
    }

    case windowFocusMainRoute.name: {
      windowFocusMainRoute.input.parse(rawInput)
      return windowFocusMainRoute.output.parse({
        focused: runtime.windowPresenter.focusMainWindow()
      })
    }

    case windowNotifySettingsReadyRoute.name: {
      windowNotifySettingsReadyRoute.input.parse(rawInput)
      runtime.windowPresenter.notifySettingsReady(context.webContentsId)
      return windowNotifySettingsReadyRoute.output.parse({ notified: true })
    }

    case windowConsumePendingSettingsProviderInstallRoute.name: {
      windowConsumePendingSettingsProviderInstallRoute.input.parse(rawInput)
      return windowConsumePendingSettingsProviderInstallRoute.output.parse({
        preview: runtime.windowPresenter.consumePendingSettingsProviderInstall()
      })
    }

    case windowRequeuePendingSettingsProviderInstallRoute.name: {
      const input = windowRequeuePendingSettingsProviderInstallRoute.input.parse(rawInput)
      runtime.windowPresenter.setPendingSettingsProviderInstall(input.preview)
      return windowRequeuePendingSettingsProviderInstallRoute.output.parse({ queued: true })
    }

    case windowStartGuidedOnboardingRoute.name: {
      windowStartGuidedOnboardingRoute.input.parse(rawInput)
      await runtime.windowPresenter.sendToAllWindows(DEV_EVENTS.START_GUIDED_ONBOARDING)
      return windowStartGuidedOnboardingRoute.output.parse({
        started: true,
        focused: runtime.windowPresenter.focusMainWindow()
      })
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
      await runtime.devicePresenter.resetDataByType(input.resetType)
      return deviceResetDataByTypeRoute.output.parse({ reset: true })
    }

    case deviceSanitizeSvgRoute.name: {
      const input = deviceSanitizeSvgRoute.input.parse(rawInput)
      return deviceSanitizeSvgRoute.output.parse({
        content: await runtime.devicePresenter.sanitizeSvgContent(input.svgContent)
      })
    }

    case pluginsListRoute.name: {
      pluginsListRoute.input.parse(rawInput)
      return pluginsListRoute.output.parse({
        plugins: await runtime.pluginPresenter.listPlugins()
      })
    }

    case pluginsGetRoute.name: {
      const input = pluginsGetRoute.input.parse(rawInput)
      return pluginsGetRoute.output.parse({
        plugin: await runtime.pluginPresenter.getPlugin(input.pluginId)
      })
    }

    case pluginsEnableRoute.name: {
      const input = pluginsEnableRoute.input.parse(rawInput)
      return pluginsEnableRoute.output.parse({
        result: await runtime.pluginPresenter.enablePlugin(input.pluginId)
      })
    }

    case pluginsDisableRoute.name: {
      const input = pluginsDisableRoute.input.parse(rawInput)
      return pluginsDisableRoute.output.parse({
        result: await runtime.pluginPresenter.disablePlugin(input.pluginId)
      })
    }

    case pluginsInvokeActionRoute.name: {
      const input = pluginsInvokeActionRoute.input.parse(rawInput)
      return pluginsInvokeActionRoute.output.parse({
        result: await runtime.pluginPresenter.invokeAction(
          input.pluginId,
          input.actionId,
          input.payload
        )
      })
    }

    case projectListRecentRoute.name: {
      const input = projectListRecentRoute.input.parse(rawInput)
      return projectListRecentRoute.output.parse({
        projects: await runtime.projectPresenter.getRecentProjects(input.limit ?? 20)
      })
    }

    case projectListEnvironmentsRoute.name: {
      const input = projectListEnvironmentsRoute.input.parse(rawInput)
      return projectListEnvironmentsRoute.output.parse({
        environments: await runtime.projectPresenter.getEnvironments({ status: input.status })
      })
    }

    case projectReorderEnvironmentsRoute.name: {
      const input = projectReorderEnvironmentsRoute.input.parse(rawInput)
      await runtime.projectPresenter.reorderEnvironments(input.paths)
      publishProjectEnvironmentsChanged('reorder', null)
      return projectReorderEnvironmentsRoute.output.parse({ updated: true })
    }

    case projectArchiveEnvironmentRoute.name: {
      const input = projectArchiveEnvironmentRoute.input.parse(rawInput)
      await runtime.projectPresenter.archiveEnvironment(input.path)
      publishProjectEnvironmentsChanged('archive', input.path)
      return projectArchiveEnvironmentRoute.output.parse({ updated: true })
    }

    case projectRestoreEnvironmentRoute.name: {
      const input = projectRestoreEnvironmentRoute.input.parse(rawInput)
      await runtime.projectPresenter.restoreEnvironment(input.path)
      publishProjectEnvironmentsChanged('restore', input.path)
      return projectRestoreEnvironmentRoute.output.parse({ updated: true })
    }

    case projectRemoveEnvironmentRoute.name: {
      const input = projectRemoveEnvironmentRoute.input.parse(rawInput)
      const result = await runtime.projectPresenter.removeEnvironment(input.path)
      publishProjectEnvironmentsChanged('remove', input.path)
      return projectRemoveEnvironmentRoute.output.parse(result)
    }

    case projectOpenDirectoryRoute.name: {
      const input = projectOpenDirectoryRoute.input.parse(rawInput)
      await runtime.projectPresenter.openDirectory(input.path)
      return projectOpenDirectoryRoute.output.parse({ opened: true })
    }

    case projectPathExistsRoute.name: {
      const input = projectPathExistsRoute.input.parse(rawInput)
      return projectPathExistsRoute.output.parse({
        exists: await runtime.projectPresenter.pathExists(input.path)
      })
    }

    case projectSelectDirectoryRoute.name: {
      projectSelectDirectoryRoute.input.parse(rawInput)
      return projectSelectDirectoryRoute.output.parse({
        path: await runtime.projectPresenter.selectDirectory()
      })
    }

    case fileGetMimeTypeRoute.name: {
      const input = fileGetMimeTypeRoute.input.parse(rawInput)
      return fileGetMimeTypeRoute.output.parse({
        mimeType: await runtime.filePresenter.getMimeType(input.path)
      })
    }

    case filePrepareFileRoute.name: {
      const input = filePrepareFileRoute.input.parse(rawInput)
      return filePrepareFileRoute.output.parse({
        file: await runtime.filePresenter.prepareFile(input.path, input.mimeType)
      })
    }

    case filePrepareDirectoryRoute.name: {
      const input = filePrepareDirectoryRoute.input.parse(rawInput)
      return filePrepareDirectoryRoute.output.parse({
        file: await runtime.filePresenter.prepareDirectory(input.path)
      })
    }

    case fileReadFileRoute.name: {
      const input = fileReadFileRoute.input.parse(rawInput)
      return fileReadFileRoute.output.parse({
        content: await runtime.filePresenter.readFile(input.path)
      })
    }

    case fileIsDirectoryRoute.name: {
      const input = fileIsDirectoryRoute.input.parse(rawInput)
      return fileIsDirectoryRoute.output.parse({
        isDirectory: await runtime.filePresenter.isDirectory(input.path)
      })
    }

    case fileWriteImageBase64Route.name: {
      const input = fileWriteImageBase64Route.input.parse(rawInput)
      return fileWriteImageBase64Route.output.parse({
        path: await runtime.filePresenter.writeImageBase64(input)
      })
    }

    case fileSaveImageRoute.name: {
      const input = fileSaveImageRoute.input.parse(rawInput)
      return fileSaveImageRoute.output.parse(await runtime.filePresenter.saveImage(input))
    }

    case fileCopyImageRoute.name: {
      const input = fileCopyImageRoute.input.parse(rawInput)
      return fileCopyImageRoute.output.parse(await runtime.filePresenter.copyImage(input))
    }

    case knowledgeIsSupportedRoute.name: {
      knowledgeIsSupportedRoute.input.parse(rawInput)
      return knowledgeIsSupportedRoute.output.parse({
        supported: await runtime.knowledgePresenter.isSupported()
      })
    }

    case knowledgeGetSupportedLanguagesRoute.name: {
      knowledgeGetSupportedLanguagesRoute.input.parse(rawInput)
      return knowledgeGetSupportedLanguagesRoute.output.parse({
        languages: await runtime.knowledgePresenter.getSupportedLanguages()
      })
    }

    case knowledgeGetSeparatorsForLanguageRoute.name: {
      const input = knowledgeGetSeparatorsForLanguageRoute.input.parse(rawInput)
      return knowledgeGetSeparatorsForLanguageRoute.output.parse({
        separators: await runtime.knowledgePresenter.getSeparatorsForLanguage(input.language)
      })
    }

    case knowledgeGetSupportedFileExtensionsRoute.name: {
      knowledgeGetSupportedFileExtensionsRoute.input.parse(rawInput)
      return knowledgeGetSupportedFileExtensionsRoute.output.parse({
        extensions: await runtime.knowledgePresenter.getSupportedFileExtensions()
      })
    }

    case knowledgeListFilesRoute.name: {
      const input = knowledgeListFilesRoute.input.parse(rawInput)
      return knowledgeListFilesRoute.output.parse({
        files: await runtime.knowledgePresenter.listFiles(input.knowledgeBaseId)
      })
    }

    case knowledgeSimilarityQueryRoute.name: {
      const input = knowledgeSimilarityQueryRoute.input.parse(rawInput)
      return knowledgeSimilarityQueryRoute.output.parse({
        results: await runtime.knowledgePresenter.similarityQuery(
          input.knowledgeBaseId,
          input.query
        )
      })
    }

    case knowledgeValidateFileRoute.name: {
      const input = knowledgeValidateFileRoute.input.parse(rawInput)
      return knowledgeValidateFileRoute.output.parse({
        result: await runtime.knowledgePresenter.validateFile(input.filePath)
      })
    }

    case knowledgeAddFileRoute.name: {
      const input = knowledgeAddFileRoute.input.parse(rawInput)
      return knowledgeAddFileRoute.output.parse({
        result: await runtime.knowledgePresenter.addFile(input.knowledgeBaseId, input.filePath)
      })
    }

    case knowledgeDeleteFileRoute.name: {
      const input = knowledgeDeleteFileRoute.input.parse(rawInput)
      await runtime.knowledgePresenter.deleteFile(input.knowledgeBaseId, input.fileId)
      return knowledgeDeleteFileRoute.output.parse({ deleted: true })
    }

    case knowledgeReAddFileRoute.name: {
      const input = knowledgeReAddFileRoute.input.parse(rawInput)
      return knowledgeReAddFileRoute.output.parse({
        result: await runtime.knowledgePresenter.reAddFile(input.knowledgeBaseId, input.fileId)
      })
    }

    case knowledgePauseAllRunningTasksRoute.name: {
      const input = knowledgePauseAllRunningTasksRoute.input.parse(rawInput)
      await runtime.knowledgePresenter.pauseAllRunningTasks(input.knowledgeBaseId)
      return knowledgePauseAllRunningTasksRoute.output.parse({ paused: true })
    }

    case knowledgeResumeAllPausedTasksRoute.name: {
      const input = knowledgeResumeAllPausedTasksRoute.input.parse(rawInput)
      await runtime.knowledgePresenter.resumeAllPausedTasks(input.knowledgeBaseId)
      return knowledgeResumeAllPausedTasksRoute.output.parse({ resumed: true })
    }

    case workspaceRegisterRoute.name: {
      const input = workspaceRegisterRoute.input.parse(rawInput)
      if (input.mode === 'workdir') {
        await runtime.workspacePresenter.registerWorkdir(input.workspacePath)
      } else {
        await runtime.workspacePresenter.registerWorkspace(input.workspacePath)
      }
      return workspaceRegisterRoute.output.parse({ registered: true })
    }

    case workspaceUnregisterRoute.name: {
      const input = workspaceUnregisterRoute.input.parse(rawInput)
      if (input.mode === 'workdir') {
        await runtime.workspacePresenter.unregisterWorkdir(input.workspacePath)
      } else {
        await runtime.workspacePresenter.unregisterWorkspace(input.workspacePath)
      }
      return workspaceUnregisterRoute.output.parse({ unregistered: true })
    }

    case workspaceWatchRoute.name: {
      const input = workspaceWatchRoute.input.parse(rawInput)
      await runtime.workspacePresenter.watchWorkspace(input.workspacePath)
      return workspaceWatchRoute.output.parse({ watching: true })
    }

    case workspaceUnwatchRoute.name: {
      const input = workspaceUnwatchRoute.input.parse(rawInput)
      await runtime.workspacePresenter.unwatchWorkspace(input.workspacePath)
      return workspaceUnwatchRoute.output.parse({ watching: false })
    }

    case workspaceReadDirectoryRoute.name: {
      const input = workspaceReadDirectoryRoute.input.parse(rawInput)
      return workspaceReadDirectoryRoute.output.parse({
        nodes: await runtime.workspacePresenter.readDirectory(input.path)
      })
    }

    case workspaceExpandDirectoryRoute.name: {
      const input = workspaceExpandDirectoryRoute.input.parse(rawInput)
      return workspaceExpandDirectoryRoute.output.parse({
        nodes: await runtime.workspacePresenter.expandDirectory(input.path)
      })
    }

    case workspaceRevealFileInFolderRoute.name: {
      const input = workspaceRevealFileInFolderRoute.input.parse(rawInput)
      await runtime.workspacePresenter.revealFileInFolder(input.path)
      return workspaceRevealFileInFolderRoute.output.parse({ revealed: true })
    }

    case workspaceOpenFileRoute.name: {
      const input = workspaceOpenFileRoute.input.parse(rawInput)
      await runtime.workspacePresenter.openFile(input.path)
      return workspaceOpenFileRoute.output.parse({ opened: true })
    }

    case workspaceReadFilePreviewRoute.name: {
      const input = workspaceReadFilePreviewRoute.input.parse(rawInput)
      return workspaceReadFilePreviewRoute.output.parse({
        preview: await runtime.workspacePresenter.readFilePreview(input.path)
      })
    }

    case workspaceResolveMarkdownLinkedFileRoute.name: {
      const input = workspaceResolveMarkdownLinkedFileRoute.input.parse(rawInput)
      return workspaceResolveMarkdownLinkedFileRoute.output.parse({
        resolution: await runtime.workspacePresenter.resolveMarkdownLinkedFile(input)
      })
    }

    case workspaceGetGitStatusRoute.name: {
      const input = workspaceGetGitStatusRoute.input.parse(rawInput)
      return workspaceGetGitStatusRoute.output.parse({
        state: await runtime.workspacePresenter.getGitStatus(input.workspacePath)
      })
    }

    case workspaceGetGitDiffRoute.name: {
      const input = workspaceGetGitDiffRoute.input.parse(rawInput)
      return workspaceGetGitDiffRoute.output.parse({
        diff: await runtime.workspacePresenter.getGitDiff(input.workspacePath, input.filePath)
      })
    }

    case workspaceSearchFilesRoute.name: {
      const input = workspaceSearchFilesRoute.input.parse(rawInput)
      return workspaceSearchFilesRoute.output.parse({
        nodes: await runtime.workspacePresenter.searchFiles(input.workspacePath, input.query)
      })
    }

    case browserGetStatusRoute.name: {
      const input = browserGetStatusRoute.input.parse(rawInput)
      return browserGetStatusRoute.output.parse({
        status: await readBrowserStatus(runtime, input.sessionId)
      })
    }

    case browserLoadUrlRoute.name: {
      const input = browserLoadUrlRoute.input.parse(rawInput)
      const browserPresenter = runtime.yoBrowserPresenter as IYoBrowserPresenter & {
        loadUrl: (
          sessionId: string,
          url: string,
          timeoutMs?: number,
          hostWindowId?: number
        ) => Promise<Awaited<ReturnType<IYoBrowserPresenter['getBrowserStatus']>>>
      }

      return browserLoadUrlRoute.output.parse({
        status: await browserPresenter.loadUrl(
          input.sessionId,
          input.url,
          input.timeoutMs,
          context.windowId ?? undefined
        )
      })
    }

    case browserAttachCurrentWindowRoute.name: {
      const input = browserAttachCurrentWindowRoute.input.parse(rawInput)
      if (context.windowId == null) {
        return browserAttachCurrentWindowRoute.output.parse({ attached: false })
      }

      return browserAttachCurrentWindowRoute.output.parse({
        attached: await runtime.yoBrowserPresenter.attachSessionBrowser(
          input.sessionId,
          context.windowId
        )
      })
    }

    case browserUpdateCurrentWindowBoundsRoute.name: {
      const input = browserUpdateCurrentWindowBoundsRoute.input.parse(rawInput)
      if (context.windowId == null) {
        return browserUpdateCurrentWindowBoundsRoute.output.parse({ updated: false })
      }

      await runtime.yoBrowserPresenter.updateSessionBrowserBounds(
        input.sessionId,
        context.windowId,
        input.bounds,
        input.visible
      )
      return browserUpdateCurrentWindowBoundsRoute.output.parse({ updated: true })
    }

    case browserDetachRoute.name: {
      const input = browserDetachRoute.input.parse(rawInput)
      await runtime.yoBrowserPresenter.detachSessionBrowser(input.sessionId)
      return browserDetachRoute.output.parse({ detached: true })
    }

    case browserDestroyRoute.name: {
      const input = browserDestroyRoute.input.parse(rawInput)
      await runtime.yoBrowserPresenter.destroySessionBrowser(input.sessionId)
      return browserDestroyRoute.output.parse({ destroyed: true })
    }

    case browserGoBackRoute.name: {
      const input = browserGoBackRoute.input.parse(rawInput)
      await runtime.yoBrowserPresenter.goBack(input.sessionId)
      return browserGoBackRoute.output.parse({
        status: await readBrowserStatus(runtime, input.sessionId)
      })
    }

    case browserGoForwardRoute.name: {
      const input = browserGoForwardRoute.input.parse(rawInput)
      await runtime.yoBrowserPresenter.goForward(input.sessionId)
      return browserGoForwardRoute.output.parse({
        status: await readBrowserStatus(runtime, input.sessionId)
      })
    }

    case browserReloadRoute.name: {
      const input = browserReloadRoute.input.parse(rawInput)
      await runtime.yoBrowserPresenter.reload(input.sessionId)
      return browserReloadRoute.output.parse({
        status: await readBrowserStatus(runtime, input.sessionId)
      })
    }

    case browserClearSandboxDataRoute.name: {
      browserClearSandboxDataRoute.input.parse(rawInput)
      await runtime.yoBrowserPresenter.clearSandboxData()
      return browserClearSandboxDataRoute.output.parse({ cleared: true })
    }

    case tabNotifyRendererReadyRoute.name: {
      tabNotifyRendererReadyRoute.input.parse(rawInput)
      await runtime.tabPresenter.onRendererTabReady(context.webContentsId)
      return tabNotifyRendererReadyRoute.output.parse({ notified: true })
    }

    case tabNotifyRendererActivatedRoute.name: {
      const input = tabNotifyRendererActivatedRoute.input.parse(rawInput)
      await runtime.tabPresenter.onRendererTabActivated(input.sessionId)
      return tabNotifyRendererActivatedRoute.output.parse({ notified: true })
    }

    case tabCaptureCurrentAreaRoute.name: {
      const input = tabCaptureCurrentAreaRoute.input.parse(rawInput)
      return tabCaptureCurrentAreaRoute.output.parse({
        imageData: await runtime.tabPresenter.captureTabArea(context.webContentsId, input.rect)
      })
    }

    case tabStitchImagesWithWatermarkRoute.name: {
      const input = tabStitchImagesWithWatermarkRoute.input.parse(rawInput)
      return tabStitchImagesWithWatermarkRoute.output.parse({
        imageData: await runtime.tabPresenter.stitchImagesWithWatermark(
          input.images,
          input.watermark
        )
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
      const sqlitePresenter = getDatabaseSecuritySQLitePresenter(runtime)
      const status = await runtime.databaseSecurityPresenter.enableEncryption({
        password: input.password,
        sqlitePresenter,
        configPresenter: runtime.configPresenter
      })
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
      const sqlitePresenter = getDatabaseSecuritySQLitePresenter(runtime)
      const status = await runtime.databaseSecurityPresenter.changePassword({
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        sqlitePresenter,
        configPresenter: runtime.configPresenter
      })
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
      const sqlitePresenter = getDatabaseSecuritySQLitePresenter(runtime)
      const status = await runtime.databaseSecurityPresenter.disableEncryption({
        currentPassword: input.currentPassword,
        sqlitePresenter,
        configPresenter: runtime.configPresenter
      })
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

    case memoryListRoute.name: {
      const input = memoryListRoute.input.parse(rawInput)
      const memories = runtime.memoryPresenter.listMemories(input.agentId).map(toMemoryItemDto)
      return memoryListRoute.output.parse({ memories })
    }

    case memorySearchRoute.name: {
      const input = memorySearchRoute.input.parse(rawInput)
      const hits = await runtime.memoryPresenter.searchMemories(input.agentId, input.query, {
        limit: input.limit
      })
      const results = hits.map((hit) => ({
        ...toMemoryItemDto(hit.row),
        score: hit.score,
        sources: hit.sources,
        similarity: hit.similarity
      }))
      return memorySearchRoute.output.parse({ results })
    }

    case memoryAddRoute.name: {
      const input = memoryAddRoute.input.parse(rawInput)
      const outcome = await runtime.memoryPresenter.addUserMemory(input.agentId, {
        content: input.content,
        kind: input.kind,
        category: input.category,
        importance: input.importance
      })
      return memoryAddRoute.output.parse({ result: toMemoryAddResultDto(outcome) })
    }

    case memoryGetStatusRoute.name: {
      const input = memoryGetStatusRoute.input.parse(rawInput)
      return memoryGetStatusRoute.output.parse({
        status: runtime.memoryPresenter.getStatus(input.agentId)
      })
    }

    case memoryGetHealthRoute.name: {
      const input = memoryGetHealthRoute.input.parse(rawInput)
      const agentType = await runtime.configPresenter.getAgentType(input.agentId)
      if (agentType !== 'deepchat') {
        return memoryGetHealthRoute.output.parse({ health: createEmptyMemoryHealth() })
      }
      return memoryGetHealthRoute.output.parse({
        health: runtime.memoryPresenter.getHealth(input.agentId)
      })
    }

    case memoryGetLifecycleRoute.name: {
      const input = memoryGetLifecycleRoute.input.parse(rawInput)
      const agentType = await runtime.configPresenter.getAgentType(input.agentId)
      if (agentType !== 'deepchat') {
        return memoryGetLifecycleRoute.output.parse({ lifecycles: [] })
      }
      return memoryGetLifecycleRoute.output.parse({
        lifecycles: runtime.memoryPresenter.getLifecycle(input.agentId, input.memoryId)
      })
    }

    case memoryGetArchiveCandidateLifecyclePreviewRoute.name: {
      const input = memoryGetArchiveCandidateLifecyclePreviewRoute.input.parse(rawInput)
      const agentType = await runtime.configPresenter.getAgentType(input.agentId)
      if (agentType !== 'deepchat') {
        return memoryGetArchiveCandidateLifecyclePreviewRoute.output.parse({
          preview: createEmptyArchiveCandidateLifecyclePreview()
        })
      }
      return memoryGetArchiveCandidateLifecyclePreviewRoute.output.parse({
        preview: runtime.memoryPresenter.getArchiveCandidateLifecyclePreview(input.agentId)
      })
    }

    case memoryListAuditEventsRoute.name: {
      const input = memoryListAuditEventsRoute.input.parse(rawInput)
      const agentType = await runtime.configPresenter.getAgentType(input.agentId)
      if (agentType !== 'deepchat') {
        return memoryListAuditEventsRoute.output.parse({ events: [] })
      }
      const auditTable = getMemoryAuditTable(runtime)
      if (!auditTable) {
        return memoryListAuditEventsRoute.output.parse({ events: [] })
      }
      const events = auditTable
        .listByAgent(input.agentId, {
          eventType: input.eventType,
          actorType: input.actorType,
          sessionId: input.sessionId,
          status: input.status,
          startCreatedAt: input.startCreatedAt,
          endCreatedAt: input.endCreatedAt,
          limit: input.limit
        })
        .map(toMemoryAuditEventDto)
      return memoryListAuditEventsRoute.output.parse({ events })
    }

    case memoryListViewManifestsRoute.name: {
      const input = memoryListViewManifestsRoute.input.parse(rawInput)
      const agentType = await runtime.configPresenter.getAgentType(input.agentId)
      if (agentType !== 'deepchat') {
        return memoryListViewManifestsRoute.output.parse({ manifests: [] })
      }
      const tapeEntriesTable = getMemoryViewManifestTapeEntriesTable(runtime)
      if (!tapeEntriesTable) {
        return memoryListViewManifestsRoute.output.parse({ manifests: [] })
      }
      const limit = input.limit ?? 100
      const manifests = tapeEntriesTable
        .listMemoryViewManifestAnchorsByAgent(input.agentId, {
          sessionId: input.sessionId,
          limit,
          messageId: input.messageId
        })
        .map(toMemoryViewManifestDto)
        .filter((manifest): manifest is NonNullable<typeof manifest> => Boolean(manifest))
        .filter((manifest) => !input.messageId || manifest.messageId === input.messageId)
        .slice(0, limit)
      return memoryListViewManifestsRoute.output.parse({ manifests })
    }

    case memoryDeleteRoute.name: {
      const input = memoryDeleteRoute.input.parse(rawInput)
      const ok = await runtime.memoryPresenter.deleteMemory(input.agentId, input.memoryId)
      return memoryDeleteRoute.output.parse({ ok })
    }

    case memoryClearRoute.name: {
      const input = memoryClearRoute.input.parse(rawInput)
      const removed = await runtime.memoryPresenter.clearMemories(input.agentId)
      return memoryClearRoute.output.parse({ removed })
    }

    case memoryRestoreRoute.name: {
      const input = memoryRestoreRoute.input.parse(rawInput)
      const ok = runtime.memoryPresenter.restoreMemory(input.agentId, input.memoryId)
      return memoryRestoreRoute.output.parse({ ok })
    }

    case memoryGetSourceSpanRoute.name: {
      const input = memoryGetSourceSpanRoute.input.parse(rawInput)
      const span = getMemorySourceSpan(runtime, input.agentId, input.memoryId)
      return memoryGetSourceSpanRoute.output.parse({ span })
    }

    case memoryListConflictsRoute.name: {
      const input = memoryListConflictsRoute.input.parse(rawInput)
      const conflicts = runtime.memoryPresenter.listConflicts(input.agentId).map((pair) => ({
        challenger: toMemoryItemDto(pair.challenger),
        target: toMemoryItemDto(pair.target)
      }))
      return memoryListConflictsRoute.output.parse({ conflicts })
    }

    case memoryResolveConflictRoute.name: {
      const input = memoryResolveConflictRoute.input.parse(rawInput)
      const ok = await runtime.memoryPresenter.resolveConflict(
        input.agentId,
        input.challengerId,
        input.outcome,
        'user'
      )
      return memoryResolveConflictRoute.output.parse({ ok })
    }

    case memoryListPersonaVersionsRoute.name: {
      const input = memoryListPersonaVersionsRoute.input.parse(rawInput)
      const versions = runtime.memoryPresenter
        .listPersonaVersions(input.agentId)
        .map(toMemoryItemDto)
      return memoryListPersonaVersionsRoute.output.parse({ versions })
    }

    case memoryRollbackPersonaRoute.name: {
      const input = memoryRollbackPersonaRoute.input.parse(rawInput)
      const ok = await runtime.memoryPresenter.rollbackPersona(input.agentId, input.versionId)
      return memoryRollbackPersonaRoute.output.parse({ ok })
    }

    case memoryListPersonaDraftsRoute.name: {
      const input = memoryListPersonaDraftsRoute.input.parse(rawInput)
      const drafts = runtime.memoryPresenter
        .listPersonaDrafts(input.agentId)
        .map(({ row, needsReview }) => ({ ...toMemoryItemDto(row), needsReview }))
      return memoryListPersonaDraftsRoute.output.parse({ drafts })
    }

    case memoryApprovePersonaDraftRoute.name: {
      const input = memoryApprovePersonaDraftRoute.input.parse(rawInput)
      const ok = await runtime.memoryPresenter.approvePersonaDraft(input.agentId, input.draftId)
      return memoryApprovePersonaDraftRoute.output.parse({ ok })
    }

    case memoryRejectPersonaDraftRoute.name: {
      const input = memoryRejectPersonaDraftRoute.input.parse(rawInput)
      const ok = await runtime.memoryPresenter.rejectPersonaDraft(input.agentId, input.draftId)
      return memoryRejectPersonaDraftRoute.output.parse({ ok })
    }

    case memorySetPersonaAnchorRoute.name: {
      const input = memorySetPersonaAnchorRoute.input.parse(rawInput)
      const ok = await runtime.memoryPresenter.setPersonaAnchor(
        input.agentId,
        input.versionId,
        input.anchored
      )
      return memorySetPersonaAnchorRoute.output.parse({ ok })
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

    case oauthGithubCopilotStartLoginRoute.name: {
      const input = oauthGithubCopilotStartLoginRoute.input.parse(rawInput)
      return oauthGithubCopilotStartLoginRoute.output.parse({
        success: await runtime.oauthPresenter.startGitHubCopilotLogin(input.providerId)
      })
    }

    case oauthGithubCopilotStartDeviceFlowLoginRoute.name: {
      const input = oauthGithubCopilotStartDeviceFlowLoginRoute.input.parse(rawInput)
      return oauthGithubCopilotStartDeviceFlowLoginRoute.output.parse({
        success: await runtime.oauthPresenter.startGitHubCopilotDeviceFlowLogin(input.providerId)
      })
    }

    case oauthOpenAICodexGetStatusRoute.name: {
      oauthOpenAICodexGetStatusRoute.input.parse(rawInput)
      return oauthOpenAICodexGetStatusRoute.output.parse({
        status: await runtime.oauthPresenter.getOpenAICodexStatus()
      })
    }

    case oauthOpenAICodexStartBrowserLoginRoute.name: {
      oauthOpenAICodexStartBrowserLoginRoute.input.parse(rawInput)
      return oauthOpenAICodexStartBrowserLoginRoute.output.parse({
        status: await runtime.oauthPresenter.startOpenAICodexBrowserLogin()
      })
    }

    case oauthOpenAICodexCancelLoginRoute.name: {
      oauthOpenAICodexCancelLoginRoute.input.parse(rawInput)
      return oauthOpenAICodexCancelLoginRoute.output.parse({
        status: await runtime.oauthPresenter.cancelOpenAICodexLogin()
      })
    }

    case oauthOpenAICodexLogoutRoute.name: {
      oauthOpenAICodexLogoutRoute.input.parse(rawInput)
      return oauthOpenAICodexLogoutRoute.output.parse({
        status: await runtime.oauthPresenter.logoutOpenAICodex()
      })
    }

    case scheduledTasksListRoute.name: {
      scheduledTasksListRoute.input.parse(rawInput)
      const settings = runtime.scheduledTasks.list()
      return scheduledTasksListRoute.output.parse({ settings })
    }

    case scheduledTasksUpsertRoute.name: {
      const input = scheduledTasksUpsertRoute.input.parse(rawInput)
      const { task, settings } = runtime.scheduledTasks.upsert(input)
      return scheduledTasksUpsertRoute.output.parse({ task, settings })
    }

    case scheduledTasksDeleteRoute.name: {
      const input = scheduledTasksDeleteRoute.input.parse(rawInput)
      const settings = runtime.scheduledTasks.delete(input.id)
      return scheduledTasksDeleteRoute.output.parse({ settings })
    }

    case scheduledTasksToggleRoute.name: {
      const input = scheduledTasksToggleRoute.input.parse(rawInput)
      const { task, settings } = runtime.scheduledTasks.toggle(input.id, input.enabled)
      return scheduledTasksToggleRoute.output.parse({ task, settings })
    }

    case scheduledTasksFireNowRoute.name: {
      const input = scheduledTasksFireNowRoute.input.parse(rawInput)
      const { task, settings } = await runtime.scheduledTasks.fireNow(input.id)
      return scheduledTasksFireNowRoute.output.parse({ task, settings })
    }

    case startupGetBootstrapRoute.name: {
      startupGetBootstrapRoute.input.parse(rawInput)
      const coordinator = (runtime as Partial<MainKernelRouteRuntime>).startupWorkloadCoordinator

      if (!coordinator) {
        const activeSessionId = runtime.agentSessionPresenter.getActiveSessionId(
          context.webContentsId
        )
        const activeSession = activeSessionId
          ? ((
              await runtime.agentSessionPresenter.getLightweightSessionsByIds([activeSessionId])
            )[0] ?? null)
          : null
        const [agents, acpEnabled, defaultChatWorkspacePath] = await Promise.all([
          runtime.configPresenter.listAgents(),
          runtime.configPresenter.getAcpEnabled(),
          runtime.projectPresenter.ensureDefaultWorkspace()
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
          const activeSessionId = runtime.agentSessionPresenter.getActiveSessionId(
            context.webContentsId
          )
          const activeSession = activeSessionId
            ? ((
                await runtime.agentSessionPresenter.getLightweightSessionsByIds([activeSessionId])
              )[0] ?? null)
            : null
          const [agents, acpEnabled, defaultChatWorkspacePath] = await Promise.all([
            runtime.configPresenter.listAgents(),
            runtime.configPresenter.getAcpEnabled(),
            runtime.projectPresenter.ensureDefaultWorkspace()
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
        const page = await runtime.agentSessionPresenter.getLightweightSessionList(input)
        return sessionsListLightweightRoute.output.parse(page)
      })
    }

    case sessionsGetLightweightByIdsRoute.name: {
      const input = sessionsGetLightweightByIdsRoute.input.parse(rawInput)
      const items = await runtime.agentSessionPresenter.getLightweightSessionsByIds(
        input.sessionIds
      )
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
      const session = await runtime.agentSessionPresenter.ensureAcpDraftSession(input)
      return sessionsEnsureAcpDraftRoute.output.parse({ session })
    }

    case sessionsListPendingInputsRoute.name: {
      const input = sessionsListPendingInputsRoute.input.parse(rawInput)
      const items = await runtime.agentSessionPresenter.listPendingInputs(input.sessionId)
      return sessionsListPendingInputsRoute.output.parse({ items })
    }

    case sessionsQueuePendingInputRoute.name: {
      const input = sessionsQueuePendingInputRoute.input.parse(rawInput)
      const item = await runtime.agentSessionPresenter.queuePendingInput(
        input.sessionId,
        input.content
      )
      return sessionsQueuePendingInputRoute.output.parse({ item })
    }

    case sessionsUpdateQueuedInputRoute.name: {
      const input = sessionsUpdateQueuedInputRoute.input.parse(rawInput)
      const item = await runtime.agentSessionPresenter.updateQueuedInput(
        input.sessionId,
        input.itemId,
        input.content
      )
      return sessionsUpdateQueuedInputRoute.output.parse({ item })
    }

    case sessionsMoveQueuedInputRoute.name: {
      const input = sessionsMoveQueuedInputRoute.input.parse(rawInput)
      const items = await runtime.agentSessionPresenter.moveQueuedInput(
        input.sessionId,
        input.itemId,
        input.toIndex
      )
      return sessionsMoveQueuedInputRoute.output.parse({ items })
    }

    case sessionsConvertPendingInputToSteerRoute.name: {
      const input = sessionsConvertPendingInputToSteerRoute.input.parse(rawInput)
      const item = await runtime.agentSessionPresenter.convertPendingInputToSteer(
        input.sessionId,
        input.itemId
      )
      return sessionsConvertPendingInputToSteerRoute.output.parse({ item })
    }

    case sessionsSteerPendingInputRoute.name: {
      const input = sessionsSteerPendingInputRoute.input.parse(rawInput)
      const item = await runtime.agentSessionPresenter.steerPendingInput(
        input.sessionId,
        input.itemId
      )
      return sessionsSteerPendingInputRoute.output.parse({ item })
    }

    case sessionsDeletePendingInputRoute.name: {
      const input = sessionsDeletePendingInputRoute.input.parse(rawInput)
      await runtime.agentSessionPresenter.deletePendingInput(input.sessionId, input.itemId)
      return sessionsDeletePendingInputRoute.output.parse({ deleted: true })
    }

    case sessionsRetryMessageRoute.name: {
      const input = sessionsRetryMessageRoute.input.parse(rawInput)
      await runtime.agentSessionPresenter.retryMessage(input.sessionId, input.messageId)
      return sessionsRetryMessageRoute.output.parse({ retried: true })
    }

    case sessionsDeleteMessageRoute.name: {
      const input = sessionsDeleteMessageRoute.input.parse(rawInput)
      await runtime.agentSessionPresenter.deleteMessage(input.sessionId, input.messageId)
      return sessionsDeleteMessageRoute.output.parse({ deleted: true })
    }

    case sessionsEditUserMessageRoute.name: {
      const input = sessionsEditUserMessageRoute.input.parse(rawInput)
      const message = await runtime.agentSessionPresenter.editUserMessage(
        input.sessionId,
        input.messageId,
        input.text
      )
      return sessionsEditUserMessageRoute.output.parse({ message })
    }

    case sessionsForkRoute.name: {
      const input = sessionsForkRoute.input.parse(rawInput)
      const session = await runtime.agentSessionPresenter.forkSession(
        input.sourceSessionId,
        input.targetMessageId,
        input.newTitle
      )
      return sessionsForkRoute.output.parse({ session })
    }

    case sessionsSearchHistoryRoute.name: {
      const input = sessionsSearchHistoryRoute.input.parse(rawInput)
      const hits = await runtime.agentSessionPresenter.searchHistory(input.query, input.options)
      return sessionsSearchHistoryRoute.output.parse({ hits })
    }

    case sessionsGetSearchResultsRoute.name: {
      const input = sessionsGetSearchResultsRoute.input.parse(rawInput)
      const results = await runtime.agentSessionPresenter.getSearchResults(
        input.messageId,
        input.searchId
      )
      return sessionsGetSearchResultsRoute.output.parse({ results })
    }

    case sessionsGetTapeContextRoute.name: {
      const input = sessionsGetTapeContextRoute.input.parse(rawInput)
      const context = await runtime.agentSessionPresenter.getTapeContext(
        input.sessionId,
        input.entryIds,
        input.options
      )
      return sessionsGetTapeContextRoute.output.parse({ context })
    }

    case sessionsListMessageTracesRoute.name: {
      const input = sessionsListMessageTracesRoute.input.parse(rawInput)
      const traces = await runtime.agentSessionPresenter.listMessageTraces(input.messageId)
      const manifests = await runtime.agentSessionPresenter.listMessageViewManifests(
        input.messageId
      )
      return sessionsListMessageTracesRoute.output.parse({ traces, manifests })
    }

    case sessionsExportMessageTapeReplaySliceRoute.name: {
      const input = sessionsExportMessageTapeReplaySliceRoute.input.parse(rawInput)
      const slice = await runtime.agentSessionPresenter.exportMessageTapeReplaySlice(
        input.messageId,
        input.options
      )
      return sessionsExportMessageTapeReplaySliceRoute.output.parse({ slice })
    }

    case sessionsTranslateTextRoute.name: {
      const input = sessionsTranslateTextRoute.input.parse(rawInput)
      const text = await runtime.agentSessionPresenter.translateText(
        input.text,
        input.locale,
        input.agentId
      )
      return sessionsTranslateTextRoute.output.parse({ text })
    }

    case sessionsGetAgentsRoute.name: {
      sessionsGetAgentsRoute.input.parse(rawInput)
      const agents = await runtime.agentSessionPresenter.getAgents()
      return sessionsGetAgentsRoute.output.parse({ agents })
    }

    case sessionsGetUsageDashboardRoute.name: {
      sessionsGetUsageDashboardRoute.input.parse(rawInput)
      const dashboard = await runtime.agentSessionPresenter.getUsageDashboard()
      return sessionsGetUsageDashboardRoute.output.parse({ dashboard })
    }

    case sessionsRetryRtkHealthCheckRoute.name: {
      sessionsRetryRtkHealthCheckRoute.input.parse(rawInput)
      await runtime.agentSessionPresenter.retryRtkHealthCheck()
      return sessionsRetryRtkHealthCheckRoute.output.parse({ retried: true })
    }

    case sessionsRenameRoute.name: {
      const input = sessionsRenameRoute.input.parse(rawInput)
      await runtime.agentSessionPresenter.renameSession(input.sessionId, input.title)
      return sessionsRenameRoute.output.parse({ updated: true })
    }

    case sessionsTogglePinnedRoute.name: {
      const input = sessionsTogglePinnedRoute.input.parse(rawInput)
      await runtime.agentSessionPresenter.toggleSessionPinned(input.sessionId, input.pinned)
      return sessionsTogglePinnedRoute.output.parse({ updated: true })
    }

    case sessionsClearMessagesRoute.name: {
      const input = sessionsClearMessagesRoute.input.parse(rawInput)
      await runtime.agentSessionPresenter.clearSessionMessages(input.sessionId)
      return sessionsClearMessagesRoute.output.parse({ cleared: true })
    }

    case sessionsCompactRoute.name: {
      const input = sessionsCompactRoute.input.parse(rawInput)
      const result = await runtime.agentSessionPresenter.compactSession(input.sessionId)
      return sessionsCompactRoute.output.parse(result)
    }

    case sessionsExportRoute.name: {
      const input = sessionsExportRoute.input.parse(rawInput)
      const result = await runtime.agentSessionPresenter.exportSession(
        input.sessionId,
        input.format
      )
      return sessionsExportRoute.output.parse(result)
    }

    case sessionsDeleteRoute.name: {
      const input = sessionsDeleteRoute.input.parse(rawInput)
      await runtime.agentSessionPresenter.deleteSession(input.sessionId)
      return sessionsDeleteRoute.output.parse({ deleted: true })
    }

    case sessionsGetAgentTransferImpactRoute.name: {
      const input = sessionsGetAgentTransferImpactRoute.input.parse(rawInput)
      const impact = await runtime.agentSessionPresenter.getAgentTransferImpact(input.agentId)
      return sessionsGetAgentTransferImpactRoute.output.parse({ impact })
    }

    case sessionsMoveAgentSessionsRoute.name: {
      const input = sessionsMoveAgentSessionsRoute.input.parse(rawInput)
      const result = await runtime.agentSessionPresenter.moveAgentSessions(
        input.fromAgentId,
        input.toAgentId
      )
      return sessionsMoveAgentSessionsRoute.output.parse(result)
    }

    case sessionsDeleteAgentSessionsRoute.name: {
      const input = sessionsDeleteAgentSessionsRoute.input.parse(rawInput)
      const deletedSessionIds = await runtime.agentSessionPresenter.deleteAgentSessions(
        input.agentId
      )
      return sessionsDeleteAgentSessionsRoute.output.parse({ deletedSessionIds })
    }

    case sessionsMoveToAgentRoute.name: {
      const input = sessionsMoveToAgentRoute.input.parse(rawInput)
      const session = await runtime.agentSessionPresenter.moveSessionToAgent(
        input.sessionId,
        input.toAgentId
      )
      return sessionsMoveToAgentRoute.output.parse({ session })
    }

    case sessionsGetAcpSessionCommandsRoute.name: {
      const input = sessionsGetAcpSessionCommandsRoute.input.parse(rawInput)
      const commands = await runtime.agentSessionPresenter.getAcpSessionCommands(input.sessionId)
      return sessionsGetAcpSessionCommandsRoute.output.parse({ commands })
    }

    case sessionsGetAcpSessionConfigOptionsRoute.name: {
      const input = sessionsGetAcpSessionConfigOptionsRoute.input.parse(rawInput)
      const state = await runtime.agentSessionPresenter.getAcpSessionConfigOptions(input.sessionId)
      return sessionsGetAcpSessionConfigOptionsRoute.output.parse({ state })
    }

    case sessionsSetAcpSessionConfigOptionRoute.name: {
      const input = sessionsSetAcpSessionConfigOptionRoute.input.parse(rawInput)
      const state = await runtime.agentSessionPresenter.setAcpSessionConfigOption(
        input.sessionId,
        input.configId,
        input.value
      )
      return sessionsSetAcpSessionConfigOptionRoute.output.parse({ state })
    }

    case sessionsGetPermissionModeRoute.name: {
      const input = sessionsGetPermissionModeRoute.input.parse(rawInput)
      const mode = await runtime.agentSessionPresenter.getPermissionMode(input.sessionId)
      return sessionsGetPermissionModeRoute.output.parse({ mode })
    }

    case sessionsSetPermissionModeRoute.name: {
      const input = sessionsSetPermissionModeRoute.input.parse(rawInput)
      await runtime.agentSessionPresenter.setPermissionMode(input.sessionId, input.mode)
      return sessionsSetPermissionModeRoute.output.parse({ updated: true })
    }

    case sessionsSetSubagentEnabledRoute.name: {
      const input = sessionsSetSubagentEnabledRoute.input.parse(rawInput)
      const session = await runtime.agentSessionPresenter.setSessionSubagentEnabled(
        input.sessionId,
        input.enabled
      )
      return sessionsSetSubagentEnabledRoute.output.parse({ session })
    }

    case sessionsSetModelRoute.name: {
      const input = sessionsSetModelRoute.input.parse(rawInput)
      const session = await runtime.agentSessionPresenter.setSessionModel(
        input.sessionId,
        input.providerId,
        input.modelId
      )
      return sessionsSetModelRoute.output.parse({ session })
    }

    case sessionsSetProjectDirRoute.name: {
      const input = sessionsSetProjectDirRoute.input.parse(rawInput)
      const session = await runtime.agentSessionPresenter.setSessionProjectDir(
        input.sessionId,
        input.projectDir
      )
      return sessionsSetProjectDirRoute.output.parse({ session })
    }

    case sessionsGetGenerationSettingsRoute.name: {
      const input = sessionsGetGenerationSettingsRoute.input.parse(rawInput)
      const settings = await runtime.agentSessionPresenter.getSessionGenerationSettings(
        input.sessionId
      )
      return sessionsGetGenerationSettingsRoute.output.parse({ settings })
    }

    case sessionsGetDisabledAgentToolsRoute.name: {
      const input = sessionsGetDisabledAgentToolsRoute.input.parse(rawInput)
      const disabledAgentTools = await runtime.agentSessionPresenter.getSessionDisabledAgentTools(
        input.sessionId
      )
      return sessionsGetDisabledAgentToolsRoute.output.parse({ disabledAgentTools })
    }

    case sessionsUpdateDisabledAgentToolsRoute.name: {
      const input = sessionsUpdateDisabledAgentToolsRoute.input.parse(rawInput)
      const disabledAgentTools =
        await runtime.agentSessionPresenter.updateSessionDisabledAgentTools(
          input.sessionId,
          input.disabledAgentTools
        )
      return sessionsUpdateDisabledAgentToolsRoute.output.parse({ disabledAgentTools })
    }

    case sessionsUpdateGenerationSettingsRoute.name: {
      const input = sessionsUpdateGenerationSettingsRoute.input.parse(rawInput)
      const settings = await runtime.agentSessionPresenter.updateSessionGenerationSettings(
        input.sessionId,
        input.settings
      )
      return sessionsUpdateGenerationSettingsRoute.output.parse({ settings })
    }

    case skillsListMetadataRoute.name: {
      return await runTrackedRouteTask(runtime, routeName, context, async () => {
        skillsListMetadataRoute.input.parse(rawInput)
        const skills = await runtime.skillPresenter.getMetadataList()
        return skillsListMetadataRoute.output.parse({ skills })
      })
    }

    case skillsListCatalogRoute.name: {
      return await runTrackedRouteTask(runtime, routeName, context, async () => {
        skillsListCatalogRoute.input.parse(rawInput)
        const skills = await runtime.skillPresenter.getUnifiedSkillCatalog()
        return skillsListCatalogRoute.output.parse({ skills })
      })
    }

    case skillsSetDisabledRoute.name: {
      const input = skillsSetDisabledRoute.input.parse(rawInput)
      await runtime.skillPresenter.setSkillDeepChatDisabled(input.name, input.disabled)
      recordSkillUpdatedActivity(runtime, input.name, 'skill-disabled-state')
      return skillsSetDisabledRoute.output.parse({ saved: true })
    }

    case skillsGetDirectoryRoute.name: {
      skillsGetDirectoryRoute.input.parse(rawInput)
      const path = await runtime.skillPresenter.getSkillsDir()
      return skillsGetDirectoryRoute.output.parse({ path })
    }

    case skillsInstallFromFolderRoute.name: {
      const input = skillsInstallFromFolderRoute.input.parse(rawInput)
      const result = await runtime.skillPresenter.installFromFolder(input.folderPath, input.options)
      if (didSkillOperationSucceed(result)) {
        recordSkillSettingsActivity(runtime, 'created', 'skill folder source')
      }
      return skillsInstallFromFolderRoute.output.parse({ result })
    }

    case skillsInstallFromZipRoute.name: {
      const input = skillsInstallFromZipRoute.input.parse(rawInput)
      const result = await runtime.skillPresenter.installFromZip(input.zipPath, input.options)
      if (didSkillOperationSucceed(result)) {
        recordSkillSettingsActivity(runtime, 'created', 'skill zip source')
      }
      return skillsInstallFromZipRoute.output.parse({ result })
    }

    case skillsInstallFromUrlRoute.name: {
      const input = skillsInstallFromUrlRoute.input.parse(rawInput)
      const result = await runtime.skillPresenter.installFromUrl(input.url, input.options)
      if (didSkillOperationSucceed(result)) {
        recordSkillSettingsActivity(runtime, 'created', 'skill URL source')
      }
      return skillsInstallFromUrlRoute.output.parse({ result })
    }

    case skillsScanGitRepoRoute.name: {
      const input = skillsScanGitRepoRoute.input.parse(rawInput)
      const result = await runtime.skillPresenter.scanGitSkillRepo(input.repoUrl)
      return skillsScanGitRepoRoute.output.parse({ result })
    }

    case skillsInstallFromGitRoute.name: {
      const input = skillsInstallFromGitRoute.input.parse(rawInput)
      const results = await runtime.skillPresenter.installSkillsFromGit(input)
      if (results.some(didSkillOperationSucceed)) {
        recordSkillSettingsActivity(runtime, 'created', 'skill Git source')
      }
      return skillsInstallFromGitRoute.output.parse({ results })
    }

    case skillsGetSyncConfigRoute.name: {
      skillsGetSyncConfigRoute.input.parse(rawInput)
      const config = await runtime.skillPresenter.getSkillsSyncConfig()
      return skillsGetSyncConfigRoute.output.parse({ config })
    }

    case skillsSetSyncDirectoryRoute.name: {
      const input = skillsSetSyncDirectoryRoute.input.parse(rawInput)
      const config = await runtime.skillPresenter.setSkillsSyncDirectory(input)
      return skillsSetSyncDirectoryRoute.output.parse({ config })
    }

    case skillsPreviewSyncDirectoryExportRoute.name: {
      const input = skillsPreviewSyncDirectoryExportRoute.input.parse(rawInput)
      const preview = await runtime.skillPresenter.previewSyncDirectoryExport(input)
      return skillsPreviewSyncDirectoryExportRoute.output.parse({ preview })
    }

    case skillsExecuteSyncDirectoryExportRoute.name: {
      const input = skillsExecuteSyncDirectoryExportRoute.input.parse(rawInput)
      const result = await runtime.skillPresenter.executeSyncDirectoryExport(input)
      return skillsExecuteSyncDirectoryExportRoute.output.parse({ result })
    }

    case skillsPreviewSyncDirectoryImportRoute.name: {
      skillsPreviewSyncDirectoryImportRoute.input.parse(rawInput)
      const preview = await runtime.skillPresenter.previewSyncDirectoryImport()
      return skillsPreviewSyncDirectoryImportRoute.output.parse({ preview })
    }

    case skillsExecuteSyncDirectoryImportRoute.name: {
      const input = skillsExecuteSyncDirectoryImportRoute.input.parse(rawInput)
      const result = await runtime.skillPresenter.executeSyncDirectoryImport(input)
      return skillsExecuteSyncDirectoryImportRoute.output.parse({ result })
    }

    case skillsUninstallRoute.name: {
      const input = skillsUninstallRoute.input.parse(rawInput)
      const result = await runtime.skillPresenter.uninstallSkill(input.name)
      if (didSkillOperationSucceed(result)) {
        recordSkillRemovedActivity(runtime, input.name)
      }
      return skillsUninstallRoute.output.parse({ result })
    }

    case skillsReadFileRoute.name: {
      const input = skillsReadFileRoute.input.parse(rawInput)
      return skillsReadFileRoute.output.parse({
        content: await runtime.skillPresenter.readSkillFile(input.name)
      })
    }

    case skillsUpdateFileRoute.name: {
      const input = skillsUpdateFileRoute.input.parse(rawInput)
      const result = await runtime.skillPresenter.updateSkillFile(input.name, input.content)
      if (didSkillOperationSucceed(result)) {
        recordSkillUpdatedActivity(runtime, input.name)
      }
      return skillsUpdateFileRoute.output.parse({ result })
    }

    case skillsSaveWithExtensionRoute.name: {
      const input = skillsSaveWithExtensionRoute.input.parse(rawInput)
      const result = await runtime.skillPresenter.saveSkillWithExtension(
        input.name,
        input.content,
        input.config
      )
      if (didSkillOperationSucceed(result)) {
        recordSkillUpdatedActivity(runtime, input.name)
      }
      return skillsSaveWithExtensionRoute.output.parse({ result })
    }

    case skillsGetFolderTreeRoute.name: {
      const input = skillsGetFolderTreeRoute.input.parse(rawInput)
      const nodes = await runtime.skillPresenter.getSkillFolderTree(input.name)
      return skillsGetFolderTreeRoute.output.parse({ nodes })
    }

    case skillsOpenFolderRoute.name: {
      skillsOpenFolderRoute.input.parse(rawInput)
      await runtime.skillPresenter.openSkillsFolder()
      return skillsOpenFolderRoute.output.parse({ opened: true })
    }

    case skillsGetExtensionRoute.name: {
      const input = skillsGetExtensionRoute.input.parse(rawInput)
      const config = await runtime.skillPresenter.getSkillExtension(input.name)
      return skillsGetExtensionRoute.output.parse({ config })
    }

    case skillsSaveExtensionRoute.name: {
      const input = skillsSaveExtensionRoute.input.parse(rawInput)
      await runtime.skillPresenter.saveSkillExtension(input.name, input.config)
      recordSkillUpdatedActivity(runtime, `${input.name} extension`, 'skill-extension')
      return skillsSaveExtensionRoute.output.parse({ saved: true })
    }

    case skillsListScriptsRoute.name: {
      const input = skillsListScriptsRoute.input.parse(rawInput)
      const scripts = await runtime.skillPresenter.listSkillScripts(input.name)
      return skillsListScriptsRoute.output.parse({ scripts })
    }

    case skillsGetActiveRoute.name: {
      const input = skillsGetActiveRoute.input.parse(rawInput)
      const skills = await runtime.skillPresenter.getActiveSkills(input.conversationId)
      return skillsGetActiveRoute.output.parse({ skills })
    }

    case skillsSetActiveRoute.name: {
      const input = skillsSetActiveRoute.input.parse(rawInput)
      const skills = await runtime.skillPresenter.setActiveSkills(
        input.conversationId,
        input.skills
      )
      recordSettingsActivity(runtime, {
        category: 'knowledge',
        action: 'updated',
        targetType: 'active-skills',
        targetLabel: 'active skills',
        routeName: 'settings-skills',
        summaryKey: 'settings.controlCenter.activity.settingUpdated',
        summaryParams: {
          key: `active skills (${input.skills.length})`
        }
      })
      return skillsSetActiveRoute.output.parse({ skills })
    }

    case skillSyncScanExternalToolsRoute.name: {
      return await runTrackedRouteTask(runtime, routeName, context, async () => {
        skillSyncScanExternalToolsRoute.input.parse(rawInput)
        return skillSyncScanExternalToolsRoute.output.parse({
          results: await runtime.skillSyncPresenter.scanExternalTools()
        })
      })
    }

    case skillSyncGetNewDiscoveriesRoute.name: {
      skillSyncGetNewDiscoveriesRoute.input.parse(rawInput)
      return skillSyncGetNewDiscoveriesRoute.output.parse({
        discoveries: await runtime.skillSyncPresenter.getNewDiscoveries()
      })
    }

    case skillSyncAcknowledgeDiscoveriesRoute.name: {
      skillSyncAcknowledgeDiscoveriesRoute.input.parse(rawInput)
      await runtime.skillSyncPresenter.acknowledgeDiscoveries()
      return skillSyncAcknowledgeDiscoveriesRoute.output.parse({ acknowledged: true })
    }

    case skillSyncGetRegisteredToolsRoute.name: {
      skillSyncGetRegisteredToolsRoute.input.parse(rawInput)
      return skillSyncGetRegisteredToolsRoute.output.parse({
        tools: runtime.skillSyncPresenter.getRegisteredTools()
      })
    }

    case skillSyncScanAgentsRoute.name: {
      skillSyncScanAgentsRoute.input.parse(rawInput)
      return skillSyncScanAgentsRoute.output.parse({
        agents: await runtime.skillSyncPresenter.scanSkillAgents()
      })
    }

    case skillSyncGetAgentDetailRoute.name: {
      const input = skillSyncGetAgentDetailRoute.input.parse(rawInput)
      return skillSyncGetAgentDetailRoute.output.parse({
        agent: await runtime.skillSyncPresenter.scanSkillAgent({ agentId: input.agentId })
      })
    }

    case skillSyncGetAgentSkillDetailRoute.name: {
      const input = skillSyncGetAgentSkillDetailRoute.input.parse(rawInput)
      return skillSyncGetAgentSkillDetailRoute.output.parse({
        detail: await runtime.skillSyncPresenter.getAgentSkillDetail(input)
      })
    }

    case skillSyncPreviewAdoptAgentSkillRoute.name: {
      const input = skillSyncPreviewAdoptAgentSkillRoute.input.parse(rawInput)
      return skillSyncPreviewAdoptAgentSkillRoute.output.parse({
        preview: await runtime.skillSyncPresenter.previewAdoptAgentSkill(input)
      })
    }

    case skillSyncExecuteAdoptAgentSkillRoute.name: {
      const input = skillSyncExecuteAdoptAgentSkillRoute.input.parse(rawInput)
      return skillSyncExecuteAdoptAgentSkillRoute.output.parse({
        result: await runtime.skillSyncPresenter.executeAdoptAgentSkill(input)
      })
    }

    case skillSyncPreviewLinkDeepChatSkillsRoute.name: {
      const input = skillSyncPreviewLinkDeepChatSkillsRoute.input.parse(rawInput)
      return skillSyncPreviewLinkDeepChatSkillsRoute.output.parse({
        preview: await runtime.skillSyncPresenter.previewLinkDeepChatSkills(input)
      })
    }

    case skillSyncExecuteLinkDeepChatSkillsRoute.name: {
      const input = skillSyncExecuteLinkDeepChatSkillsRoute.input.parse(rawInput)
      return skillSyncExecuteLinkDeepChatSkillsRoute.output.parse({
        result: await runtime.skillSyncPresenter.executeLinkDeepChatSkills(input)
      })
    }

    case skillSyncRepairAgentSkillLinkRoute.name: {
      const input = skillSyncRepairAgentSkillLinkRoute.input.parse(rawInput)
      return skillSyncRepairAgentSkillLinkRoute.output.parse({
        result: await runtime.skillSyncPresenter.repairAgentSkillLink(input)
      })
    }

    case skillSyncRemoveAgentSkillLinkRoute.name: {
      const input = skillSyncRemoveAgentSkillLinkRoute.input.parse(rawInput)
      return skillSyncRemoveAgentSkillLinkRoute.output.parse({
        result: await runtime.skillSyncPresenter.removeAgentSkillLink(input)
      })
    }

    case skillSyncPreviewImportRoute.name: {
      const input = skillSyncPreviewImportRoute.input.parse(rawInput)
      return skillSyncPreviewImportRoute.output.parse({
        previews: await runtime.skillSyncPresenter.previewImport(input.toolId, input.skillNames)
      })
    }

    case skillSyncExecuteImportRoute.name: {
      const input = skillSyncExecuteImportRoute.input.parse(rawInput)
      return skillSyncExecuteImportRoute.output.parse({
        result: await runtime.skillSyncPresenter.executeImport(input.previews, input.strategies)
      })
    }

    case skillSyncPreviewExportRoute.name: {
      const input = skillSyncPreviewExportRoute.input.parse(rawInput)
      return skillSyncPreviewExportRoute.output.parse({
        previews: await runtime.skillSyncPresenter.previewExport(
          input.skillNames,
          input.targetToolId,
          input.options
        )
      })
    }

    case skillSyncExecuteExportRoute.name: {
      const input = skillSyncExecuteExportRoute.input.parse(rawInput)
      return skillSyncExecuteExportRoute.output.parse({
        result: await runtime.skillSyncPresenter.executeExport(input.previews, input.strategies)
      })
    }

    case mcpGetServersRoute.name: {
      return await runTrackedRouteTask(runtime, routeName, context, async () => {
        mcpGetServersRoute.input.parse(rawInput)
        const servers = await runtime.mcpPresenter.getMcpServers()
        return mcpGetServersRoute.output.parse({ servers })
      })
    }

    case mcpGetEnabledRoute.name: {
      return await runTrackedRouteTask(runtime, routeName, context, async () => {
        mcpGetEnabledRoute.input.parse(rawInput)
        const enabled = await runtime.mcpPresenter.getMcpEnabled()
        return mcpGetEnabledRoute.output.parse({ enabled })
      })
    }

    case mcpGetClientsRoute.name: {
      return await runTrackedRouteTask(runtime, routeName, context, async () => {
        mcpGetClientsRoute.input.parse(rawInput)
        const clients = await runtime.mcpPresenter.getMcpClients()
        return mcpGetClientsRoute.output.parse({ clients })
      })
    }

    case mcpListToolDefinitionsRoute.name: {
      const input = mcpListToolDefinitionsRoute.input.parse(rawInput)
      const tools = await runtime.mcpPresenter.getAllToolDefinitions(input.enabledMcpTools)
      return mcpListToolDefinitionsRoute.output.parse({ tools })
    }

    case mcpListPromptsRoute.name: {
      mcpListPromptsRoute.input.parse(rawInput)
      const prompts = await runtime.mcpPresenter.getAllPrompts()
      return mcpListPromptsRoute.output.parse({ prompts })
    }

    case mcpListResourcesRoute.name: {
      mcpListResourcesRoute.input.parse(rawInput)
      const resources = await runtime.mcpPresenter.getAllResources()
      return mcpListResourcesRoute.output.parse({ resources })
    }

    case mcpCallToolRoute.name: {
      const input = mcpCallToolRoute.input.parse(rawInput)
      const result = await runtime.mcpPresenter.callTool(input.request)
      return mcpCallToolRoute.output.parse(result)
    }

    case mcpAddServerRoute.name: {
      const input = mcpAddServerRoute.input.parse(rawInput)
      const success = await runtime.mcpPresenter.addMcpServer(input.serverName, input.config)
      if (success) {
        recordSettingsActivity(runtime, {
          category: 'mcp',
          action: 'created',
          targetType: 'mcp-server',
          targetId: input.serverName,
          targetLabel: input.serverName,
          routeName: 'settings-mcp',
          summaryKey: 'settings.controlCenter.activity.mcpServerCreated',
          summaryParams: {
            name: input.serverName
          }
        })
      }
      return mcpAddServerRoute.output.parse({ success })
    }

    case mcpUpdateServerRoute.name: {
      const input = mcpUpdateServerRoute.input.parse(rawInput)
      await runtime.mcpPresenter.updateMcpServer(input.serverName, input.config)
      recordSettingsActivity(runtime, {
        category: 'mcp',
        action: 'updated',
        targetType: 'mcp-server',
        targetId: input.serverName,
        targetLabel: input.serverName,
        routeName: 'settings-mcp',
        summaryKey: 'settings.controlCenter.activity.mcpServerUpdated',
        summaryParams: {
          name: input.serverName
        }
      })
      return mcpUpdateServerRoute.output.parse({ updated: true })
    }

    case mcpRemoveServerRoute.name: {
      const input = mcpRemoveServerRoute.input.parse(rawInput)
      await runtime.mcpPresenter.removeMcpServer(input.serverName)
      recordSettingsActivity(runtime, {
        category: 'mcp',
        action: 'removed',
        targetType: 'mcp-server',
        targetId: input.serverName,
        targetLabel: input.serverName,
        routeName: 'settings-mcp',
        summaryKey: 'settings.controlCenter.activity.mcpServerRemoved',
        summaryParams: {
          name: input.serverName
        }
      })
      return mcpRemoveServerRoute.output.parse({ removed: true })
    }

    case mcpSetServerEnabledRoute.name: {
      const input = mcpSetServerEnabledRoute.input.parse(rawInput)
      await runtime.mcpPresenter.setMcpServerEnabled(input.serverName, input.enabled)
      recordSettingsActivity(runtime, {
        category: 'mcp',
        action: input.enabled ? 'enabled' : 'disabled',
        targetType: 'mcp-server',
        targetId: input.serverName,
        targetLabel: input.serverName,
        routeName: 'settings-mcp',
        summaryKey: 'settings.controlCenter.activity.mcpServerStatusChanged',
        summaryParams: {
          name: input.serverName
        }
      })
      return mcpSetServerEnabledRoute.output.parse({ enabled: input.enabled })
    }

    case mcpSetEnabledRoute.name: {
      const input = mcpSetEnabledRoute.input.parse(rawInput)
      await runtime.mcpPresenter.setMcpEnabled(input.enabled)
      recordSettingsActivity(runtime, {
        category: 'mcp',
        action: input.enabled ? 'enabled' : 'disabled',
        targetType: 'mcp',
        targetId: 'global',
        targetLabel: 'MCP',
        routeName: 'settings-mcp',
        summaryKey: 'settings.controlCenter.activity.mcpGlobalStatusChanged',
        summaryParams: {
          status: input.enabled ? 'enabled' : 'disabled'
        }
      })
      return mcpSetEnabledRoute.output.parse({ enabled: input.enabled })
    }

    case mcpIsServerRunningRoute.name: {
      const input = mcpIsServerRunningRoute.input.parse(rawInput)
      const running = await runtime.mcpPresenter.isServerRunning(input.serverName)
      return mcpIsServerRunningRoute.output.parse({ running })
    }

    case mcpStartServerRoute.name: {
      const input = mcpStartServerRoute.input.parse(rawInput)
      await runtime.mcpPresenter.startServer(input.serverName)
      recordSettingsActivity(runtime, {
        category: 'mcp',
        action: 'enabled',
        targetType: 'mcp-server',
        targetId: input.serverName,
        targetLabel: input.serverName,
        routeName: 'settings-mcp',
        summaryKey: 'settings.controlCenter.activity.mcpServerStarted',
        summaryParams: {
          name: input.serverName
        }
      })
      return mcpStartServerRoute.output.parse({ started: true })
    }

    case mcpStopServerRoute.name: {
      const input = mcpStopServerRoute.input.parse(rawInput)
      await runtime.mcpPresenter.stopServer(input.serverName)
      recordSettingsActivity(runtime, {
        category: 'mcp',
        action: 'disabled',
        targetType: 'mcp-server',
        targetId: input.serverName,
        targetLabel: input.serverName,
        routeName: 'settings-mcp',
        summaryKey: 'settings.controlCenter.activity.mcpServerStopped',
        summaryParams: {
          name: input.serverName
        }
      })
      return mcpStopServerRoute.output.parse({ stopped: true })
    }

    case mcpGetPromptRoute.name: {
      const input = mcpGetPromptRoute.input.parse(rawInput)
      const result = await runtime.mcpPresenter.getPrompt(input.prompt, input.args)
      return mcpGetPromptRoute.output.parse({ result })
    }

    case mcpReadResourceRoute.name: {
      const input = mcpReadResourceRoute.input.parse(rawInput)
      const resource = await runtime.mcpPresenter.readResource(input.resource)
      return mcpReadResourceRoute.output.parse({ resource })
    }

    case mcpSubmitSamplingDecisionRoute.name: {
      const input = mcpSubmitSamplingDecisionRoute.input.parse(rawInput)
      await runtime.mcpPresenter.submitSamplingDecision(input.decision)
      return mcpSubmitSamplingDecisionRoute.output.parse({ submitted: true })
    }

    case mcpCancelSamplingRequestRoute.name: {
      const input = mcpCancelSamplingRequestRoute.input.parse(rawInput)
      await runtime.mcpPresenter.cancelSamplingRequest(input.requestId, input.reason)
      return mcpCancelSamplingRequestRoute.output.parse({ cancelled: true })
    }

    case mcpGetNpmRegistryStatusRoute.name: {
      return await runTrackedRouteTask(runtime, routeName, context, async () => {
        mcpGetNpmRegistryStatusRoute.input.parse(rawInput)
        if (!runtime.mcpPresenter.getNpmRegistryStatus) {
          throw new Error('NPM registry status is not available')
        }
        const status = await runtime.mcpPresenter.getNpmRegistryStatus()
        return mcpGetNpmRegistryStatusRoute.output.parse({ status })
      })
    }

    case mcpRefreshNpmRegistryRoute.name: {
      mcpRefreshNpmRegistryRoute.input.parse(rawInput)
      if (!runtime.mcpPresenter.refreshNpmRegistry) {
        throw new Error('NPM registry refresh is not available')
      }
      const registry = await runtime.mcpPresenter.refreshNpmRegistry()
      recordSettingsActivity(runtime, {
        category: 'mcp',
        action: 'refreshed',
        targetType: 'npm-registry',
        targetId: 'npm',
        targetLabel: registry,
        routeName: 'settings-mcp',
        summaryKey: 'settings.controlCenter.activity.mcpRegistryRefreshed',
        summaryParams: {}
      })
      return mcpRefreshNpmRegistryRoute.output.parse({ registry })
    }

    case mcpSetCustomNpmRegistryRoute.name: {
      const input = mcpSetCustomNpmRegistryRoute.input.parse(rawInput)
      if (!runtime.mcpPresenter.setCustomNpmRegistry) {
        throw new Error('Custom NPM registry is not available')
      }
      await runtime.mcpPresenter.setCustomNpmRegistry(input.registry)
      return mcpSetCustomNpmRegistryRoute.output.parse({ updated: true })
    }

    case mcpSetAutoDetectNpmRegistryRoute.name: {
      const input = mcpSetAutoDetectNpmRegistryRoute.input.parse(rawInput)
      if (!runtime.mcpPresenter.setAutoDetectNpmRegistry) {
        throw new Error('Auto detect NPM registry is not available')
      }
      await runtime.mcpPresenter.setAutoDetectNpmRegistry(input.enabled)
      return mcpSetAutoDetectNpmRegistryRoute.output.parse({ enabled: input.enabled })
    }

    case mcpClearNpmRegistryCacheRoute.name: {
      mcpClearNpmRegistryCacheRoute.input.parse(rawInput)
      if (!runtime.mcpPresenter.clearNpmRegistryCache) {
        throw new Error('NPM registry cache clearing is not available')
      }
      await runtime.mcpPresenter.clearNpmRegistryCache()
      return mcpClearNpmRegistryCacheRoute.output.parse({ cleared: true })
    }

    case mcpRouterListServersRoute.name: {
      const input = mcpRouterListServersRoute.input.parse(rawInput)
      const data = await runtime.mcpPresenter.listMcpRouterServers?.(input.page, input.limit)
      return mcpRouterListServersRoute.output.parse({
        servers: data?.servers ?? []
      })
    }

    case mcpRouterInstallServerRoute.name: {
      const input = mcpRouterInstallServerRoute.input.parse(rawInput)
      return mcpRouterInstallServerRoute.output.parse({
        installed: (await runtime.mcpPresenter.installMcpRouterServer?.(input.serverKey)) ?? false
      })
    }

    case mcpRouterGetApiKeyRoute.name: {
      mcpRouterGetApiKeyRoute.input.parse(rawInput)
      return mcpRouterGetApiKeyRoute.output.parse({
        key: (await runtime.mcpPresenter.getMcpRouterApiKey?.()) ?? ''
      })
    }

    case mcpRouterSetApiKeyRoute.name: {
      const input = mcpRouterSetApiKeyRoute.input.parse(rawInput)
      await runtime.mcpPresenter.setMcpRouterApiKey?.(input.key)
      return mcpRouterSetApiKeyRoute.output.parse({ saved: true })
    }

    case mcpRouterIsServerInstalledRoute.name: {
      const input = mcpRouterIsServerInstalledRoute.input.parse(rawInput)
      return mcpRouterIsServerInstalledRoute.output.parse({
        installed:
          (await runtime.mcpPresenter.isServerInstalled?.(input.source, input.sourceId)) ?? false
      })
    }

    case mcpRouterUpdateServersAuthRoute.name: {
      const input = mcpRouterUpdateServersAuthRoute.input.parse(rawInput)
      await runtime.mcpPresenter.updateMcpRouterServersAuth?.(input.apiKey)
      return mcpRouterUpdateServersAuthRoute.output.parse({ updated: true })
    }

    case remoteControlListChannelsRoute.name: {
      remoteControlListChannelsRoute.input.parse(rawInput)
      const channels = await runtime.remoteControlPresenter.listRemoteChannels()
      return remoteControlListChannelsRoute.output.parse({ channels })
    }

    case remoteControlGetChannelSettingsRoute.name: {
      const input = remoteControlGetChannelSettingsRoute.input.parse(rawInput)
      const settings = await runtime.remoteControlPresenter.getChannelSettings(input.channel)
      return remoteControlGetChannelSettingsRoute.output.parse({ settings })
    }

    case remoteControlSaveChannelSettingsRoute.name: {
      const input = remoteControlSaveChannelSettingsRoute.input.parse(rawInput)
      const settings = await runtime.remoteControlPresenter.saveChannelSettings(
        input.channel,
        input.settings
      )
      return remoteControlSaveChannelSettingsRoute.output.parse({ settings })
    }

    case remoteControlGetChannelStatusRoute.name: {
      const input = remoteControlGetChannelStatusRoute.input.parse(rawInput)
      const status = await runtime.remoteControlPresenter.getChannelStatus(input.channel)
      return remoteControlGetChannelStatusRoute.output.parse({ status })
    }

    case remoteControlGetChannelBindingsRoute.name: {
      const input = remoteControlGetChannelBindingsRoute.input.parse(rawInput)
      const bindings = await runtime.remoteControlPresenter.getChannelBindings(input.channel)
      return remoteControlGetChannelBindingsRoute.output.parse({ bindings })
    }

    case remoteControlRemoveChannelBindingRoute.name: {
      const input = remoteControlRemoveChannelBindingRoute.input.parse(rawInput)
      await runtime.remoteControlPresenter.removeChannelBinding(input.channel, input.endpointKey)
      return remoteControlRemoveChannelBindingRoute.output.parse({ removed: true })
    }

    case remoteControlRemoveChannelPrincipalRoute.name: {
      const input = remoteControlRemoveChannelPrincipalRoute.input.parse(rawInput)
      await runtime.remoteControlPresenter.removeChannelPrincipal(input.channel, input.principalId)
      return remoteControlRemoveChannelPrincipalRoute.output.parse({ removed: true })
    }

    case remoteControlGetChannelPairingSnapshotRoute.name: {
      const input = remoteControlGetChannelPairingSnapshotRoute.input.parse(rawInput)
      const snapshot = await runtime.remoteControlPresenter.getChannelPairingSnapshot(input.channel)
      return remoteControlGetChannelPairingSnapshotRoute.output.parse({ snapshot })
    }

    case remoteControlCreateChannelPairCodeRoute.name: {
      const input = remoteControlCreateChannelPairCodeRoute.input.parse(rawInput)
      const result = await runtime.remoteControlPresenter.createChannelPairCode(input.channel)
      return remoteControlCreateChannelPairCodeRoute.output.parse(result)
    }

    case remoteControlClearChannelPairCodeRoute.name: {
      const input = remoteControlClearChannelPairCodeRoute.input.parse(rawInput)
      await runtime.remoteControlPresenter.clearChannelPairCode(input.channel)
      return remoteControlClearChannelPairCodeRoute.output.parse({ cleared: true })
    }

    case remoteControlGetTelegramStatusRoute.name: {
      remoteControlGetTelegramStatusRoute.input.parse(rawInput)
      const status = await runtime.remoteControlPresenter.getTelegramStatus()
      return remoteControlGetTelegramStatusRoute.output.parse({ status })
    }

    case remoteControlStartFeishuAuthRoute.name: {
      const input = remoteControlStartFeishuAuthRoute.input.parse(rawInput)
      const session = await runtime.remoteControlPresenter.startFeishuAuth(input)
      return remoteControlStartFeishuAuthRoute.output.parse({ session })
    }

    case remoteControlWaitForFeishuAuthRoute.name: {
      const input = remoteControlWaitForFeishuAuthRoute.input.parse(rawInput)
      const result = await runtime.remoteControlPresenter.waitForFeishuAuth(input)
      return remoteControlWaitForFeishuAuthRoute.output.parse({ result })
    }

    case remoteControlCancelFeishuAuthRoute.name: {
      const input = remoteControlCancelFeishuAuthRoute.input.parse(rawInput)
      await runtime.remoteControlPresenter.cancelFeishuAuth(input.sessionKey)
      return remoteControlCancelFeishuAuthRoute.output.parse({ cancelled: true })
    }

    case remoteControlStartFeishuInstallRoute.name: {
      const input = remoteControlStartFeishuInstallRoute.input.parse(rawInput)
      const session = await runtime.remoteControlPresenter.startFeishuInstall(input)
      return remoteControlStartFeishuInstallRoute.output.parse({ session })
    }

    case remoteControlWaitForFeishuInstallRoute.name: {
      const input = remoteControlWaitForFeishuInstallRoute.input.parse(rawInput)
      const result = await runtime.remoteControlPresenter.waitForFeishuInstall(input)
      return remoteControlWaitForFeishuInstallRoute.output.parse({ result })
    }

    case remoteControlCancelFeishuInstallRoute.name: {
      const input = remoteControlCancelFeishuInstallRoute.input.parse(rawInput)
      await runtime.remoteControlPresenter.cancelFeishuInstall(input.sessionKey)
      return remoteControlCancelFeishuInstallRoute.output.parse({ cancelled: true })
    }

    case remoteControlGetWeixinIlinkStatusRoute.name: {
      remoteControlGetWeixinIlinkStatusRoute.input.parse(rawInput)
      const status = await runtime.remoteControlPresenter.getWeixinIlinkStatus()
      return remoteControlGetWeixinIlinkStatusRoute.output.parse({ status })
    }

    case remoteControlStartWeixinIlinkLoginRoute.name: {
      const input = remoteControlStartWeixinIlinkLoginRoute.input.parse(rawInput)
      const session = await runtime.remoteControlPresenter.startWeixinIlinkLogin(input)
      return remoteControlStartWeixinIlinkLoginRoute.output.parse({ session })
    }

    case remoteControlWaitForWeixinIlinkLoginRoute.name: {
      const input = remoteControlWaitForWeixinIlinkLoginRoute.input.parse(rawInput)
      const result = await runtime.remoteControlPresenter.waitForWeixinIlinkLogin(input)
      return remoteControlWaitForWeixinIlinkLoginRoute.output.parse({ result })
    }

    case remoteControlRemoveWeixinIlinkAccountRoute.name: {
      const input = remoteControlRemoveWeixinIlinkAccountRoute.input.parse(rawInput)
      await runtime.remoteControlPresenter.removeWeixinIlinkAccount(input.accountId)
      return remoteControlRemoveWeixinIlinkAccountRoute.output.parse({ removed: true })
    }

    case remoteControlRestartWeixinIlinkAccountRoute.name: {
      const input = remoteControlRestartWeixinIlinkAccountRoute.input.parse(rawInput)
      await runtime.remoteControlPresenter.restartWeixinIlinkAccount(input.accountId)
      return remoteControlRestartWeixinIlinkAccountRoute.output.parse({ restarted: true })
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
      const result = await runtime.syncPresenter.importFromSync(input.backupFile, input.mode)
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
      const result = await runtime.syncPresenter.pullLatestBackupFromCloud(input.mode)
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

    case toolsListDefinitionsRoute.name: {
      const input = toolsListDefinitionsRoute.input.parse(rawInput)
      const tools = await runtime.toolPresenter.getAllToolDefinitions(input)
      return toolsListDefinitionsRoute.output.parse({ tools })
    }

    case providersListModelsRoute.name: {
      const input = providersListModelsRoute.input.parse(rawInput)
      return providersListModelsRoute.output.parse(
        await runtime.providerService.listModels(input.providerId)
      )
    }

    case providersTestConnectionRoute.name: {
      const input = providersTestConnectionRoute.input.parse(rawInput)
      return providersTestConnectionRoute.output.parse(
        await runtime.providerService.testConnection(input)
      )
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
