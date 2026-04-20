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

export class SessionClient {
  constructor(private readonly bridge: DeepchatBridge = getDeepchatBridge()) {}

  async create(input: CreateSessionInput) {
    return await this.bridge.invoke(
      sessionsCreateRoute.name,
      input as DeepchatRouteInput<typeof sessionsCreateRoute.name>
    )
  }

  async restore(sessionId: string) {
    return await this.bridge.invoke(sessionsRestoreRoute.name, { sessionId })
  }

  async activate(sessionId: string) {
    return await this.bridge.invoke(sessionsActivateRoute.name, { sessionId })
  }

  async deactivate() {
    return await this.bridge.invoke(sessionsDeactivateRoute.name, {})
  }

  async getActive() {
    return await this.bridge.invoke(sessionsGetActiveRoute.name, {})
  }

  async list(filters?: {
    agentId?: string
    projectDir?: string
    includeSubagents?: boolean
    parentSessionId?: string
  }) {
    return await this.bridge.invoke(sessionsListRoute.name, filters ?? {})
  }

  async ensureAcpDraftSession(input: {
    agentId: string
    projectDir: string
    permissionMode?: 'default' | 'full_access'
  }) {
    const result = await this.bridge.invoke(sessionsEnsureAcpDraftRoute.name, input)
    return result.session
  }

  async listPendingInputs(sessionId: string) {
    const result = await this.bridge.invoke(sessionsListPendingInputsRoute.name, { sessionId })
    return result.items
  }

  async queuePendingInput(sessionId: string, content: string | SendMessageInput) {
    const result = await this.bridge.invoke(sessionsQueuePendingInputRoute.name, {
      sessionId,
      content
    })
    return result.item
  }

  async updateQueuedInput(sessionId: string, itemId: string, content: string | SendMessageInput) {
    const result = await this.bridge.invoke(sessionsUpdateQueuedInputRoute.name, {
      sessionId,
      itemId,
      content
    })
    return result.item
  }

  async moveQueuedInput(sessionId: string, itemId: string, toIndex: number) {
    const result = await this.bridge.invoke(sessionsMoveQueuedInputRoute.name, {
      sessionId,
      itemId,
      toIndex
    })
    return result.items
  }

  async convertPendingInputToSteer(sessionId: string, itemId: string) {
    const result = await this.bridge.invoke(sessionsConvertPendingInputToSteerRoute.name, {
      sessionId,
      itemId
    })
    return result.item
  }

  async deletePendingInput(sessionId: string, itemId: string) {
    await this.bridge.invoke(sessionsDeletePendingInputRoute.name, {
      sessionId,
      itemId
    })
  }

  async resumePendingQueue(sessionId: string) {
    await this.bridge.invoke(sessionsResumePendingQueueRoute.name, { sessionId })
  }

  async retryMessage(sessionId: string, messageId: string) {
    await this.bridge.invoke(sessionsRetryMessageRoute.name, { sessionId, messageId })
  }

  async deleteMessage(sessionId: string, messageId: string) {
    await this.bridge.invoke(sessionsDeleteMessageRoute.name, { sessionId, messageId })
  }

  async editUserMessage(sessionId: string, messageId: string, text: string) {
    const result = await this.bridge.invoke(sessionsEditUserMessageRoute.name, {
      sessionId,
      messageId,
      text
    })
    return result.message
  }

  async forkSession(sourceSessionId: string, targetMessageId: string, newTitle?: string) {
    const result = await this.bridge.invoke(sessionsForkRoute.name, {
      sourceSessionId,
      targetMessageId,
      newTitle
    })
    return result.session
  }

  async searchHistory(query: string, options?: { limit?: number }) {
    const result = await this.bridge.invoke(sessionsSearchHistoryRoute.name, {
      query,
      options
    })
    return result.hits
  }

  async getSearchResults(messageId: string, searchId?: string) {
    const result = await this.bridge.invoke(sessionsGetSearchResultsRoute.name, {
      messageId,
      searchId
    })
    return result.results
  }

  async listMessageTraces(messageId: string) {
    const result = await this.bridge.invoke(sessionsListMessageTracesRoute.name, { messageId })
    return result.traces
  }

  async translateText(text: string, locale?: string, agentId?: string) {
    const result = await this.bridge.invoke(sessionsTranslateTextRoute.name, {
      text,
      locale,
      agentId
    })
    return result.text
  }

  async getAgents() {
    const result = await this.bridge.invoke(sessionsGetAgentsRoute.name, {})
    return result.agents
  }

