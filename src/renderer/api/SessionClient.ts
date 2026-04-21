import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  sessionsAcpCommandsReadyEvent,
  sessionsAcpConfigOptionsReadyEvent,
  sessionsPendingInputsChangedEvent,
  sessionsStatusChangedEvent,
  sessionsUpdatedEvent
} from '@shared/contracts/events'
import type { DeepchatRouteInput } from '@shared/contracts/routes'
import {
  sessionsActivateRoute,
  sessionsClearMessagesRoute,
  sessionsConvertPendingInputToSteerRoute,
  sessionsCreateRoute,
  sessionsDeleteMessageRoute,
  sessionsDeletePendingInputRoute,
  sessionsDeleteRoute,
  sessionsDeactivateRoute,
  sessionsEditUserMessageRoute,
  sessionsEnsureAcpDraftRoute,
  sessionsExportRoute,
  sessionsForkRoute,
  sessionsGetAcpSessionCommandsRoute,
  sessionsGetAcpSessionConfigOptionsRoute,
  sessionsGetActiveRoute,
  sessionsGetAgentsRoute,
  sessionsGetDisabledAgentToolsRoute,
  sessionsGetGenerationSettingsRoute,
  sessionsGetPermissionModeRoute,
  sessionsGetSearchResultsRoute,
  sessionsListRoute,
  sessionsListMessageTracesRoute,
  sessionsListPendingInputsRoute,
  sessionsMoveQueuedInputRoute,
  sessionsQueuePendingInputRoute,
  sessionsRenameRoute,
  sessionsResumePendingQueueRoute,
  sessionsRetryMessageRoute,
  sessionsRestoreRoute
} from '@shared/contracts/routes'
import {
  sessionsSearchHistoryRoute,
  sessionsSetAcpSessionConfigOptionRoute,
  sessionsSetModelRoute,
  sessionsSetPermissionModeRoute,
  sessionsSetProjectDirRoute,
  sessionsSetSubagentEnabledRoute,
  sessionsTogglePinnedRoute,
  sessionsTranslateTextRoute,
  sessionsUpdateDisabledAgentToolsRoute,
  sessionsUpdateGenerationSettingsRoute,
  sessionsUpdateQueuedInputRoute
} from '@shared/contracts/routes'
import type { CreateSessionInput, SendMessageInput } from '@shared/types/agent-interface'
import { getDeepchatBridge } from './core'

