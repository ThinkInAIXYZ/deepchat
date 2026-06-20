import type { z } from 'zod'
import type { EventContract } from './common'
import {
  acpTerminalErrorEvent,
  acpTerminalExitedEvent,
  acpTerminalExternalDependenciesRequiredEvent,
  acpTerminalOutputEvent,
  acpTerminalStartedEvent
} from './events/acp-terminal.events'
import {
  appRuntimeDataResetCompleteDevEvent,
  appRuntimeGuidedOnboardingStartRequestedEvent,
  appRuntimeMcpInstallRequestedEvent,
  appRuntimeShortcutRequestedEvent,
  appRuntimeStartDeeplinkRequestedEvent,
  appRuntimeSystemNotificationClickedEvent,
  appRuntimeWindowBlurredEvent,
  appRuntimeWindowFocusedEvent
} from './events/app-runtime.events'
import {
  browserActivityChangedEvent,
  browserOpenRequestedEvent,
  browserStatusChangedEvent
} from './events/browser.events'
import {
  chatPlanUpdatedEvent,
  chatStreamCompletedEvent,
  chatStreamFailedEvent,
  chatStreamUpdatedEvent
} from './events/chat.events'
import {
  contextMenuAskAiRequestedEvent,
  contextMenuTranslateRequestedEvent
} from './events/context-menu.events'
import { dialogRequestedEvent } from './events/dialog.events'
import { knowledgeFileProgressEvent, knowledgeFileUpdatedEvent } from './events/knowledge.events'
import { memoryUpdatedEvent } from './events/memory.events'
import {
  configCustomPromptsChangedEvent,
  configAgentsChangedEvent,
  configDefaultProjectPathChangedEvent,
  configFloatingButtonChangedEvent,
  configLanguageChangedEvent,
  configShortcutKeysChangedEvent,
  configSyncSettingsChangedEvent,
  configSystemPromptsChangedEvent,
  configSystemThemeChangedEvent,
  configThemeChangedEvent
} from './events/config.events'
import {
  mcpConfigChangedEvent,
  mcpSamplingCancelledEvent,
  mcpSamplingDecisionEvent,
  mcpSamplingRequestEvent,
  mcpServerStartedEvent,
  mcpServerStatusChangedEvent,
  mcpServerStoppedEvent,
  mcpToolCallResultEvent
} from './events/mcp.events'
import {
  modelsChangedEvent,
  modelsConfigChangedEvent,
  modelsStatusChangedEvent,
  modelBatchStatusChangedEvent
} from './events/models.events'
import { databaseRepairSuggestedEvent, notificationErrorEvent } from './events/notification.events'
import { oauthOpenAICodexStatusChangedEvent } from './events/oauth.events'
import { providersOllamaPullProgressEvent } from './events/misc.providers.events'
import { projectEnvironmentsChangedEvent } from './events/project.events'
import {
  providersAcpDebugEvent,
  providersChangedEvent,
  providersRateLimitConfigUpdatedEvent,
  providersRateLimitRequestExecutedEvent,
  providersRateLimitRequestQueuedEvent
} from './events/providers.events'
import {
  settingsCheckForUpdatesRequestedEvent,
  settingsChangedEvent,
  settingsNavigateRequestedEvent,
  settingsProviderInstallRequestedEvent
} from './events/settings.events'
import { startupWorkloadChangedEvent } from './events/startup.events'
import {
  sessionsAcpCommandsReadyEvent,
  sessionsAcpConfigOptionsReadyEvent,
  sessionsAcpModesReadyEvent,
  sessionsCompactionChangedEvent,
  sessionsPendingInputsChangedEvent,
  sessionsStatusChangedEvent,
  sessionsUpdatedEvent
} from './events/sessions.events'
import { skillsCatalogChangedEvent, skillsSessionChangedEvent } from './events/skills.events'
import {
  skillSyncDiscoveriesChangedEvent,
  skillSyncExportCompletedEvent,
  skillSyncExportProgressEvent,
  skillSyncExportStartedEvent,
  skillSyncImportCompletedEvent,
  skillSyncImportProgressEvent,
  skillSyncImportStartedEvent,
  skillSyncScanCompletedEvent,
  skillSyncScanStartedEvent
} from './events/skillSync.events'
import {
  syncBackupCompletedEvent,
  syncBackupErrorEvent,
  syncBackupStartedEvent,
  syncBackupStatusChangedEvent,
  syncImportCompletedEvent,
  syncImportErrorEvent,
  syncImportStartedEvent
} from './events/sync.events'
import {
  upgradeErrorEvent,
  upgradeProgressEvent,
  upgradeStatusChangedEvent,
  upgradeWillRestartEvent
} from './events/upgrade.events'
import { windowStateChangedEvent } from './events/window.events'
import {
  workspaceInvalidatedEvent,
  workspaceWatchStatusChangedEvent
} from './events/workspace.events'

