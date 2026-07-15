import { BrowserWindow, app, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import type {
  IConfigPresenter,
  IConversationExporter,
  IDevicePresenter,
  IDialogPresenter,
  FileServicePort,
  IProjectPresenter,
  ISQLitePresenter,
  IShortcutPresenter,
  ISyncPresenter,
  ITabPresenter,
  IUpgradePresenter,
  IWindowPresenter,
  WorkspaceServicePort,
  IYoBrowserPresenter,
  CloudSyncResult
} from '@shared/presenter'
import type { KnowledgeServicePort } from '@shared/types/knowledge'
import { DEEPCHAT_ROUTE_INVOKE_CHANNEL } from '@shared/contracts/channels'
import { projectEnvironmentsChangedEvent, sessionsUpdatedEvent } from '@shared/contracts/events'
import { isAgentMemoryCategory } from '@shared/types/agent-memory'
import { parseAgentMemorySourceEntryIds } from '@shared/lib/agentMemoryLineage'
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
  memoryAddRoute,
  memoryArchiveRoute,
  memoryApprovePersonaDraftRoute,
  memoryClearRoute,
  memoryDeleteRoute,
  memoryGetByIdsRoute,
  memoryGetSourceSpanRoute,
  memoryGetHealthRoute,
  memoryGetArchiveCandidateLifecyclePreviewRoute,
  memoryGetLifecycleRoute,
  memoryGetStatusRoute,
  memoryListAuditEventsRoute,
  memoryListConflictsRoute,
  memoryListPersonaDraftsRoute,
  memoryListPersonaVersionsRoute,
  memoryPageRoute,
  memoryListRoute,
  memoryListViewManifestsRoute,
  memoryRejectPersonaDraftRoute,
  memoryReindexRoute,
  memoryResolveConflictRoute,
  memoryRestoreRoute,
  memoryRollbackPersonaRoute,
  memorySearchRoute,
  memorySetPersonaAnchorRoute,
  memoryUpdateRoute,
  decodeMemoryPageCursor,
  encodeMemoryPageCursor,
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
  projectArchiveEnvironmentRoute,
  projectListEnvironmentsRoute,
  projectListRecentRoute,
  projectOpenDirectoryRoute,
  projectPathExistsRoute,
  projectRemoveEnvironmentRoute,
  projectReorderEnvironmentsRoute,
  projectRestoreEnvironmentRoute,
  projectSelectDirectoryRoute,
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
  shortcutDestroyRoute,
  shortcutRegisterRoute,
  shortcutUnregisterRoute,
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
  tabCaptureCurrentAreaRoute,
  tabStitchImagesWithWatermarkRoute,
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
  type DatabaseSecurityStatus,
  type SettingsActivityInput
} from '@shared/contracts/routes'
import {
  createEmptyArchiveCandidateLifecyclePreview,
  createEmptyMemoryHealth
} from '@shared/contracts/routes/memory.routes'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import { buildEffectiveTapeView } from '@/session/data/tapeEffectiveView'
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
import type { MemoryServicePort } from '@/memory'
import type { MemoryWriteOutcome } from '@/memory/types'
import type { CanonicalAgentMemoryRow as AgentMemoryRow } from '@/memory/domain/types'
import { projectLegacyStatus } from '@/memory/domain/stateModel'
import type { AgentMemoryAuditRow } from '@/memory/domain/audit'
import type { DeepChatTapeEntryRow } from '@/presenter/sqlitePresenter/tables/deepchatTapeEntries'
import type { SQLitePresenter } from '@/presenter/sqlitePresenter'
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

const MEMORY_PERSONA_STATES = ['draft', 'active', 'superseded', 'rejected'] as const
type MemoryPersonaState = (typeof MEMORY_PERSONA_STATES)[number]
const MEMORY_PERSONA_STATE_SET: ReadonlySet<string> = new Set(MEMORY_PERSONA_STATES)

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
  shortcutPresenter: IShortcutPresenter
  syncPresenter: ISyncPresenter
  upgradePresenter: IUpgradePresenter
  dialogPresenter: IDialogPresenter
  settingsHandler: ReturnType<typeof createSettingsRouteHandler>
  sqlitePresenter: ISQLitePresenter
  sessionService: SessionService
  chatService: ChatService
  windowPresenter: IWindowPresenter
  devicePresenter: IDevicePresenter
  projectPresenter: IProjectPresenter
  fileService: FileServicePort
  knowledgeService: KnowledgeServicePort
  workspaceService: WorkspaceServicePort
  yoBrowserPresenter: IYoBrowserPresenter
  tabPresenter: ITabPresenter
  startupWorkloadCoordinator: StartupWorkloadCoordinator
  databaseSecurityPresenter: DatabaseSecurityPresenter
  memoryService: MemoryServicePort
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

