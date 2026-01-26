import type { CONVERSATION_SETTINGS } from '@shared/presenter'

// Phase 6: Simplified default settings - only essential fields
// Runtime configuration (temperature, contextLength, etc.) comes from agent's SessionInfo
export const DEFAULT_SETTINGS: CONVERSATION_SETTINGS = {
  providerId: 'deepseek',
  modelId: 'deepseek-chat',
  agentWorkspacePath: null
}
