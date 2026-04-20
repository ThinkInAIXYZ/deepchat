import type { z } from 'zod'
import type { RouteContract } from './common'
import {
  browserAttachCurrentWindowRoute,
  browserDestroyRoute,
  browserDetachRoute,
  browserGetStatusRoute,
  browserGoBackRoute,
  browserGoForwardRoute,
  browserLoadUrlRoute,
  browserReloadRoute,
  browserUpdateCurrentWindowBoundsRoute
} from './routes/browser.routes'
import {
  chatRespondToolInteractionRoute,
  chatSendMessageRoute,
  chatStopStreamRoute
} from './routes/chat.routes'
import {
  configAddCustomPromptRoute,
  configAddSystemPromptRoute,
  configClearDefaultSystemPromptRoute,
  configDeleteCustomPromptRoute,
  configDeleteSystemPromptRoute,
  configGetAcpRegistryIconMarkupRoute,
  configGetAcpSharedMcpSelectionsRoute,
  configGetAcpStateRoute,
  configGetAgentMcpSelectionsRoute,
  configGetAwsBedrockCredentialRoute,
  configGetAzureApiVersionRoute,
  configGetDefaultProjectPathRoute,
  configGetDefaultSystemPromptRoute,
  configGetEntriesRoute,
  configGetFloatingButtonRoute,
  configGetGeminiSafetyRoute,
  configGetLanguageRoute,
  configGetMcpServersRoute,
  configGetShortcutKeysRoute,
  configGetSyncSettingsRoute,
  configGetSystemPromptsRoute,
  configGetThemeRoute,
  configGetVoiceAiConfigRoute,
  configListCustomPromptsRoute,
  configResetDefaultSystemPromptRoute,
  configResetShortcutKeysRoute,
  configResolveDeepChatAgentConfigRoute,
  configSetAcpSharedMcpSelectionsRoute,
  configSetAwsBedrockCredentialRoute,
  configSetAzureApiVersionRoute,
  configSetCustomPromptsRoute,
  configSetDefaultProjectPathRoute,
  configSetDefaultSystemPromptIdRoute,
  configSetDefaultSystemPromptRoute,
  configSetFloatingButtonRoute,
  configSetGeminiSafetyRoute,
  configSetLanguageRoute,
  configSetShortcutKeysRoute,
  configSetSystemPromptsRoute,
  configSetThemeRoute,
  configUpdateCustomPromptRoute,
  configUpdateEntriesRoute,
  configUpdateSyncSettingsRoute,
  configUpdateSystemPromptRoute,
  configUpdateVoiceAiConfigRoute
} from './routes/config.routes'
import {
  deviceGetAppVersionRoute,
  deviceGetInfoRoute,
  deviceRestartAppRoute,
  deviceSanitizeSvgRoute,
  deviceSelectDirectoryRoute
} from './routes/device.routes'
import {
  fileGetMimeTypeRoute,
  fileIsDirectoryRoute,
  filePrepareDirectoryRoute,
  filePrepareFileRoute,
  fileReadFileRoute,
  fileWriteImageBase64Route
} from './routes/file.routes'
import {
  modelsAddCustomRoute,
  modelsExportConfigsRoute,
  modelsGetCapabilitiesRoute,
  modelsGetConfigRoute,
  modelsGetProviderCatalogRoute,
  modelsGetProviderConfigsRoute,
  modelsHasUserConfigRoute,
  modelsImportConfigsRoute,
  modelsListRuntimeRoute,
  modelsRemoveCustomRoute,
  modelsResetConfigRoute,
  modelsSetConfigRoute,
  modelsSetStatusRoute,
  modelsUpdateCustomRoute
} from './routes/models.routes'
import {
  providersAddRoute,
  providersGetAcpProcessConfigOptionsRoute,
  providersGetRateLimitStatusRoute,
  providersListDefaultsRoute,
  providersListModelsRoute,
  providersListOllamaModelsRoute,
  providersListOllamaRunningModelsRoute,
  providersListRoute,
  providersPullOllamaModelRoute,
  providersRefreshModelsRoute,
  providersRemoveRoute,
  providersReorderRoute,
  providersSetByIdRoute,
  providersTestConnectionRoute,
  providersUpdateRoute,
  providersWarmupAcpProcessRoute
} from './routes/providers.routes'
import {
  projectListEnvironmentsRoute,
  projectListRecentRoute,
  projectOpenDirectoryRoute,
  projectSelectDirectoryRoute
} from './routes/project.routes'
import {
  settingsGetSnapshotRoute,
  settingsListSystemFontsRoute,
  settingsUpdateRoute
} from './routes/settings.routes'
import {
  sessionsActivateRoute,
  sessionsCreateRoute,
  sessionsDeactivateRoute,
  sessionsGetActiveRoute,
  sessionsListRoute,
  sessionsRestoreRoute
} from './routes/sessions.routes'
import { systemOpenSettingsRoute } from './routes/system.routes'
import {
  tabCaptureCurrentAreaRoute,
  tabNotifyRendererActivatedRoute,
  tabNotifyRendererReadyRoute,
  tabStitchImagesWithWatermarkRoute
} from './routes/tab.routes'
import {
  windowCloseCurrentRoute,
  windowCloseFloatingCurrentRoute,
  windowGetCurrentStateRoute,
  windowMinimizeCurrentRoute,
  windowPreviewFileRoute,
  windowToggleMaximizeCurrentRoute
} from './routes/window.routes'
import {
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
  workspaceWatchRoute
} from './routes/workspace.routes'