export function toMemoryItemDto(row: AgentMemoryRow) {
  return {
    id: row.id,
    agentId: row.agent_id,
    kind: row.kind,
    category: normalizeMemoryCategory(row.category),
    content: row.content,
    importance: row.importance,
    status: projectLegacyStatus(row.lifecycle_state, row.embedding_state),
    sourceSession: row.source_session,
    sourceEntryIds: parseAgentMemorySourceEntryIds(row.source_entry_ids),
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

function deriveSelectedMemoryIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const ids: string[] = []
  const seen = new Set<string>()
  const pushId = (id: string): void => {
    if (id.length === 0 || seen.has(id)) return
    seen.add(id)
    ids.push(id)
  }
  for (const item of value) {
    if (typeof item === 'string' && item.length > 0) {
      pushId(item)
      continue
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const id = (item as Record<string, unknown>).id
      if (typeof id === 'string') pushId(id)
    }
  }
  return ids
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
    selectedIds: deriveSelectedMemoryIds(record.selected),
    droppedCount: Array.isArray(record.dropped) ? record.dropped.length : 0,
    queryHash: typeof record.queryHash === 'string' ? record.queryHash : null,
    createdAt: row.created_at
  }
}

function getMemorySourceSpan(runtime: MainKernelRouteRuntime, agentId: string, memoryId: string) {
  const [row] = runtime.memoryService.getManagementVisibleByIds(agentId, [memoryId])
  if (!row || row.agent_id !== agentId || !row.source_session) return null
  const sourceEntryIds = parseAgentMemorySourceEntryIds(row.source_entry_ids)
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
  shortcutPresenter: IShortcutPresenter
  syncPresenter: ISyncPresenter
  upgradePresenter: IUpgradePresenter
  dialogPresenter: IDialogPresenter
  sqlitePresenter?: ISQLitePresenter
  windowPresenter: IWindowPresenter
  devicePresenter: IDevicePresenter
  projectPresenter: IProjectPresenter
  fileService: FileServicePort
  knowledgeService: KnowledgeServicePort
  workspaceService: WorkspaceServicePort
  yoBrowserPresenter: IYoBrowserPresenter
  tabPresenter: ITabPresenter
  startupWorkloadCoordinator: StartupWorkloadCoordinator
  databaseSecurityPresenter: DatabaseSecurityPresenter
  memoryService: MemoryServicePort
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
    shortcutPresenter: deps.shortcutPresenter,
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
    projectPresenter: deps.projectPresenter,
    fileService: deps.fileService,
    knowledgeService: deps.knowledgeService,
    workspaceService: deps.workspaceService,
    yoBrowserPresenter: deps.yoBrowserPresenter,
    tabPresenter: deps.tabPresenter,
    startupWorkloadCoordinator: deps.startupWorkloadCoordinator,
    databaseSecurityPresenter: deps.databaseSecurityPresenter,
    memoryService: deps.memoryService,
    reconcileSchedulerAfterAgentChange: deps.reconcileSchedulerAfterAgentChange,
    usageStatsService: deps.usageStatsService,
    rtkRuntimeService: deps.rtkRuntimeService,
    sessionHistorySearch: deps.sessionHistorySearch,
    agentSessionExportService: deps.agentSessionExportService,
    sessionTranslation: deps.sessionTranslation
  }
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
      await runtime.appDataReset.resetDataByType(input.resetType)
      return deviceResetDataByTypeRoute.output.parse({ reset: true })
    }

    case deviceSanitizeSvgRoute.name: {
      const input = deviceSanitizeSvgRoute.input.parse(rawInput)
      return deviceSanitizeSvgRoute.output.parse({
        content: await runtime.devicePresenter.sanitizeSvgContent(input.svgContent)
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
        mimeType: await runtime.fileService.getMimeType(input.path)
      })
    }

    case filePrepareFileRoute.name: {
      const input = filePrepareFileRoute.input.parse(rawInput)
      return filePrepareFileRoute.output.parse({
        file: await runtime.fileService.prepareFile(input.path, input.mimeType)
      })
    }

    case filePrepareDirectoryRoute.name: {
      const input = filePrepareDirectoryRoute.input.parse(rawInput)
      return filePrepareDirectoryRoute.output.parse({
        file: await runtime.fileService.prepareDirectory(input.path)
      })
    }

    case fileReadFileRoute.name: {
      const input = fileReadFileRoute.input.parse(rawInput)
      return fileReadFileRoute.output.parse({
        content: await runtime.fileService.readFile(input.path)
      })
    }

    case fileIsDirectoryRoute.name: {
      const input = fileIsDirectoryRoute.input.parse(rawInput)
      return fileIsDirectoryRoute.output.parse({
        isDirectory: await runtime.fileService.isDirectory(input.path)
      })
    }

    case fileWriteImageBase64Route.name: {
      const input = fileWriteImageBase64Route.input.parse(rawInput)
      return fileWriteImageBase64Route.output.parse({
        path: await runtime.fileService.writeImageBase64(input)
      })
    }

    case fileSaveImageRoute.name: {
      const input = fileSaveImageRoute.input.parse(rawInput)
      return fileSaveImageRoute.output.parse(await runtime.fileService.saveImage(input))
    }

    case fileCopyImageRoute.name: {
      const input = fileCopyImageRoute.input.parse(rawInput)
      return fileCopyImageRoute.output.parse(await runtime.fileService.copyImage(input))
    }

    case knowledgeIsSupportedRoute.name: {
      knowledgeIsSupportedRoute.input.parse(rawInput)
      return knowledgeIsSupportedRoute.output.parse({
        supported: await runtime.knowledgeService.isSupported()
      })
    }

    case knowledgeGetSupportedLanguagesRoute.name: {
      knowledgeGetSupportedLanguagesRoute.input.parse(rawInput)
      return knowledgeGetSupportedLanguagesRoute.output.parse({
        languages: await runtime.knowledgeService.getSupportedLanguages()
      })
    }

    case knowledgeGetSeparatorsForLanguageRoute.name: {
      const input = knowledgeGetSeparatorsForLanguageRoute.input.parse(rawInput)
      return knowledgeGetSeparatorsForLanguageRoute.output.parse({
        separators: await runtime.knowledgeService.getSeparatorsForLanguage(input.language)
      })
    }

    case knowledgeGetSupportedFileExtensionsRoute.name: {
      knowledgeGetSupportedFileExtensionsRoute.input.parse(rawInput)
      return knowledgeGetSupportedFileExtensionsRoute.output.parse({
        extensions: await runtime.knowledgeService.getSupportedFileExtensions()
      })
    }

    case knowledgeListFilesRoute.name: {
      const input = knowledgeListFilesRoute.input.parse(rawInput)
      return knowledgeListFilesRoute.output.parse({
        files: await runtime.knowledgeService.listFiles(input.knowledgeBaseId)
      })
    }

    case knowledgeSimilarityQueryRoute.name: {
      const input = knowledgeSimilarityQueryRoute.input.parse(rawInput)
      return knowledgeSimilarityQueryRoute.output.parse({
        results: await runtime.knowledgeService.similarityQuery(input.knowledgeBaseId, input.query)
      })
    }

    case knowledgeValidateFileRoute.name: {
      const input = knowledgeValidateFileRoute.input.parse(rawInput)
      return knowledgeValidateFileRoute.output.parse({
        result: await runtime.knowledgeService.validateFile(input.filePath)
      })
    }

    case knowledgeAddFileRoute.name: {
      const input = knowledgeAddFileRoute.input.parse(rawInput)
      return knowledgeAddFileRoute.output.parse({
        result: await runtime.knowledgeService.addFile(input.knowledgeBaseId, input.filePath)
      })
    }

    case knowledgeDeleteFileRoute.name: {
      const input = knowledgeDeleteFileRoute.input.parse(rawInput)
      await runtime.knowledgeService.deleteFile(input.knowledgeBaseId, input.fileId)
      return knowledgeDeleteFileRoute.output.parse({ deleted: true })
    }

    case knowledgeReAddFileRoute.name: {
      const input = knowledgeReAddFileRoute.input.parse(rawInput)
      return knowledgeReAddFileRoute.output.parse({
        result: await runtime.knowledgeService.reAddFile(input.knowledgeBaseId, input.fileId)
      })
    }

    case knowledgePauseAllRunningTasksRoute.name: {
      const input = knowledgePauseAllRunningTasksRoute.input.parse(rawInput)
      await runtime.knowledgeService.pauseAllRunningTasks(input.knowledgeBaseId)
      return knowledgePauseAllRunningTasksRoute.output.parse({ paused: true })
    }

    case knowledgeResumeAllPausedTasksRoute.name: {
      const input = knowledgeResumeAllPausedTasksRoute.input.parse(rawInput)
      await runtime.knowledgeService.resumeAllPausedTasks(input.knowledgeBaseId)
      return knowledgeResumeAllPausedTasksRoute.output.parse({ resumed: true })
    }

    case workspaceRegisterRoute.name: {
      const input = workspaceRegisterRoute.input.parse(rawInput)
      await runtime.workspaceService.registerWorkspace(input.workspacePath)
      return workspaceRegisterRoute.output.parse({ registered: true })
    }

    case workspaceUnregisterRoute.name: {
      const input = workspaceUnregisterRoute.input.parse(rawInput)
      await runtime.workspaceService.unregisterWorkspace(input.workspacePath)
      return workspaceUnregisterRoute.output.parse({ unregistered: true })
    }

    case workspaceWatchRoute.name: {
      const input = workspaceWatchRoute.input.parse(rawInput)
      await runtime.workspaceService.watchWorkspace(input.workspacePath)
      return workspaceWatchRoute.output.parse({ watching: true })
    }

    case workspaceUnwatchRoute.name: {
      const input = workspaceUnwatchRoute.input.parse(rawInput)
      await runtime.workspaceService.unwatchWorkspace(input.workspacePath)
      return workspaceUnwatchRoute.output.parse({ watching: false })
    }

    case workspaceReadDirectoryRoute.name: {
      const input = workspaceReadDirectoryRoute.input.parse(rawInput)
      return workspaceReadDirectoryRoute.output.parse({
        nodes: await runtime.workspaceService.readDirectory(input.path)
      })
    }

    case workspaceExpandDirectoryRoute.name: {
      const input = workspaceExpandDirectoryRoute.input.parse(rawInput)
      return workspaceExpandDirectoryRoute.output.parse({
        nodes: await runtime.workspaceService.expandDirectory(input.path)
      })
    }

    case workspaceRevealFileInFolderRoute.name: {
      const input = workspaceRevealFileInFolderRoute.input.parse(rawInput)
      await runtime.workspaceService.revealFileInFolder(input.path)
      return workspaceRevealFileInFolderRoute.output.parse({ revealed: true })
    }

    case workspaceOpenFileRoute.name: {
      const input = workspaceOpenFileRoute.input.parse(rawInput)
      await runtime.workspaceService.openFile(input.path)
      return workspaceOpenFileRoute.output.parse({ opened: true })
    }

    case workspaceReadFilePreviewRoute.name: {
      const input = workspaceReadFilePreviewRoute.input.parse(rawInput)
      return workspaceReadFilePreviewRoute.output.parse({
        preview: await runtime.workspaceService.readFilePreview(input.path)
      })
    }

    case workspaceResolveMarkdownLinkedFileRoute.name: {
      const input = workspaceResolveMarkdownLinkedFileRoute.input.parse(rawInput)
      return workspaceResolveMarkdownLinkedFileRoute.output.parse({
        resolution: await runtime.workspaceService.resolveMarkdownLinkedFile(input)
      })
    }

    case workspaceGetGitStatusRoute.name: {
      const input = workspaceGetGitStatusRoute.input.parse(rawInput)
      return workspaceGetGitStatusRoute.output.parse({
        state: await runtime.workspaceService.getGitStatus(input.workspacePath)
      })
    }

    case workspaceGetGitDiffRoute.name: {
      const input = workspaceGetGitDiffRoute.input.parse(rawInput)
      return workspaceGetGitDiffRoute.output.parse({
        diff: await runtime.workspaceService.getGitDiff(input.workspacePath, input.filePath)
      })
    }

    case workspaceSearchFilesRoute.name: {
      const input = workspaceSearchFilesRoute.input.parse(rawInput)
      return workspaceSearchFilesRoute.output.parse({
        nodes: await runtime.workspaceService.searchFiles(input.workspacePath, input.query)
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

    case memoryListRoute.name: {
      const input = memoryListRoute.input.parse(rawInput)
      const memories = runtime.memoryService.listMemories(input.agentId).map(toMemoryItemDto)
      return memoryListRoute.output.parse({ memories })
    }

    case memoryPageRoute.name: {
      const input = memoryPageRoute.input.parse(rawInput)
      const cursor = input.cursor ? decodeMemoryPageCursor(input.cursor) : null
      const agentType = await runtime.configPresenter.getAgentType(input.agentId)
      if (agentType !== 'deepchat') {
        return memoryPageRoute.output.parse({ items: [], nextCursor: null })
      }
      const page = runtime.memoryService.pageMemories(input.agentId, cursor, input.limit)
      return memoryPageRoute.output.parse({
        items: page.rows.map(toMemoryItemDto),
        nextCursor: page.nextCursor ? encodeMemoryPageCursor({ v: 1, ...page.nextCursor }) : null
      })
    }

    case memorySearchRoute.name: {
      const input = memorySearchRoute.input.parse(rawInput)
      const hits = await runtime.memoryService.searchMemories(input.agentId, input.query, {
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
      const outcome = await runtime.memoryService.addUserMemory(
        input.agentId,
        {
          content: input.content,
          kind: input.kind,
          category: input.category,
          importance: input.importance
        },
        input.sessionId
      )
      return memoryAddRoute.output.parse({ result: toMemoryAddResultDto(outcome) })
    }

    case memoryUpdateRoute.name: {
      const input = memoryUpdateRoute.input.parse(rawInput)
      const agentType = await runtime.configPresenter.getAgentType(input.agentId)
      if (agentType !== 'deepchat') {
        return memoryUpdateRoute.output.parse({ result: { action: 'noop' } })
      }
      const result = runtime.memoryService.updateMemory(input.agentId, input.memoryId, input.patch)
      return memoryUpdateRoute.output.parse({ result })
    }

    case memoryGetByIdsRoute.name: {
      const input = memoryGetByIdsRoute.input.parse(rawInput)
      const agentType = await runtime.configPresenter.getAgentType(input.agentId)
      if (agentType !== 'deepchat') {
        return memoryGetByIdsRoute.output.parse({ memories: [] })
      }
      const memories = runtime.memoryService
        .getByIds(input.agentId, input.memoryIds)
        .map(toMemoryItemDto)
      return memoryGetByIdsRoute.output.parse({ memories })
    }

    case memoryGetStatusRoute.name: {
      const input = memoryGetStatusRoute.input.parse(rawInput)
      return memoryGetStatusRoute.output.parse({
        status: runtime.memoryService.getStatus(input.agentId)
      })
    }

    case memoryGetHealthRoute.name: {
      const input = memoryGetHealthRoute.input.parse(rawInput)
      const agentType = await runtime.configPresenter.getAgentType(input.agentId)
      if (agentType !== 'deepchat') {
        return memoryGetHealthRoute.output.parse({ health: createEmptyMemoryHealth() })
      }
      return memoryGetHealthRoute.output.parse({
        health: runtime.memoryService.getHealth(input.agentId)
      })
    }

    case memoryReindexRoute.name: {
      const input = memoryReindexRoute.input.parse(rawInput)
      const agentType = await runtime.configPresenter.getAgentType(input.agentId)
      if (agentType !== 'deepchat' || !runtime.memoryService.canReindex(input.agentId)) {
        return memoryReindexRoute.output.parse({ started: false })
      }
      const already = runtime.memoryService.isReindexing(input.agentId)
      void runtime.memoryService.reindexEmbeddings(input.agentId, true).catch((error) => {
        console.warn(`[Memory] manual reindex failed for ${input.agentId}: ${String(error)}`)
      })
      return memoryReindexRoute.output.parse({ started: !already })
    }

    case memoryGetLifecycleRoute.name: {
      const input = memoryGetLifecycleRoute.input.parse(rawInput)
      const agentType = await runtime.configPresenter.getAgentType(input.agentId)
      if (agentType !== 'deepchat') {
        return memoryGetLifecycleRoute.output.parse({ lifecycle: null })
      }
      return memoryGetLifecycleRoute.output.parse({
        lifecycle: runtime.memoryService.getLifecycle(input.agentId, input.memoryId)
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
        preview: runtime.memoryService.getArchiveCandidateLifecyclePreview(input.agentId)
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
      const ok = await runtime.memoryService.deleteMemory(input.agentId, input.memoryId)
      return memoryDeleteRoute.output.parse({ ok })
    }

    case memoryArchiveRoute.name: {
      const input = memoryArchiveRoute.input.parse(rawInput)
      const agentType = await runtime.configPresenter.getAgentType(input.agentId)
      if (agentType !== 'deepchat') {
        return memoryArchiveRoute.output.parse({ ok: false })
      }
      const ok = await runtime.memoryService.archiveUserMemory(input.agentId, input.memoryId)
      return memoryArchiveRoute.output.parse({ ok })
    }

    case memoryClearRoute.name: {
      const input = memoryClearRoute.input.parse(rawInput)
      return memoryClearRoute.output.parse(
        await runtime.memoryService.clearMemoriesWithCleanup(input.agentId)
      )
    }

    case memoryRestoreRoute.name: {
      const input = memoryRestoreRoute.input.parse(rawInput)
      const ok = runtime.memoryService.restoreMemory(input.agentId, input.memoryId)
      return memoryRestoreRoute.output.parse({ ok })
    }

    case memoryGetSourceSpanRoute.name: {
      const input = memoryGetSourceSpanRoute.input.parse(rawInput)
      const span = getMemorySourceSpan(runtime, input.agentId, input.memoryId)
      return memoryGetSourceSpanRoute.output.parse({ span })
    }

    case memoryListConflictsRoute.name: {
      const input = memoryListConflictsRoute.input.parse(rawInput)
      const conflicts = runtime.memoryService.listConflicts(input.agentId).map((pair) => ({
        challenger: toMemoryItemDto(pair.challenger),
        target: toMemoryItemDto(pair.target)
      }))
      return memoryListConflictsRoute.output.parse({ conflicts })
    }

    case memoryResolveConflictRoute.name: {
      const input = memoryResolveConflictRoute.input.parse(rawInput)
      const ok = await runtime.memoryService.resolveConflict(
        input.agentId,
        input.challengerId,
        input.outcome,
        'user'
      )
      return memoryResolveConflictRoute.output.parse({ ok })
    }

    case memoryListPersonaVersionsRoute.name: {
      const input = memoryListPersonaVersionsRoute.input.parse(rawInput)
      const versions = runtime.memoryService.listPersonaVersions(input.agentId).map(toMemoryItemDto)
      return memoryListPersonaVersionsRoute.output.parse({ versions })
    }

    case memoryRollbackPersonaRoute.name: {
      const input = memoryRollbackPersonaRoute.input.parse(rawInput)
      const ok = await runtime.memoryService.rollbackPersona(input.agentId, input.versionId)
      return memoryRollbackPersonaRoute.output.parse({ ok })
    }

    case memoryListPersonaDraftsRoute.name: {
      const input = memoryListPersonaDraftsRoute.input.parse(rawInput)
      const drafts = runtime.memoryService
        .listPersonaDrafts(input.agentId)
        .map(({ row, needsReview }) => ({ ...toMemoryItemDto(row), needsReview }))
      return memoryListPersonaDraftsRoute.output.parse({ drafts })
    }

    case memoryApprovePersonaDraftRoute.name: {
      const input = memoryApprovePersonaDraftRoute.input.parse(rawInput)
      const ok = await runtime.memoryService.approvePersonaDraft(input.agentId, input.draftId)
      return memoryApprovePersonaDraftRoute.output.parse({ ok })
    }

    case memoryRejectPersonaDraftRoute.name: {
      const input = memoryRejectPersonaDraftRoute.input.parse(rawInput)
      const ok = await runtime.memoryService.rejectPersonaDraft(input.agentId, input.draftId)
      return memoryRejectPersonaDraftRoute.output.parse({ ok })
    }

    case memorySetPersonaAnchorRoute.name: {
      const input = memorySetPersonaAnchorRoute.input.parse(rawInput)
      const ok = await runtime.memoryService.setPersonaAnchor(
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
          const activeSessionId = runtime.desktopSessionBinding.getActiveId(context.webContentsId)
          const activeSession = activeSessionId
            ? ((await runtime.sessionProjectionPort.getLightweightByIds([activeSessionId]))[0] ??
              null)
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