export * from './events/browser.events'
export * from './events/acp-terminal.events'
export * from './events/app-runtime.events'
export * from './events/chat.events'
export * from './events/config.events'
export * from './events/context-menu.events'
export * from './events/dialog.events'
export * from './events/knowledge.events'
export * from './events/memory.events'
export * from './events/mcp.events'
export * from './events/misc.providers.events'
export * from './events/project.events'
export * from './events/models.events'
export * from './events/notification.events'
export * from './events/oauth.events'
export * from './events/providers.events'
export * from './events/settings.events'
export * from './events/startup.events'
export * from './events/sessions.events'
export * from './events/skills.events'
export * from './events/skillSync.events'
export * from './events/sync.events'
export * from './events/upgrade.events'
export * from './events/window.events'
export * from './events/workspace.events'

export const DEEPCHAT_EVENT_CATALOG = {
  [windowStateChangedEvent.name]: windowStateChangedEvent,
  [workspaceInvalidatedEvent.name]: workspaceInvalidatedEvent,
  [workspaceWatchStatusChangedEvent.name]: workspaceWatchStatusChangedEvent,
  [browserActivityChangedEvent.name]: browserActivityChangedEvent,
  [browserOpenRequestedEvent.name]: browserOpenRequestedEvent,
  [browserStatusChangedEvent.name]: browserStatusChangedEvent,
  [settingsChangedEvent.name]: settingsChangedEvent,
  [settingsNavigateRequestedEvent.name]: settingsNavigateRequestedEvent,
  [settingsProviderInstallRequestedEvent.name]: settingsProviderInstallRequestedEvent,
  [settingsCheckForUpdatesRequestedEvent.name]: settingsCheckForUpdatesRequestedEvent,
  [notificationErrorEvent.name]: notificationErrorEvent,
  [databaseRepairSuggestedEvent.name]: databaseRepairSuggestedEvent,
  [acpTerminalStartedEvent.name]: acpTerminalStartedEvent,
  [acpTerminalOutputEvent.name]: acpTerminalOutputEvent,
  [acpTerminalExitedEvent.name]: acpTerminalExitedEvent,
  [acpTerminalErrorEvent.name]: acpTerminalErrorEvent,
  [acpTerminalExternalDependenciesRequiredEvent.name]: acpTerminalExternalDependenciesRequiredEvent,
  [appRuntimeStartDeeplinkRequestedEvent.name]: appRuntimeStartDeeplinkRequestedEvent,
  [appRuntimeMcpInstallRequestedEvent.name]: appRuntimeMcpInstallRequestedEvent,
  [appRuntimeGuidedOnboardingStartRequestedEvent.name]:
    appRuntimeGuidedOnboardingStartRequestedEvent,
  [appRuntimeWindowFocusedEvent.name]: appRuntimeWindowFocusedEvent,
  [appRuntimeWindowBlurredEvent.name]: appRuntimeWindowBlurredEvent,
  [appRuntimeShortcutRequestedEvent.name]: appRuntimeShortcutRequestedEvent,
  [appRuntimeDataResetCompleteDevEvent.name]: appRuntimeDataResetCompleteDevEvent,
  [appRuntimeSystemNotificationClickedEvent.name]: appRuntimeSystemNotificationClickedEvent,
  [startupWorkloadChangedEvent.name]: startupWorkloadChangedEvent,
  [sessionsUpdatedEvent.name]: sessionsUpdatedEvent,
  [sessionsStatusChangedEvent.name]: sessionsStatusChangedEvent,
  [sessionsCompactionChangedEvent.name]: sessionsCompactionChangedEvent,
  [sessionsPendingInputsChangedEvent.name]: sessionsPendingInputsChangedEvent,
  [sessionsAcpModesReadyEvent.name]: sessionsAcpModesReadyEvent,
  [sessionsAcpCommandsReadyEvent.name]: sessionsAcpCommandsReadyEvent,
  [sessionsAcpConfigOptionsReadyEvent.name]: sessionsAcpConfigOptionsReadyEvent,
  [configLanguageChangedEvent.name]: configLanguageChangedEvent,
  [configThemeChangedEvent.name]: configThemeChangedEvent,
  [configSystemThemeChangedEvent.name]: configSystemThemeChangedEvent,
  [configFloatingButtonChangedEvent.name]: configFloatingButtonChangedEvent,
  [configSyncSettingsChangedEvent.name]: configSyncSettingsChangedEvent,
  [configDefaultProjectPathChangedEvent.name]: configDefaultProjectPathChangedEvent,
  [configAgentsChangedEvent.name]: configAgentsChangedEvent,
  [configShortcutKeysChangedEvent.name]: configShortcutKeysChangedEvent,
  [configSystemPromptsChangedEvent.name]: configSystemPromptsChangedEvent,
  [configCustomPromptsChangedEvent.name]: configCustomPromptsChangedEvent,
  [providersChangedEvent.name]: providersChangedEvent,
  [oauthOpenAICodexStatusChangedEvent.name]: oauthOpenAICodexStatusChangedEvent,
  [projectEnvironmentsChangedEvent.name]: projectEnvironmentsChangedEvent,
  [providersRateLimitConfigUpdatedEvent.name]: providersRateLimitConfigUpdatedEvent,
  [providersRateLimitRequestQueuedEvent.name]: providersRateLimitRequestQueuedEvent,
  [providersRateLimitRequestExecutedEvent.name]: providersRateLimitRequestExecutedEvent,
  [providersAcpDebugEvent.name]: providersAcpDebugEvent,
  [providersOllamaPullProgressEvent.name]: providersOllamaPullProgressEvent,
  [knowledgeFileUpdatedEvent.name]: knowledgeFileUpdatedEvent,
  [knowledgeFileProgressEvent.name]: knowledgeFileProgressEvent,
  [memoryUpdatedEvent.name]: memoryUpdatedEvent,
  [modelsChangedEvent.name]: modelsChangedEvent,
  [modelsStatusChangedEvent.name]: modelsStatusChangedEvent,
  [modelBatchStatusChangedEvent.name]: modelBatchStatusChangedEvent,
  [modelsConfigChangedEvent.name]: modelsConfigChangedEvent,
  [chatStreamUpdatedEvent.name]: chatStreamUpdatedEvent,
  [chatStreamCompletedEvent.name]: chatStreamCompletedEvent,
  [chatStreamFailedEvent.name]: chatStreamFailedEvent,
  [chatPlanUpdatedEvent.name]: chatPlanUpdatedEvent,
  [contextMenuTranslateRequestedEvent.name]: contextMenuTranslateRequestedEvent,
  [contextMenuAskAiRequestedEvent.name]: contextMenuAskAiRequestedEvent,
  [skillsCatalogChangedEvent.name]: skillsCatalogChangedEvent,
  [skillsSessionChangedEvent.name]: skillsSessionChangedEvent,
  [skillSyncDiscoveriesChangedEvent.name]: skillSyncDiscoveriesChangedEvent,
  [skillSyncScanStartedEvent.name]: skillSyncScanStartedEvent,
  [skillSyncScanCompletedEvent.name]: skillSyncScanCompletedEvent,
  [skillSyncImportStartedEvent.name]: skillSyncImportStartedEvent,
  [skillSyncImportProgressEvent.name]: skillSyncImportProgressEvent,
  [skillSyncImportCompletedEvent.name]: skillSyncImportCompletedEvent,
  [skillSyncExportStartedEvent.name]: skillSyncExportStartedEvent,
  [skillSyncExportProgressEvent.name]: skillSyncExportProgressEvent,
  [skillSyncExportCompletedEvent.name]: skillSyncExportCompletedEvent,
  [mcpServerStartedEvent.name]: mcpServerStartedEvent,
  [mcpServerStoppedEvent.name]: mcpServerStoppedEvent,
  [mcpConfigChangedEvent.name]: mcpConfigChangedEvent,
  [mcpServerStatusChangedEvent.name]: mcpServerStatusChangedEvent,
  [mcpToolCallResultEvent.name]: mcpToolCallResultEvent,
  [mcpSamplingRequestEvent.name]: mcpSamplingRequestEvent,
  [mcpSamplingDecisionEvent.name]: mcpSamplingDecisionEvent,
  [mcpSamplingCancelledEvent.name]: mcpSamplingCancelledEvent,
  [syncBackupStartedEvent.name]: syncBackupStartedEvent,
  [syncBackupCompletedEvent.name]: syncBackupCompletedEvent,
  [syncBackupErrorEvent.name]: syncBackupErrorEvent,
  [syncBackupStatusChangedEvent.name]: syncBackupStatusChangedEvent,
  [syncImportStartedEvent.name]: syncImportStartedEvent,
  [syncImportCompletedEvent.name]: syncImportCompletedEvent,
  [syncImportErrorEvent.name]: syncImportErrorEvent,
  [upgradeStatusChangedEvent.name]: upgradeStatusChangedEvent,
  [upgradeProgressEvent.name]: upgradeProgressEvent,
  [upgradeWillRestartEvent.name]: upgradeWillRestartEvent,
  [upgradeErrorEvent.name]: upgradeErrorEvent,
  [dialogRequestedEvent.name]: dialogRequestedEvent
} satisfies Record<string, EventContract>

export type DeepchatEventCatalog = typeof DEEPCHAT_EVENT_CATALOG
export type DeepchatEventName = keyof DeepchatEventCatalog
export type DeepchatEventContract<T extends DeepchatEventName> = DeepchatEventCatalog[T]
export type DeepchatEventPayload<T extends DeepchatEventName> = z.output<
  DeepchatEventContract<T>['payload']
>

export type DeepchatEventEnvelope<T extends DeepchatEventName = DeepchatEventName> = {
  name: T
  payload: DeepchatEventPayload<T>
}

export function hasDeepchatEventContract(name: string): name is DeepchatEventName {
  return Object.prototype.hasOwnProperty.call(DEEPCHAT_EVENT_CATALOG, name)
}

export function getDeepchatEventContract<T extends DeepchatEventName>(
  name: T
): DeepchatEventContract<T> {
  return DEEPCHAT_EVENT_CATALOG[name]
}
