import type { IAgentSessionPresenter } from '@shared/presenter'
import type { DeepchatEventName, DeepchatEventPayload } from '@shared/contracts/events'
import type {
  ChatMessageRecord,
  CreateSessionInput,
  SendMessageInput,
  SessionWithState
} from '@shared/types/agent-interface'
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
}

export interface ProviderCatalogPort {
  getAgentType(agentId: string): Promise<'deepchat' | 'acp' | null>
}

export interface SessionPermissionPort {
  clearSessionPermissions(sessionId: string): void | Promise<void>
}

export interface WindowEventPort {
  publish<T extends DeepchatEventName>(name: T, payload: DeepchatEventPayload<T>): void
}

export function createPresenterHotPathPorts(
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
    | 'getAgents'
  >
): {
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
        await agentSessionPresenter.createSession(input, webContentsId),
      get: async (sessionId) => await agentSessionPresenter.getSession(sessionId),
      list: async (filters) => await agentSessionPresenter.getSessionList(filters),
      activate: async (webContentsId, sessionId) =>
        await agentSessionPresenter.activateSession(webContentsId, sessionId),
      deactivate: async (webContentsId) =>
        await agentSessionPresenter.deactivateSession(webContentsId),
      getActive: async (webContentsId) =>
        await agentSessionPresenter.getActiveSession(webContentsId)
    },
    messageRepository: {
      listBySession: async (sessionId) => await agentSessionPresenter.getMessages(sessionId),
      get: async (messageId) => await agentSessionPresenter.getMessage(messageId)
    },
    providerExecutionPort: {
      sendMessage: async (sessionId, content) =>
        await agentSessionPresenter.sendMessage(sessionId, content),
      cancelGeneration: async (sessionId) => await agentSessionPresenter.cancelGeneration(sessionId)
    },
    providerCatalogPort: {
      getAgentType: async (agentId) => {
        if (agentId === 'deepchat') {
          return 'deepchat'
        }

        const agents = await agentSessionPresenter.getAgents()
        const matched = agents.find((agent) => agent.id === agentId)
        if (!matched) {
          return null
        }

        const agentType = matched.agentType ?? matched.type
        return agentType === 'deepchat' || agentType === 'acp' ? agentType : null
      }
    },
    sessionPermissionPort: {
      clearSessionPermissions: () => {
        // Legacy presenter-backed runtime already clears permission state on cancel.
      }
    },
    windowEventPort: {
      publish: (name, payload) => {
        publishDeepchatEvent(name, payload)
      }
    }
  }
}
