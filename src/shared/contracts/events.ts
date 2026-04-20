import type { z } from 'zod'
import type { EventContract } from './common'
import { browserOpenRequestedEvent, browserStatusChangedEvent } from './events/browser.events'
import {
  chatStreamCompletedEvent,
  chatStreamFailedEvent,
  chatStreamUpdatedEvent
} from './events/chat.events'
import { dialogRequestedEvent } from './events/dialog.events'
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
  modelsStatusChangedEvent
} from './events/models.events'
import { providersOllamaPullProgressEvent } from './events/misc.providers.events'
import { providersChangedEvent } from './events/providers.events'
import { settingsChangedEvent } from './events/settings.events'
import {
  sessionsAcpCommandsReadyEvent,
  sessionsAcpConfigOptionsReadyEvent,
  sessionsPendingInputsChangedEvent,
  sessionsStatusChangedEvent,
  sessionsUpdatedEvent
} from './events/sessions.events'
import { skillsCatalogChangedEvent, skillsSessionChangedEvent } from './events/skills.events'
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
import { workspaceInvalidatedEvent } from './events/workspace.events'

export * from './events/browser.events'
export * from './events/chat.events'
export * from './events/config.events'
export * from './events/dialog.events'
export * from './events/mcp.events'
export * from './events/misc.providers.events'
export * from './events/models.events'
export * from './events/providers.events'
export * from './events/settings.events'
export * from './events/sessions.events'
export * from './events/skills.events'
export * from './events/sync.events'
export * from './events/upgrade.events'
export * from './events/window.events'
export * from './events/workspace.events'

export const DEEPCHAT_EVENT_CATALOG = {
  [windowStateChangedEvent.name]: windowStateChangedEvent,
  [workspaceInvalidatedEvent.name]: workspaceInvalidatedEvent,
  [browserOpenRequestedEvent.name]: browserOpenRequestedEvent,
  [browserStatusChangedEvent.name]: browserStatusChangedEvent,
  [settingsChangedEvent.name]: settingsChangedEvent,
  [sessionsUpdatedEvent.name]: sessionsUpdatedEvent,
  [sessionsStatusChangedEvent.name]: sessionsStatusChangedEvent,
  [sessionsPendingInputsChangedEvent.name]: sessionsPendingInputsChangedEvent,
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
  [providersOllamaPullProgressEvent.name]: providersOllamaPullProgressEvent,
  [modelsChangedEvent.name]: modelsChangedEvent,
  [modelsStatusChangedEvent.name]: modelsStatusChangedEvent,
  [modelsConfigChangedEvent.name]: modelsConfigChangedEvent,
  [chatStreamUpdatedEvent.name]: chatStreamUpdatedEvent,
  [chatStreamCompletedEvent.name]: chatStreamCompletedEvent,
  [chatStreamFailedEvent.name]: chatStreamFailedEvent,
  [skillsCatalogChangedEvent.name]: skillsCatalogChangedEvent,
  [skillsSessionChangedEvent.name]: skillsSessionChangedEvent,
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
