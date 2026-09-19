import type { z } from 'zod'
import type { EventContract } from './common.js'
import { acpAuthOutputEvent, acpAuthStateChangedEvent } from './events/acp-auth.events.js'
import { approvalClosedEvent, approvalRequestedEvent } from './events/approvals.events.js'
import {
  appRuntimeAccessibilityChangedEvent,
  appRuntimeGuidedOnboardingResumeRequestedEvent,
  appRuntimeGuidedOnboardingStartRequestedEvent,
  appRuntimeMcpInstallRequestedEvent,
  appRuntimeShortcutRequestedEvent,
  appRuntimeStartDeeplinkRequestedEvent,
  appRuntimeSystemNotificationClickedEvent,
  appRuntimeWindowBlurredEvent,
  appRuntimeWindowFocusedEvent
} from './events/app-runtime.events.js'
import {
  browserActivityChangedEvent,
  browserOpenRequestedEvent,
  browserPreviewActionEvent,
  browserPreviewFrameEvent,
  browserPreviewSurfaceChangedEvent,
  browserStatusChangedEvent
} from './events/browser.events.js'
import {
  computerUsePreviewFrameEvent,
  computerUsePreviewSurfaceChangedEvent
} from './events/computerUse.events.js'
import {
  chatPlanUpdatedEvent,
  chatStreamActivityEvent,
  chatStreamCompletedEvent,
  chatStreamFailedEvent,
  chatStreamUpdatedEvent
} from './events/chat.events.js'
import {
  contextMenuAskAiRequestedEvent,
  contextMenuTranslateRequestedEvent
} from './events/context-menu.events.js'
import { dialogRequestedEvent } from './events/dialog.events.js'
import { knowledgeFileProgressEvent, knowledgeFileUpdatedEvent } from './events/knowledge.events.js'
import { memoryUpdatedEvent } from './events/memory.events.js'
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
} from './events/config.events.js'
import {
  mcpAppConsentRequestEvent,
  mcpConfigChangedEvent,
  mcpElicitationCancelledEvent,
  mcpElicitationDecisionEvent,
  mcpElicitationRequestEvent,
  mcpEnterpriseAuthChangedEvent,
  mcpSamplingCancelledEvent,
  mcpSamplingDecisionEvent,
  mcpSamplingRequestEvent,
  mcpServerAuthChangedEvent,
  mcpServerStartedEvent,
  mcpServerStatusChangedEvent,
  mcpServerStoppedEvent,
  mcpToolCallResultEvent
} from './events/mcp.events.js'
import {
  modelsChangedEvent,
  modelsConfigChangedEvent,
  modelsStatusChangedEvent,
  modelBatchStatusChangedEvent
} from './events/models.events.js'
import { semanticNotificationEvent } from './events/notification.events.js'
import {
  oauthOpenAICodexStatusChangedEvent,
  oauthXaiGrokStatusChangedEvent
} from './events/oauth.events.js'
import { providersOllamaPullProgressEvent } from './events/misc.providers.events.js'
import { projectEnvironmentsChangedEvent } from './events/project.events.js'
import {
  providersAcpDebugEvent,
  providersChangedEvent,
  providersRateLimitConfigUpdatedEvent,
  providersRateLimitRequestExecutedEvent,
  providersRateLimitRequestQueuedEvent
} from './events/providers.events.js'
import {
  settingsCheckForUpdatesRequestedEvent,
  settingsChangedEvent,
  settingsCommandShellChangedEvent,
  settingsNavigateRequestedEvent,
  settingsProviderInstallRequestedEvent
} from './events/settings.events.js'
import { startupWorkloadChangedEvent } from './events/startup.events.js'
import {
  toolchainsChangedEvent,
  toolchainsMissingEvent,
  toolchainsProgressEvent
} from './events/toolchains.events.js'
import {
  sessionsAcpCommandsReadyEvent,
  sessionsAcpConfigOptionsReadyEvent,
  sessionsAcpModesReadyEvent,
  sessionsCompactionChangedEvent,
  sessionsMessagesChangedEvent,
  sessionsPendingInputsChangedEvent,
  sessionsStatusChangedEvent,
  sessionsTapeInspectorHeadChangedEvent,
  sessionsUpdatedEvent
} from './events/sessions.events.js'
import { skillsCatalogChangedEvent, skillsSessionChangedEvent } from './events/skills.events.js'
import {
  skillSyncDiscoveriesChangedEvent,
  skillSyncScanCompletedEvent,
  skillSyncScanStartedEvent
} from './events/skillSync.events.js'
import {
  syncBackupCompletedEvent,
  syncBackupErrorEvent,
  syncBackupStartedEvent,
  syncBackupStatusChangedEvent,
  syncImportCompletedEvent,
  syncImportErrorEvent,
  syncImportStartedEvent
} from './events/sync.events.js'
import {
  upgradeErrorEvent,
  upgradeProgressEvent,
  upgradeStatusChangedEvent,
  upgradeWillRestartEvent
} from './events/upgrade.events.js'
import { windowStateChangedEvent } from './events/window.events.js'
import {
  workspaceInvalidatedEvent,
  workspaceWatchStatusChangedEvent
} from './events/workspace.events.js'
import { liveDelegationChangedEvent } from './events/orchestration.events.js'
import {
  runsCancelRequestedEvent,
  runsCreatedEvent,
  runsSnapshotEvent,
  runsTurnAcceptedEvent,
  runsTurnFailedEvent
} from './events/runs.events.js'