  async renameSession(sessionId: string, title: string) {
    await this.bridge.invoke(sessionsRenameRoute.name, { sessionId, title })
  }

  async toggleSessionPinned(sessionId: string, pinned: boolean) {
    await this.bridge.invoke(sessionsTogglePinnedRoute.name, { sessionId, pinned })
  }

  async clearSessionMessages(sessionId: string) {
    await this.bridge.invoke(sessionsClearMessagesRoute.name, { sessionId })
  }

  async exportSession(sessionId: string, format: 'markdown' | 'html' | 'txt' | 'nowledge-mem') {
    return await this.bridge.invoke(sessionsExportRoute.name, {
      sessionId,
      format
    })
  }

  async deleteSession(sessionId: string) {
    await this.bridge.invoke(sessionsDeleteRoute.name, { sessionId })
  }

  async getAcpSessionCommands(sessionId: string) {
    const result = await this.bridge.invoke(sessionsGetAcpSessionCommandsRoute.name, { sessionId })
    return result.commands
  }

  async getAcpSessionConfigOptions(sessionId: string) {
    const result = await this.bridge.invoke(sessionsGetAcpSessionConfigOptionsRoute.name, {
      sessionId
    })
    return result.state
  }

  async setAcpSessionConfigOption(sessionId: string, configId: string, value: string | boolean) {
    const result = await this.bridge.invoke(sessionsSetAcpSessionConfigOptionRoute.name, {
      sessionId,
      configId,
      value
    })
    return result.state
  }

  async getPermissionMode(sessionId: string) {
    const result = await this.bridge.invoke(sessionsGetPermissionModeRoute.name, { sessionId })
    return result.mode
  }

  async setPermissionMode(sessionId: string, mode: 'default' | 'full_access') {
    await this.bridge.invoke(sessionsSetPermissionModeRoute.name, { sessionId, mode })
  }

  async setSessionSubagentEnabled(sessionId: string, enabled: boolean) {
    const result = await this.bridge.invoke(sessionsSetSubagentEnabledRoute.name, {
      sessionId,
      enabled
    })
    return result.session
  }

  async setSessionModel(sessionId: string, providerId: string, modelId: string) {
    const result = await this.bridge.invoke(sessionsSetModelRoute.name, {
      sessionId,
      providerId,
      modelId
    })
    return result.session
  }

  async setSessionProjectDir(sessionId: string, projectDir: string | null) {
    const result = await this.bridge.invoke(sessionsSetProjectDirRoute.name, {
      sessionId,
      projectDir
    })
    return result.session
  }

  async getSessionGenerationSettings(sessionId: string) {
    const result = await this.bridge.invoke(sessionsGetGenerationSettingsRoute.name, { sessionId })
    return result.settings
  }

  async getSessionDisabledAgentTools(sessionId: string) {
    const result = await this.bridge.invoke(sessionsGetDisabledAgentToolsRoute.name, { sessionId })
    return result.disabledAgentTools
  }

  async updateSessionDisabledAgentTools(sessionId: string, disabledAgentTools: string[]) {
    const result = await this.bridge.invoke(sessionsUpdateDisabledAgentToolsRoute.name, {
      sessionId,
      disabledAgentTools
    })
    return result.disabledAgentTools
  }

  async updateSessionGenerationSettings(
    sessionId: string,
    settings: DeepchatRouteInput<typeof sessionsUpdateGenerationSettingsRoute.name>['settings']
  ) {
    const result = await this.bridge.invoke(sessionsUpdateGenerationSettingsRoute.name, {
      sessionId,
      settings
    })
    return result.settings
  }

  onUpdated(
    listener: (payload: {
      sessionIds: string[]
      reason: 'created' | 'activated' | 'deactivated' | 'list-refreshed' | 'updated' | 'deleted'
      activeSessionId?: string | null
      webContentsId?: number
    }) => void
  ) {
    return this.bridge.on(sessionsUpdatedEvent.name, listener)
  }

  onStatusChanged(
    listener: (payload: {
      sessionId: string
      status: 'idle' | 'generating' | 'error'
      version: number
    }) => void
  ) {
    return this.bridge.on(sessionsStatusChangedEvent.name, listener)
  }

  onPendingInputsChanged(listener: (payload: { sessionId: string; version: number }) => void) {
    return this.bridge.on(sessionsPendingInputsChangedEvent.name, listener)
  }

  onAcpCommandsReady(
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
    return this.bridge.on(sessionsAcpCommandsReadyEvent.name, listener)
  }

  onAcpConfigOptionsReady(
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
    return this.bridge.on(sessionsAcpConfigOptionsReadyEvent.name, listener)
  }
}