export function createSessionClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function create(input: CreateSessionInput) {
    return await bridge.invoke(
      sessionsCreateRoute.name,
      input as DeepchatRouteInput<typeof sessionsCreateRoute.name>
    )
  }

  async function restore(sessionId: string) {
    return await bridge.invoke(sessionsRestoreRoute.name, { sessionId })
  }

  async function activate(sessionId: string) {
    return await bridge.invoke(sessionsActivateRoute.name, { sessionId })
  }

  async function deactivate() {
    return await bridge.invoke(sessionsDeactivateRoute.name, {})
  }

  async function getActive() {
    return await bridge.invoke(sessionsGetActiveRoute.name, {})
  }

  async function list(filters?: {
    agentId?: string
    projectDir?: string
    includeSubagents?: boolean
    parentSessionId?: string
  }) {
    return await bridge.invoke(sessionsListRoute.name, filters ?? {})
  }

  async function ensureAcpDraftSession(input: {
    agentId: string
    projectDir: string
    permissionMode?: 'default' | 'full_access'
  }) {
    const result = await bridge.invoke(sessionsEnsureAcpDraftRoute.name, input)
    return result.session
  }

  async function listPendingInputs(sessionId: string) {
    const result = await bridge.invoke(sessionsListPendingInputsRoute.name, { sessionId })
    return result.items
  }

  async function queuePendingInput(sessionId: string, content: string | SendMessageInput) {
    const result = await bridge.invoke(sessionsQueuePendingInputRoute.name, {
      sessionId,
      content
    })
    return result.item
  }

  async function updateQueuedInput(
    sessionId: string,
    itemId: string,
    content: string | SendMessageInput
  ) {
    const result = await bridge.invoke(sessionsUpdateQueuedInputRoute.name, {
      sessionId,
      itemId,
      content
    })
    return result.item
  }

  async function moveQueuedInput(sessionId: string, itemId: string, toIndex: number) {
    const result = await bridge.invoke(sessionsMoveQueuedInputRoute.name, {
      sessionId,
      itemId,
      toIndex
    })
    return result.items
  }

  async function convertPendingInputToSteer(sessionId: string, itemId: string) {
    const result = await bridge.invoke(sessionsConvertPendingInputToSteerRoute.name, {
      sessionId,
      itemId
    })
    return result.item
  }

  async function deletePendingInput(sessionId: string, itemId: string) {
    await bridge.invoke(sessionsDeletePendingInputRoute.name, {
      sessionId,
      itemId
    })
  }

  async function resumePendingQueue(sessionId: string) {
    await bridge.invoke(sessionsResumePendingQueueRoute.name, { sessionId })
  }

  async function retryMessage(sessionId: string, messageId: string) {
    await bridge.invoke(sessionsRetryMessageRoute.name, { sessionId, messageId })
  }

  async function deleteMessage(sessionId: string, messageId: string) {
    await bridge.invoke(sessionsDeleteMessageRoute.name, { sessionId, messageId })
  }

  async function editUserMessage(sessionId: string, messageId: string, text: string) {
    const result = await bridge.invoke(sessionsEditUserMessageRoute.name, {
      sessionId,
      messageId,
      text
    })
    return result.message
  }

  async function forkSession(sourceSessionId: string, targetMessageId: string, newTitle?: string) {
    const result = await bridge.invoke(sessionsForkRoute.name, {
      sourceSessionId,
      targetMessageId,
      newTitle
    })
    return result.session
  }

  async function searchHistory(query: string, options?: { limit?: number }) {
    const result = await bridge.invoke(sessionsSearchHistoryRoute.name, {
      query,
      options
    })
    return result.hits
  }

  async function getSearchResults(messageId: string, searchId?: string) {
    const result = await bridge.invoke(sessionsGetSearchResultsRoute.name, {
      messageId,
      searchId
    })
    return result.results
  }

  async function listMessageTraces(messageId: string) {
    const result = await bridge.invoke(sessionsListMessageTracesRoute.name, { messageId })
    return result.traces
  }

  async function translateText(text: string, locale?: string, agentId?: string) {
    const result = await bridge.invoke(sessionsTranslateTextRoute.name, {
      text,
      locale,
      agentId
    })
    return result.text
  }

  async function getAgents() {
    const result = await bridge.invoke(sessionsGetAgentsRoute.name, {})
    return result.agents
  }

  async function renameSession(sessionId: string, title: string) {
    await bridge.invoke(sessionsRenameRoute.name, { sessionId, title })
  }

  async function toggleSessionPinned(sessionId: string, pinned: boolean) {
    await bridge.invoke(sessionsTogglePinnedRoute.name, { sessionId, pinned })
  }

  async function clearSessionMessages(sessionId: string) {
    await bridge.invoke(sessionsClearMessagesRoute.name, { sessionId })
  }

  async function exportSession(
    sessionId: string,
    format: 'markdown' | 'html' | 'txt' | 'nowledge-mem'
  ) {
    return await bridge.invoke(sessionsExportRoute.name, {
      sessionId,
      format
    })
  }

  async function deleteSession(sessionId: string) {
    await bridge.invoke(sessionsDeleteRoute.name, { sessionId })
  }

  async function getAcpSessionCommands(sessionId: string) {
    const result = await bridge.invoke(sessionsGetAcpSessionCommandsRoute.name, { sessionId })
    return result.commands
  }

  async function getAcpSessionConfigOptions(sessionId: string) {
    const result = await bridge.invoke(sessionsGetAcpSessionConfigOptionsRoute.name, {
      sessionId
    })
    return result.state
  }

  async function setAcpSessionConfigOption(
    sessionId: string,
    configId: string,
    value: string | boolean
  ) {
    const result = await bridge.invoke(sessionsSetAcpSessionConfigOptionRoute.name, {
      sessionId,
      configId,
      value
    })
    return result.state
  }

  async function getPermissionMode(sessionId: string) {
    const result = await bridge.invoke(sessionsGetPermissionModeRoute.name, { sessionId })
    return result.mode
  }

  async function setPermissionMode(sessionId: string, mode: 'default' | 'full_access') {
    await bridge.invoke(sessionsSetPermissionModeRoute.name, { sessionId, mode })
  }

  async function setSessionSubagentEnabled(sessionId: string, enabled: boolean) {
    const result = await bridge.invoke(sessionsSetSubagentEnabledRoute.name, {
      sessionId,
      enabled
    })
    return result.session
  }

  async function setSessionModel(sessionId: string, providerId: string, modelId: string) {
    const result = await bridge.invoke(sessionsSetModelRoute.name, {
      sessionId,
      providerId,
      modelId
    })
    return result.session
  }

  async function setSessionProjectDir(sessionId: string, projectDir: string | null) {
    const result = await bridge.invoke(sessionsSetProjectDirRoute.name, {
      sessionId,
      projectDir
    })
    return result.session
  }

  async function getSessionGenerationSettings(sessionId: string) {
    const result = await bridge.invoke(sessionsGetGenerationSettingsRoute.name, { sessionId })
    return result.settings
  }

  async function getSessionDisabledAgentTools(sessionId: string) {
    const result = await bridge.invoke(sessionsGetDisabledAgentToolsRoute.name, { sessionId })
    return result.disabledAgentTools
  }

  async function updateSessionDisabledAgentTools(sessionId: string, disabledAgentTools: string[]) {
    const result = await bridge.invoke(sessionsUpdateDisabledAgentToolsRoute.name, {
      sessionId,
      disabledAgentTools
    })
    return result.disabledAgentTools
  }

  async function updateSessionGenerationSettings(
    sessionId: string,
    settings: DeepchatRouteInput<typeof sessionsUpdateGenerationSettingsRoute.name>['settings']
  ) {
    const result = await bridge.invoke(sessionsUpdateGenerationSettingsRoute.name, {
      sessionId,
      settings
    })
    return result.settings
  }

  function onUpdated(
    listener: (payload: {
      sessionIds: string[]
      reason: 'created' | 'activated' | 'deactivated' | 'list-refreshed' | 'updated' | 'deleted'
      activeSessionId?: string | null
      webContentsId?: number
    }) => void
  ) {
    return bridge.on(sessionsUpdatedEvent.name, listener)
  }

  function onStatusChanged(
    listener: (payload: {
      sessionId: string
      status: 'idle' | 'generating' | 'error'
      version: number
    }) => void
  ) {
    return bridge.on(sessionsStatusChangedEvent.name, listener)
  }

  function onPendingInputsChanged(
    listener: (payload: { sessionId: string; version: number }) => void
  ) {
    return bridge.on(sessionsPendingInputsChangedEvent.name, listener)
  }

  function onAcpCommandsReady(
    listener: (payload: {
      conversationId: string
      agentId: string
      commands: Array<{
        name: string
        description: string
        input?: { hint: string } | null
      }>
      version: number
    }) => void
  ) {
    return bridge.on(sessionsAcpCommandsReadyEvent.name, listener)
  }

  function onAcpConfigOptionsReady(
    listener: (payload: {
      conversationId?: string
      agentId: string
      workdir: string
      configState: {
        source: 'configOptions' | 'legacy'
        options: Array<{
          id: string
          label: string
          description?: string | null
          type: 'select' | 'boolean'
          category?: string | null
          currentValue: string | boolean
          options?: Array<{
            value: string
            label: string
            description?: string | null
            groupId?: string | null
            groupLabel?: string | null
          }>
        }>
      }
      version: number
    }) => void
  ) {
    return bridge.on(sessionsAcpConfigOptionsReadyEvent.name, listener)
  }

  return {
    create,
    restore,
    activate,
    deactivate,
    getActive,
    list,
    ensureAcpDraftSession,
    listPendingInputs,
    queuePendingInput,
    updateQueuedInput,
    moveQueuedInput,
    convertPendingInputToSteer,
    deletePendingInput,
    resumePendingQueue,
    retryMessage,
    deleteMessage,
    editUserMessage,
    forkSession,
    searchHistory,
    getSearchResults,
    listMessageTraces,
    translateText,
    getAgents,
    renameSession,
    toggleSessionPinned,
    clearSessionMessages,
    exportSession,
    deleteSession,
    getAcpSessionCommands,
    getAcpSessionConfigOptions,
    setAcpSessionConfigOption,
    getPermissionMode,
    setPermissionMode,
    setSessionSubagentEnabled,
    setSessionModel,
    setSessionProjectDir,
    getSessionGenerationSettings,
    getSessionDisabledAgentTools,
    updateSessionDisabledAgentTools,
    updateSessionGenerationSettings,
    onUpdated,
    onStatusChanged,
    onPendingInputsChanged,
    onAcpCommandsReady,
    onAcpConfigOptionsReady
  }
}

export type SessionClient = ReturnType<typeof createSessionClient>
