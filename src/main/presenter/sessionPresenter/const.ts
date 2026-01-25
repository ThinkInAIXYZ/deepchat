import type { CONVERSATION_SETTINGS } from '@shared/presenter'

export const DEFAULT_SETTINGS: CONVERSATION_SETTINGS = {
  systemPrompt: '',
  systemPromptId: 'default',
  temperature: 0.7,
  contextLength: 12800,
  maxTokens: 8192,
  providerId: 'deepseek',
  modelId: 'deepseek-chat',
  chatMode: 'agent',
  artifacts: 0,
  activeSkills: []
}
