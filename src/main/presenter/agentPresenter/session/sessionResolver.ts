import type { CONVERSATION_SETTINGS, ModelConfig } from '@shared/presenter'
import type { SessionContextResolved } from './sessionContext'

export type SessionResolveInput = {
  settings: CONVERSATION_SETTINGS
  modelConfig?: ModelConfig
}

export function resolveSessionContext(input: SessionResolveInput): SessionContextResolved {
  const { settings, modelConfig } = input

  return {
    providerId: settings.providerId,
    modelId: settings.modelId,
    supportsVision: modelConfig?.vision ?? false,
    supportsFunctionCall: modelConfig?.functionCall ?? false,
    agentWorkspacePath: settings.agentWorkspacePath ?? null,
    enabledMcpTools: undefined // Phase 6: All MCP tools enabled by default
  }
}
