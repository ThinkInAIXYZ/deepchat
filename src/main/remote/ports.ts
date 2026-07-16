import type {
  DiscordRemoteSettings,
  FeishuRemoteSettings,
  RemoteServicePort,
  QQBotRemoteSettings,
  TelegramRemoteSettings,
  WeixinIlinkRemoteSettings
} from '@shared/types/remote'
import type {
  AgentType,
  ChatMessageRecord,
  CreateDetachedSessionInput,
  MessageStartResult,
  SendMessageInput,
  SessionWithState,
  ToolInteractionResponse,
  ToolInteractionResult
} from '@shared/types/agent-interface'
import type { SearchResult } from '@shared/types/core/search'
import type { SettingsStore } from '@/config/settingsStore'
import type { CronJob, CronJobDeliveryTarget, CronJobRun } from '@shared/cronJobs'
import type { MessageFile } from '@shared/chat'
import type { TelegramAgentOption, TelegramModelProviderOption } from './types'

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
  cancelGeneration(sessionId: string): Promise<void>
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

export interface RemoteCatalogPort {
  getAgentType(agentId: string): Promise<AgentType | null>
  listAgents(): Promise<TelegramAgentOption[]>
  listModelProviders(): Promise<TelegramModelProviderOption[]>
}

export interface RemoteWorkspacePort {
  getDefaultProjectPath(): string | null
  prepareFile(filePath: string, type?: string): Promise<MessageFile>
}

export interface RemoteDesktopPort {
  openSession(sessionId: string): Promise<boolean>
}

export interface RemoteServiceDeps {
  settings: Pick<SettingsStore, 'get' | 'set'>
  catalog: RemoteCatalogPort
  workspace: RemoteWorkspacePort
  lifecycle: RemoteSessionLifecyclePort
  turn: RemoteSessionTurnPort
  assignment: RemoteSessionAssignmentPort
  projection: RemoteSessionProjectionPort
  desktop: RemoteDesktopPort
}

export interface RemoteRuntimeLifecycle {
  initialize(): Promise<void>
  destroy(): Promise<void>
}

export interface RemoteServiceLike extends RemoteServicePort, RemoteRuntimeLifecycle {
  deliverCronJobResult(input: {
    job: CronJob
    run: CronJobRun
    target: Extract<CronJobDeliveryTarget, { type: 'remote' }>
  }): Promise<{ remoteMessageId?: string | null }>
  buildTelegramSettingsSnapshot(): TelegramRemoteSettings
  buildFeishuSettingsSnapshot(): FeishuRemoteSettings
  buildQQBotSettingsSnapshot(): QQBotRemoteSettings
  buildDiscordSettingsSnapshot(): DiscordRemoteSettings
  buildWeixinIlinkSettingsSnapshot(): WeixinIlinkRemoteSettings
}