export * from './events/browser.events.js'
export * from './events/computerUse.events.js'
export * from './events/acp-auth.events.js'
export * from './events/approvals.events.js'
export * from './events/app-runtime.events.js'
export * from './events/chat.events.js'
export * from './events/config.events.js'
export * from './events/context-menu.events.js'
export * from './events/dialog.events.js'
export * from './events/knowledge.events.js'
export * from './events/memory.events.js'
export * from './events/mcp.events.js'
export * from './events/misc.providers.events.js'
export * from './events/project.events.js'
export * from './events/models.events.js'
export * from './events/notification.events.js'
export * from './events/oauth.events.js'
export * from './events/orchestration.events.js'
export * from './events/providers.events.js'
export * from './events/runs.events.js'
export * from './events/settings.events.js'
export * from './events/startup.events.js'
export * from './events/sessions.events.js'
export * from './events/skills.events.js'
export * from './events/skillSync.events.js'
export * from './events/sync.events.js'
export * from './events/toolchains.events.js'
export * from './events/upgrade.events.js'
export * from './events/window.events.js'
export * from './events/workspace.events.js'

export const DEEPCHAT_EVENT_CATALOG = {
  [approvalRequestedEvent.name]: approvalRequestedEvent,
  [approvalClosedEvent.name]: approvalClosedEvent,
  [windowStateChangedEvent.name]: windowStateChangedEvent,
  [workspaceInvalidatedEvent.name]: workspaceInvalidatedEvent,
  [workspaceWatchStatusChangedEvent.name]: workspaceWatchStatusChangedEvent,
  [liveDelegationChangedEvent.name]: liveDelegationChangedEvent,
  [browserActivityChangedEvent.name]: browserActivityChangedEvent,
  [browserPreviewActionEvent.name]: browserPreviewActionEvent,
  [browserPreviewFrameEvent.name]: browserPreviewFrameEvent,
  [browserPreviewSurfaceChangedEvent.name]: browserPreviewSurfaceChangedEvent,
  [computerUsePreviewFrameEvent.name]: computerUsePreviewFrameEvent,
  [computerUsePreviewSurfaceChangedEvent.name]: computerUsePreviewSurfaceChangedEvent,
  [browserOpenRequestedEvent.name]: browserOpenRequestedEvent,
  [browserStatusChangedEvent.name]: browserStatusChangedEvent,
  [settingsChangedEvent.name]: settingsChangedEvent,
  [settingsCommandShellChangedEvent.name]: settingsCommandShellChangedEvent,
  [settingsNavigateRequestedEvent.name]: settingsNavigateRequestedEvent,
  [settingsProviderInstallRequestedEvent.name]: settingsProviderInstallRequestedEvent,
  [settingsCheckForUpdatesRequestedEvent.name]: settingsCheckForUpdatesRequestedEvent,
  [semanticNotificationEvent.name]: semanticNotificationEvent,
  [acpAuthOutputEvent.name]: acpAuthOutputEvent,
  [acpAuthStateChangedEvent.name]: acpAuthStateChangedEvent,
  [appRuntimeStartDeeplinkRequestedEvent.name]: appRuntimeStartDeeplinkRequestedEvent,
  [appRuntimeMcpInstallRequestedEvent.name]: appRuntimeMcpInstallRequestedEvent,
  [appRuntimeGuidedOnboardingStartRequestedEvent.name]:
    appRuntimeGuidedOnboardingStartRequestedEvent,
  [appRuntimeGuidedOnboardingResumeRequestedEvent.name]:
    appRuntimeGuidedOnboardingResumeRequestedEvent,
  [appRuntimeAccessibilityChangedEvent.name]: appRuntimeAccessibilityChangedEvent,
  [appRuntimeWindowFocusedEvent.name]: appRuntimeWindowFocusedEvent,
  [appRuntimeWindowBlurredEvent.name]: appRuntimeWindowBlurredEvent,
  [appRuntimeShortcutRequestedEvent.name]: appRuntimeShortcutRequestedEvent,
  [appRuntimeSystemNotificationClickedEvent.name]: appRuntimeSystemNotificationClickedEvent,
  [startupWorkloadChangedEvent.name]: startupWorkloadChangedEvent,
  [sessionsUpdatedEvent.name]: sessionsUpdatedEvent,
  [sessionsStatusChangedEvent.name]: sessionsStatusChangedEvent,
  [sessionsCompactionChangedEvent.name]: sessionsCompactionChangedEvent,
  [sessionsMessagesChangedEvent.name]: sessionsMessagesChangedEvent,
  [sessionsPendingInputsChangedEvent.name]: sessionsPendingInputsChangedEvent,
  [sessionsTapeInspectorHeadChangedEvent.name]: sessionsTapeInspectorHeadChangedEvent,
  [sessionsAcpModesReadyEvent.name]: sessionsAcpModesReadyEvent,
  [sessionsAcpCommandsReadyEvent.name]: sessionsAcpCommandsReadyEvent,
  [sessionsAcpConfigOptionsReadyEvent.name]: sessionsAcpConfigOptionsReadyEvent,
  [runsCreatedEvent.name]: runsCreatedEvent,
  [runsTurnAcceptedEvent.name]: runsTurnAcceptedEvent,
  [runsTurnFailedEvent.name]: runsTurnFailedEvent,
  [runsCancelRequestedEvent.name]: runsCancelRequestedEvent,
  [runsSnapshotEvent.name]: runsSnapshotEvent,
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
  [oauthXaiGrokStatusChangedEvent.name]: oauthXaiGrokStatusChangedEvent,
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
  [chatStreamActivityEvent.name]: chatStreamActivityEvent,
  [contextMenuTranslateRequestedEvent.name]: contextMenuTranslateRequestedEvent,
  [contextMenuAskAiRequestedEvent.name]: contextMenuAskAiRequestedEvent,
  [skillsCatalogChangedEvent.name]: skillsCatalogChangedEvent,
  [skillsSessionChangedEvent.name]: skillsSessionChangedEvent,
  [skillSyncDiscoveriesChangedEvent.name]: skillSyncDiscoveriesChangedEvent,
  [skillSyncScanStartedEvent.name]: skillSyncScanStartedEvent,
  [skillSyncScanCompletedEvent.name]: skillSyncScanCompletedEvent,
  [mcpServerStartedEvent.name]: mcpServerStartedEvent,
  [mcpServerStoppedEvent.name]: mcpServerStoppedEvent,
  [mcpConfigChangedEvent.name]: mcpConfigChangedEvent,
  [mcpServerStatusChangedEvent.name]: mcpServerStatusChangedEvent,
  [mcpServerAuthChangedEvent.name]: mcpServerAuthChangedEvent,
  [mcpEnterpriseAuthChangedEvent.name]: mcpEnterpriseAuthChangedEvent,
  [mcpToolCallResultEvent.name]: mcpToolCallResultEvent,
  [mcpSamplingRequestEvent.name]: mcpSamplingRequestEvent,
  [mcpSamplingDecisionEvent.name]: mcpSamplingDecisionEvent,
  [mcpSamplingCancelledEvent.name]: mcpSamplingCancelledEvent,
  [mcpElicitationRequestEvent.name]: mcpElicitationRequestEvent,
  [mcpElicitationDecisionEvent.name]: mcpElicitationDecisionEvent,
  [mcpElicitationCancelledEvent.name]: mcpElicitationCancelledEvent,
  [mcpAppConsentRequestEvent.name]: mcpAppConsentRequestEvent,
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
  [dialogRequestedEvent.name]: dialogRequestedEvent,
  [toolchainsProgressEvent.name]: toolchainsProgressEvent,
  [toolchainsMissingEvent.name]: toolchainsMissingEvent,
  [toolchainsChangedEvent.name]: toolchainsChangedEvent
} satisfies Record<string, EventContract>

export type DeepchatEventCatalog = typeof DEEPCHAT_EVENT_CATALOG
export type DeepchatEventName = keyof DeepchatEventCatalog
export type DeepchatEventContract<T extends DeepchatEventName> = DeepchatEventCatalog[T]
export type DeepchatEventPayload<T extends DeepchatEventName> = z.output<
  DeepchatEventContract<T>['payload']
>
export type DeepchatEventPublisher = <T extends DeepchatEventName>(
  name: T,
  payload: DeepchatEventPayload<T>
) => void

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

export function createDeepchatEventEnvelope<T extends DeepchatEventName>(
  name: T,
  payload: unknown
): DeepchatEventEnvelope<T> {
  const contract = getDeepchatEventContract(name)
  return {
    name,
    payload: contract.payload.parse(payload) as DeepchatEventPayload<T>
  }
}
