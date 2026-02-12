import type { CONVERSATION_SETTINGS, ModelConfig } from '@shared/presenter'
import type { SessionContextResolved } from './sessionContext'

export type SessionResolveInput = {
  settings: CONVERSATION_SETTINGS
  fallbackChatMode?: 'agent' | 'acp agent'
  modelConfig?: ModelConfig
}

export function resolveSessionContext(input: SessionResolveInput): SessionContextResolved {
  const { settings, modelConfig } = input
  // Migrate legacy 'chat' mode to 'agent' mode silently
  const chatMode = settings.chatMode || input.fallbackChatMode || 'agent'

  return {
    chatMode,
    providerId: settings.providerId,
    modelId: settings.modelId,
    supportsVision: modelConfig?.vision ?? false,
    supportsFunctionCall: modelConfig?.functionCall ?? false,
    agentWorkspacePath: chatMode === 'agent' ? (settings.agentWorkspacePath ?? null) : null,
    enabledMcpTools: settings.enabledMcpTools,
    acpWorkdirMap: chatMode === 'acp agent' ? settings.acpWorkdirMap : undefined
  }
}
