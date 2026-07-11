import type {
  IAgentSessionPresenter,
  IConfigPresenter,
  ILlmProviderPresenter,
  ActiveSessionResolution,
  ProviderConnectionCheckOptions,
  ProviderConnectionCheckResult,
  SessionResolutionListFilters,
  SessionResolutionResult
} from '@shared/presenter'
import type { DeepchatEventName, DeepchatEventPayload } from '@shared/contracts/events'
import type { CreateSessionOperationSummary } from '@shared/contracts/routes/sessions.routes'
import type {
  ChatMessagePageResult,
  ChatMessageRecord,
  CreateSessionInput,
  MessagePageCursor,
  MessageStartResult,
  SendMessageInput,
  SessionWithState,
  ToolInteractionResponse,
  ToolInteractionResult
} from '@shared/types/agent-interface'
import type {
  ProviderCatalogPort as PresenterProviderCatalogPort,
  SessionPermissionPort as PresenterSessionPermissionPort
} from '../presenter/runtimePorts'
import { publishDeepchatEvent } from './publishDeepchatEvent'

export type SessionListFilters = SessionResolutionListFilters

export interface SessionRepository {
  create(input: CreateSessionInput, operationId: string): Promise<SessionWithState | null>
  getCreateOperation(operationId: string): Promise<{
    operation: CreateSessionOperationSummary | null
    session: SessionWithState | null
  }>
  listCreateOperations(input: {
    limit: number
    cursor?: { createdAt: number; operationId: string } | null
  }): {
    items: CreateSessionOperationSummary[]
    nextCursor: { createdAt: number; operationId: string } | null
    hasMore: boolean
  }
  dismissCreateOperation(operationId: string): CreateSessionOperationSummary | null
  resolve(sessionId: string): Promise<SessionResolutionResult>
  resolveList(filters?: SessionListFilters): Promise<SessionResolutionResult[]>
  activate(webContentsId: number, sessionId: string): Promise<void>
  deactivate(webContentsId: number): Promise<void>
  resolveActive(webContentsId: number): Promise<ActiveSessionResolution>
}

export interface MessageRepository {
  listBySession(sessionId: string): Promise<ChatMessageRecord[]>
  listPageBySession(
    sessionId: string,
    options?: {
      limit?: number
      cursor?: MessagePageCursor | null
    }
  ): Promise<ChatMessagePageResult>
  get(messageId: string): Promise<ChatMessageRecord | null>
}

export interface ProviderExecutionPort {
  sendMessage(sessionId: string, content: string | SendMessageInput): Promise<MessageStartResult>
  steerActiveTurn(sessionId: string, content: string | SendMessageInput): Promise<void>
  cancelGeneration(sessionId: string): Promise<void>
  respondToolInteraction(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    response: ToolInteractionResponse
  ): Promise<ToolInteractionResult>
  testConnection(
    providerId: string,
    modelId?: string,
    options?: ProviderConnectionCheckOptions
  ): Promise<ProviderConnectionCheckResult>
}

export type ProviderCatalogPort = Pick<
  PresenterProviderCatalogPort,
  'getAgentType' | 'getProviderModels' | 'getCustomModels'
>

export type SessionPermissionPort = Pick<PresenterSessionPermissionPort, 'clearSessionPermissions'>

export interface WindowEventPort {
  publish<T extends DeepchatEventName>(name: T, payload: DeepchatEventPayload<T>): void
}

export function createPresenterHotPathPorts(deps: {
  agentSessionPresenter: Pick<
    IAgentSessionPresenter,
    | 'createSession'
    | 'getCreateOperation'
    | 'listCreateOperations'
    | 'dismissCreateOperation'
    | 'resolveSession'
    | 'resolveSessionList'
    | 'activateSession'
    | 'deactivateSession'
    | 'resolveActiveSession'
    | 'getMessages'
    | 'listMessagesPage'
    | 'getMessage'
    | 'sendMessage'
    | 'steerActiveTurn'
    | 'cancelGeneration'
    | 'respondToolInteraction'
  > & {
    clearSessionPermissions: (sessionId: string) => void | Promise<void>
  }
  configPresenter: Pick<IConfigPresenter, 'getProviderModels' | 'getCustomModels' | 'getAgentType'>
  llmProviderPresenter: Pick<ILlmProviderPresenter, 'check'>
}): {
  sessionRepository: SessionRepository
  messageRepository: MessageRepository
  providerExecutionPort: ProviderExecutionPort
  providerCatalogPort: ProviderCatalogPort
  sessionPermissionPort: SessionPermissionPort
  windowEventPort: WindowEventPort
} {
  return {
    sessionRepository: {
      create: async (input, operationId) =>
        await deps.agentSessionPresenter.createSession(input, operationId),
      getCreateOperation: async (operationId) =>
        await deps.agentSessionPresenter.getCreateOperation(operationId),
      listCreateOperations: (input) => deps.agentSessionPresenter.listCreateOperations(input),
      dismissCreateOperation: (operationId) =>
        deps.agentSessionPresenter.dismissCreateOperation(operationId),
      resolve: async (sessionId) => await deps.agentSessionPresenter.resolveSession(sessionId),
      resolveList: async (filters) => await deps.agentSessionPresenter.resolveSessionList(filters),
      activate: async (webContentsId, sessionId) =>
        await deps.agentSessionPresenter.activateSession(webContentsId, sessionId),
      deactivate: async (webContentsId) =>
        await deps.agentSessionPresenter.deactivateSession(webContentsId),
      resolveActive: async (webContentsId) =>
        await deps.agentSessionPresenter.resolveActiveSession(webContentsId)
    },
    messageRepository: {
      listBySession: async (sessionId) => await deps.agentSessionPresenter.getMessages(sessionId),
      listPageBySession: async (sessionId, options) =>
        await deps.agentSessionPresenter.listMessagesPage(sessionId, options),
      get: async (messageId) => await deps.agentSessionPresenter.getMessage(messageId)
    },
    providerExecutionPort: {
      sendMessage: async (sessionId, content) =>
        await deps.agentSessionPresenter.sendMessage(sessionId, content),
      steerActiveTurn: async (sessionId, content) =>
        await deps.agentSessionPresenter.steerActiveTurn(sessionId, content),
      cancelGeneration: async (sessionId) =>
        await deps.agentSessionPresenter.cancelGeneration(sessionId),
      respondToolInteraction: async (sessionId, messageId, toolCallId, response) =>
        await deps.agentSessionPresenter.respondToolInteraction(
          sessionId,
          messageId,
          toolCallId,
          response
        ),
      testConnection: async (providerId, modelId, options) =>
        await deps.llmProviderPresenter.check(providerId, modelId, options)
    },
    providerCatalogPort: {
      getProviderModels: (providerId) => deps.configPresenter.getProviderModels(providerId) ?? [],
      getCustomModels: (providerId) => deps.configPresenter.getCustomModels(providerId) ?? [],
      getAgentType: async (agentId) => await deps.configPresenter.getAgentType(agentId)
    },
    sessionPermissionPort: {
      clearSessionPermissions: (sessionId) =>
        deps.agentSessionPresenter.clearSessionPermissions(sessionId)
    },
    windowEventPort: {
      publish: (name, payload) => {
        publishDeepchatEvent(name, payload)
      }
    }
  }
}
