import type { CONVERSATION_SETTINGS, ModelConfig } from '@shared/presenter'
import type { SessionContextResolved } from './sessionContext'

export type ChatMode = 'agent' | 'acp agent'

export type SessionResolveInput = {
  settings: CONVERSATION_SETTINGS
  fallbackChatMode?: ChatMode
  modelConfig?: ModelConfig
}

export type SessionResolveResult = SessionContextResolved & {
  needsMigration?: boolean
}

function normalizeChatMode(mode: string | undefined): ChatMode {
  if (mode === 'acp agent') return 'acp agent'
  if (mode === 'agent') return 'agent'
  return 'agent'
}

function isLegacyChatMode(mode: string | undefined): boolean {
  return mode === 'chat'
}

export function resolveSessionContext(input: SessionResolveInput): SessionResolveResult {
  const { settings, modelConfig } = input

  const rawChatMode = settings.chatMode
  const rawFallback = input.fallbackChatMode

  const settingsNeedsMigration = isLegacyChatMode(rawChatMode)

  const chatMode = normalizeChatMode(rawChatMode) ?? normalizeChatMode(rawFallback) ?? 'agent'

  return {
    chatMode,
    providerId: settings.providerId,
    modelId: settings.modelId,
    supportsVision: modelConfig?.vision ?? false,
    supportsFunctionCall: modelConfig?.functionCall ?? false,
    agentWorkspacePath: chatMode === 'agent' ? (settings.agentWorkspacePath ?? null) : null,
    enabledMcpTools: settings.enabledMcpTools,
    acpWorkdirMap: chatMode === 'acp agent' ? settings.acpWorkdirMap : undefined,
    needsMigration: settingsNeedsMigration
  }
}
