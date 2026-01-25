import type { CONVERSATION_SETTINGS, ModelConfig } from '@shared/presenter'
import type { SessionContextResolved } from './sessionContext'

export type SessionResolveInput = {
  settings: CONVERSATION_SETTINGS
  fallbackChatMode?: 'chat' | 'agent'
  modelConfig?: ModelConfig
}

export function resolveSessionContext(input: SessionResolveInput): SessionContextResolved {
  const { settings, modelConfig } = input
  const rawChatMode = settings.chatMode || input.fallbackChatMode || 'agent'
  // chatMode is now always 'agent' after ACP cleanup
  const chatMode: 'chat' | 'agent' = rawChatMode

  return {
    chatMode,
    providerId: settings.providerId,
    modelId: settings.modelId,
    supportsVision: modelConfig?.vision ?? false,
    supportsFunctionCall: modelConfig?.functionCall ?? false,
    agentWorkspacePath: chatMode === 'agent' ? (settings.agentWorkspacePath ?? null) : null,
    enabledMcpTools: settings.enabledMcpTools
  }
}