export * from './routes/browser.routes'
export * from './routes/chat.routes'
export * from './routes/config.routes'
export * from './routes/device.routes'
export * from './routes/file.routes'
export * from './routes/models.routes'
export * from './routes/providers.routes'
export * from './routes/project.routes'
export * from './routes/settings.routes'
export * from './routes/sessions.routes'
export * from './routes/system.routes'
export * from './routes/tab.routes'
export * from './routes/window.routes'
export * from './routes/workspace.routes'

export const DEEPCHAT_ROUTE_CATALOG = {
  [windowGetCurrentStateRoute.name]: windowGetCurrentStateRoute,
  [windowMinimizeCurrentRoute.name]: windowMinimizeCurrentRoute,
  [windowToggleMaximizeCurrentRoute.name]: windowToggleMaximizeCurrentRoute,
  [windowCloseCurrentRoute.name]: windowCloseCurrentRoute,
  [windowCloseFloatingCurrentRoute.name]: windowCloseFloatingCurrentRoute,
  [windowPreviewFileRoute.name]: windowPreviewFileRoute,
  [deviceGetAppVersionRoute.name]: deviceGetAppVersionRoute,
  [deviceGetInfoRoute.name]: deviceGetInfoRoute,
  [deviceSelectDirectoryRoute.name]: deviceSelectDirectoryRoute,
  [deviceRestartAppRoute.name]: deviceRestartAppRoute,
  [deviceSanitizeSvgRoute.name]: deviceSanitizeSvgRoute,
  [projectListRecentRoute.name]: projectListRecentRoute,
  [projectListEnvironmentsRoute.name]: projectListEnvironmentsRoute,
  [projectOpenDirectoryRoute.name]: projectOpenDirectoryRoute,
  [projectSelectDirectoryRoute.name]: projectSelectDirectoryRoute,
  [fileGetMimeTypeRoute.name]: fileGetMimeTypeRoute,
  [filePrepareFileRoute.name]: filePrepareFileRoute,
  [filePrepareDirectoryRoute.name]: filePrepareDirectoryRoute,
  [fileReadFileRoute.name]: fileReadFileRoute,
  [fileIsDirectoryRoute.name]: fileIsDirectoryRoute,
  [fileWriteImageBase64Route.name]: fileWriteImageBase64Route,
  [workspaceRegisterRoute.name]: workspaceRegisterRoute,
  [workspaceUnregisterRoute.name]: workspaceUnregisterRoute,
  [workspaceWatchRoute.name]: workspaceWatchRoute,
  [workspaceUnwatchRoute.name]: workspaceUnwatchRoute,
  [workspaceReadDirectoryRoute.name]: workspaceReadDirectoryRoute,
  [workspaceExpandDirectoryRoute.name]: workspaceExpandDirectoryRoute,
  [workspaceRevealFileInFolderRoute.name]: workspaceRevealFileInFolderRoute,
  [workspaceOpenFileRoute.name]: workspaceOpenFileRoute,
  [workspaceReadFilePreviewRoute.name]: workspaceReadFilePreviewRoute,
  [workspaceResolveMarkdownLinkedFileRoute.name]: workspaceResolveMarkdownLinkedFileRoute,
  [workspaceGetGitStatusRoute.name]: workspaceGetGitStatusRoute,
  [workspaceGetGitDiffRoute.name]: workspaceGetGitDiffRoute,
  [workspaceSearchFilesRoute.name]: workspaceSearchFilesRoute,
  [browserGetStatusRoute.name]: browserGetStatusRoute,
  [browserLoadUrlRoute.name]: browserLoadUrlRoute,
  [browserAttachCurrentWindowRoute.name]: browserAttachCurrentWindowRoute,
  [browserUpdateCurrentWindowBoundsRoute.name]: browserUpdateCurrentWindowBoundsRoute,
  [browserDetachRoute.name]: browserDetachRoute,
  [browserDestroyRoute.name]: browserDestroyRoute,
  [browserGoBackRoute.name]: browserGoBackRoute,
  [browserGoForwardRoute.name]: browserGoForwardRoute,
  [browserReloadRoute.name]: browserReloadRoute,
  [tabNotifyRendererReadyRoute.name]: tabNotifyRendererReadyRoute,
  [tabNotifyRendererActivatedRoute.name]: tabNotifyRendererActivatedRoute,
  [tabCaptureCurrentAreaRoute.name]: tabCaptureCurrentAreaRoute,
  [tabStitchImagesWithWatermarkRoute.name]: tabStitchImagesWithWatermarkRoute,
  [configGetEntriesRoute.name]: configGetEntriesRoute,
  [configUpdateEntriesRoute.name]: configUpdateEntriesRoute,
  [configGetLanguageRoute.name]: configGetLanguageRoute,
  [configSetLanguageRoute.name]: configSetLanguageRoute,
  [configGetThemeRoute.name]: configGetThemeRoute,
  [configSetThemeRoute.name]: configSetThemeRoute,
  [configGetFloatingButtonRoute.name]: configGetFloatingButtonRoute,
  [configSetFloatingButtonRoute.name]: configSetFloatingButtonRoute,
  [configGetSyncSettingsRoute.name]: configGetSyncSettingsRoute,
  [configUpdateSyncSettingsRoute.name]: configUpdateSyncSettingsRoute,
  [configGetDefaultProjectPathRoute.name]: configGetDefaultProjectPathRoute,
  [configSetDefaultProjectPathRoute.name]: configSetDefaultProjectPathRoute,
  [configGetShortcutKeysRoute.name]: configGetShortcutKeysRoute,
  [configSetShortcutKeysRoute.name]: configSetShortcutKeysRoute,
  [configResetShortcutKeysRoute.name]: configResetShortcutKeysRoute,
  [configListCustomPromptsRoute.name]: configListCustomPromptsRoute,
  [configSetCustomPromptsRoute.name]: configSetCustomPromptsRoute,
  [configAddCustomPromptRoute.name]: configAddCustomPromptRoute,
  [configUpdateCustomPromptRoute.name]: configUpdateCustomPromptRoute,
  [configDeleteCustomPromptRoute.name]: configDeleteCustomPromptRoute,
  [configGetSystemPromptsRoute.name]: configGetSystemPromptsRoute,
  [configSetSystemPromptsRoute.name]: configSetSystemPromptsRoute,
  [configAddSystemPromptRoute.name]: configAddSystemPromptRoute,
  [configUpdateSystemPromptRoute.name]: configUpdateSystemPromptRoute,
  [configDeleteSystemPromptRoute.name]: configDeleteSystemPromptRoute,
  [configGetDefaultSystemPromptRoute.name]: configGetDefaultSystemPromptRoute,
  [configSetDefaultSystemPromptRoute.name]: configSetDefaultSystemPromptRoute,
  [configResetDefaultSystemPromptRoute.name]: configResetDefaultSystemPromptRoute,
  [configClearDefaultSystemPromptRoute.name]: configClearDefaultSystemPromptRoute,
  [configSetDefaultSystemPromptIdRoute.name]: configSetDefaultSystemPromptIdRoute,
  [configGetAcpStateRoute.name]: configGetAcpStateRoute,
  [configResolveDeepChatAgentConfigRoute.name]: configResolveDeepChatAgentConfigRoute,
  [configGetAgentMcpSelectionsRoute.name]: configGetAgentMcpSelectionsRoute,
  [configGetAcpSharedMcpSelectionsRoute.name]: configGetAcpSharedMcpSelectionsRoute,
  [configSetAcpSharedMcpSelectionsRoute.name]: configSetAcpSharedMcpSelectionsRoute,
  [configGetMcpServersRoute.name]: configGetMcpServersRoute,
  [configGetAcpRegistryIconMarkupRoute.name]: configGetAcpRegistryIconMarkupRoute,
  [configGetVoiceAiConfigRoute.name]: configGetVoiceAiConfigRoute,
  [configUpdateVoiceAiConfigRoute.name]: configUpdateVoiceAiConfigRoute,
  [configGetGeminiSafetyRoute.name]: configGetGeminiSafetyRoute,
  [configSetGeminiSafetyRoute.name]: configSetGeminiSafetyRoute,
  [configGetAzureApiVersionRoute.name]: configGetAzureApiVersionRoute,
  [configSetAzureApiVersionRoute.name]: configSetAzureApiVersionRoute,
  [configGetAwsBedrockCredentialRoute.name]: configGetAwsBedrockCredentialRoute,
  [configSetAwsBedrockCredentialRoute.name]: configSetAwsBedrockCredentialRoute,
  [settingsGetSnapshotRoute.name]: settingsGetSnapshotRoute,
  [settingsListSystemFontsRoute.name]: settingsListSystemFontsRoute,
  [settingsUpdateRoute.name]: settingsUpdateRoute,
  [sessionsCreateRoute.name]: sessionsCreateRoute,
  [sessionsRestoreRoute.name]: sessionsRestoreRoute,
  [sessionsListRoute.name]: sessionsListRoute,
  [sessionsActivateRoute.name]: sessionsActivateRoute,
  [sessionsDeactivateRoute.name]: sessionsDeactivateRoute,
  [sessionsGetActiveRoute.name]: sessionsGetActiveRoute,
  [providersListRoute.name]: providersListRoute,
  [providersListDefaultsRoute.name]: providersListDefaultsRoute,
  [providersSetByIdRoute.name]: providersSetByIdRoute,
  [providersUpdateRoute.name]: providersUpdateRoute,
  [providersAddRoute.name]: providersAddRoute,
  [providersRemoveRoute.name]: providersRemoveRoute,
  [providersReorderRoute.name]: providersReorderRoute,
  [providersListModelsRoute.name]: providersListModelsRoute,
  [providersTestConnectionRoute.name]: providersTestConnectionRoute,
  [providersGetRateLimitStatusRoute.name]: providersGetRateLimitStatusRoute,
  [providersRefreshModelsRoute.name]: providersRefreshModelsRoute,
  [providersListOllamaModelsRoute.name]: providersListOllamaModelsRoute,
  [providersListOllamaRunningModelsRoute.name]: providersListOllamaRunningModelsRoute,
  [providersPullOllamaModelRoute.name]: providersPullOllamaModelRoute,
  [providersWarmupAcpProcessRoute.name]: providersWarmupAcpProcessRoute,
  [providersGetAcpProcessConfigOptionsRoute.name]: providersGetAcpProcessConfigOptionsRoute,
  [modelsGetProviderCatalogRoute.name]: modelsGetProviderCatalogRoute,
  [modelsListRuntimeRoute.name]: modelsListRuntimeRoute,
  [modelsSetStatusRoute.name]: modelsSetStatusRoute,
  [modelsAddCustomRoute.name]: modelsAddCustomRoute,
  [modelsRemoveCustomRoute.name]: modelsRemoveCustomRoute,
  [modelsUpdateCustomRoute.name]: modelsUpdateCustomRoute,
  [modelsGetConfigRoute.name]: modelsGetConfigRoute,
  [modelsSetConfigRoute.name]: modelsSetConfigRoute,
  [modelsResetConfigRoute.name]: modelsResetConfigRoute,
  [modelsGetProviderConfigsRoute.name]: modelsGetProviderConfigsRoute,
  [modelsHasUserConfigRoute.name]: modelsHasUserConfigRoute,
  [modelsExportConfigsRoute.name]: modelsExportConfigsRoute,
  [modelsImportConfigsRoute.name]: modelsImportConfigsRoute,
  [modelsGetCapabilitiesRoute.name]: modelsGetCapabilitiesRoute,
  [chatSendMessageRoute.name]: chatSendMessageRoute,
  [chatStopStreamRoute.name]: chatStopStreamRoute,
  [chatRespondToolInteractionRoute.name]: chatRespondToolInteractionRoute,
  [systemOpenSettingsRoute.name]: systemOpenSettingsRoute
} satisfies Record<string, RouteContract>

export type DeepchatRouteCatalog = typeof DEEPCHAT_ROUTE_CATALOG
export type DeepchatRouteName = keyof DeepchatRouteCatalog
export type DeepchatRouteContract<T extends DeepchatRouteName> = DeepchatRouteCatalog[T]
export type DeepchatRouteInput<T extends DeepchatRouteName> = z.input<
  DeepchatRouteContract<T>['input']
>
export type DeepchatRouteOutput<T extends DeepchatRouteName> = z.output<
  DeepchatRouteContract<T>['output']
>

export function hasDeepchatRouteContract(name: string): name is DeepchatRouteName {
  return Object.prototype.hasOwnProperty.call(DEEPCHAT_ROUTE_CATALOG, name)
}

export function getDeepchatRouteContract<T extends DeepchatRouteName>(
  name: T
): DeepchatRouteContract<T> {
  return DEEPCHAT_ROUTE_CATALOG[name]
}
