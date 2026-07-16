import type {
  DiscordRemoteSettings,
  FeishuRemoteSettings,
  ConfigServicePort,
  FileServicePort,
  RemoteServicePort,
  QQBotRemoteSettings,
  ITabPresenter,
  IWindowPresenter,
  TelegramRemoteSettings,
  WeixinIlinkRemoteSettings
} from '@shared/presenter'
import type {
  ChatMessageRecord,
  CreateDetachedSessionInput,
  MessageStartResult,
  SendMessageInput,
  SessionWithState,
  ToolInteractionResponse,
  ToolInteractionResult
} from '@shared/types/agent-interface'
import type { SearchResult } from '@shared/types/core/search'
import type { AgentManagerGenerationPort } from '@/agent/manager/agentManager'
import type { AgentSettingsPort } from '@/agent/settings'
import type { SettingsStore } from '@/config/settingsStore'
import type { CronJobRemoteDeliveryPort } from '../scheduler/deliveryRouter'

export interface RemoteSessionLifecyclePort {
  createDetachedSession(input: CreateDetachedSessionInput): Promise<SessionWithState>
}

export interface RemoteSessionTurnPort {
  sendMessage(sessionId: string, content: string | SendMessageInput): Promise<MessageStartResult>
  respondToolInteraction(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    response: ToolInteractionResponse
  ): Promise<ToolInteractionResult>
}

export interface RemoteSessionAssignmentPort {
  setSessionModel(sessionId: string, providerId: string, modelId: string): Promise<SessionWithState>
}

export interface RemoteSessionProjectionPort {
  getSession(sessionId: string): Promise<SessionWithState | null>
  listSessions(filters?: { agentId?: string }): Promise<SessionWithState[]>
  getMessages(sessionId: string): Promise<ChatMessageRecord[]>
  getMessage(messageId: string): Promise<ChatMessageRecord | null>
  getSearchResults(messageId: string, searchId?: string): Promise<SearchResult[]>
}

export interface RemoteDesktopSessionPort {
  activate(webContentsId: number, sessionId: string): Promise<void>
}

export interface RemoteServiceDeps {
  configService: ConfigServicePort
  settings: Pick<SettingsStore, 'get' | 'set'>
  agentSettings: Pick<AgentSettingsPort, 'listAgents' | 'getAgentType'>
  projects: { getDefaultProjectPath(): string | null }
  lifecycle: RemoteSessionLifecyclePort
  turn: RemoteSessionTurnPort
  assignment: RemoteSessionAssignmentPort
  projection: RemoteSessionProjectionPort
  desktop: RemoteDesktopSessionPort
  fileService: FileServicePort
  agentManager: AgentManagerGenerationPort
  windowPresenter: IWindowPresenter
  tabPresenter: ITabPresenter
}

export interface RemoteRuntimeLifecycle {
  initialize(): Promise<void>
  destroy(): Promise<void>
}

export interface RemoteServiceLike
  extends RemoteServicePort, RemoteRuntimeLifecycle, CronJobRemoteDeliveryPort {
  buildTelegramSettingsSnapshot(): TelegramRemoteSettings
  buildFeishuSettingsSnapshot(): FeishuRemoteSettings
  buildQQBotSettingsSnapshot(): QQBotRemoteSettings
  buildDiscordSettingsSnapshot(): DiscordRemoteSettings
  buildWeixinIlinkSettingsSnapshot(): WeixinIlinkRemoteSettings
}
