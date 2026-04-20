import type {
  IAgentSessionPresenter,
  IConfigPresenter,
  ILlmProviderPresenter
} from '@shared/presenter'
import type { DeepchatEventName, DeepchatEventPayload } from '@shared/contracts/events'
import type {
  ChatMessageRecord,
  CreateSessionInput,
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

export type SessionListFilters = {
  agentId?: string
  projectDir?: string
  includeSubagents?: boolean
  parentSessionId?: string
}

export interface SessionRepository {
  create(input: CreateSessionInput, webContentsId: number): Promise<SessionWithState>
  get(sessionId: string): Promise<SessionWithState | null>
  list(filters?: SessionListFilters): Promise<SessionWithState[]>
  activate(webContentsId: number, sessionId: string): Promise<void>
  deactivate(webContentsId: number): Promise<void>
  getActive(webContentsId: number): Promise<SessionWithState | null>
}

export interface MessageRepository {
  listBySession(sessionId: string): Promise<ChatMessageRecord[]>
  get(messageId: string): Promise<ChatMessageRecord | null>
}

export interface ProviderExecutionPort {
  sendMessage(sessionId: string, content: string | SendMessageInput): Promise<void>
  cancelGeneration(sessionId: string): Promise<void>
  respondToolInteraction(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    response: ToolInteractionResponse
  ): Promise<ToolInteractionResult>
  testConnection(
    providerId: string,
    modelId?: string
  ): Promise<{
    isOk: boolean
    errorMsg: string | null
  }>
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
    | 'getSession'
    | 'getSessionList'
    | 'activateSession'
    | 'deactivateSession'
    | 'getActiveSession'
    | 'getMessages'
    | 'getMessage'
    | 'sendMessage'
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
      create: async (input, webContentsId) =>
        await deps.agentSessionPresenter.createSession(input, webContentsId),
      get: async (sessionId) => await deps.agentSessionPresenter.getSession(sessionId),
      list: async (filters) => await deps.agentSessionPresenter.getSessionList(filters),
      activate: async (webContentsId, sessionId) =>
        await deps.agentSessionPresenter.activateSession(webContentsId, sessionId),
      deactivate: async (webContentsId) =>
        await deps.agentSessionPresenter.deactivateSession(webContentsId),
      getActive: async (webContentsId) =>
        await deps.agentSessionPresenter.getActiveSession(webContentsId)
    },
    messageRepository: {
      listBySession: async (sessionId) => await deps.agentSessionPresenter.getMessages(sessionId),
      get: async (messageId) => await deps.agentSessionPresenter.getMessage(messageId)
    },
    providerExecutionPort: {
      sendMessage: async (sessionId, content) =>
        await deps.agentSessionPresenter.sendMessage(sessionId, content),
      cancelGeneration: async (sessionId) =>
        await deps.agentSessionPresenter.cancelGeneration(sessionId),
      respondToolInteraction: async (sessionId, messageId, toolCallId, response) =>
        await deps.agentSessionPresenter.respondToolInteraction(
          sessionId,
          messageId,
          toolCallId,
          response
        ),
      testConnection: async (providerId, modelId) =>
        await deps.llmProviderPresenter.check(providerId, modelId)
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
