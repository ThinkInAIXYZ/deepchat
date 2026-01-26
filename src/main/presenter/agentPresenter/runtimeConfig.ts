/**
 * Phase 6: Runtime Configuration Helper
 *
 * This module provides helper functions to get runtime configuration values
 * that were previously stored in CONVERSATION_SETTINGS but now come from:
 * 1. Agent's SessionInfo (runtime state from the agent)
 * 2. Model configuration defaults
 * 3. Hardcoded defaults for removed features
 */

import { CONVERSATION } from '@shared/presenter'
import { presenter } from '@/presenter'

export interface RuntimeConfig {
  providerId: string
  modelId: string
  systemPrompt: string
  systemPromptId: string | undefined
  temperature: number
  contextLength: number
  maxTokens: number
  artifacts: number
  enabledMcpTools: string[] | undefined
  thinkingBudget: number | undefined
  reasoningEffort: 'minimal' | 'low' | 'medium' | 'high' | undefined
  verbosity: 'low' | 'medium' | 'high' | undefined
  enableSearch: boolean | undefined
  forcedSearch: boolean | undefined
  searchStrategy: 'turbo' | 'max' | undefined
  selectedVariantsMap: Record<string, string>
  activeSkills: string[]
}

/**
 * Get runtime configuration for a conversation
 * These values now come from agent's SessionInfo, not from stored settings
 */
export function getRuntimeConfig(conversation: CONVERSATION): RuntimeConfig {
  // Get model config for defaults
  const modelConfig = presenter.configPresenter.getModelConfig(
    conversation.settings.modelId,
    conversation.settings.providerId
  )

  return {
    providerId: conversation.settings.providerId,
    modelId: conversation.settings.modelId,
    systemPrompt: '', // Phase 6: Use agent default
    systemPromptId: undefined, // Phase 6: System prompts removed
    contextLength: modelConfig?.contextLength || 4000,
    maxTokens: modelConfig?.maxTokens || 2000,
    temperature: modelConfig?.temperature ?? 0.7,
    artifacts: 0, // Phase 6: Artifacts feature removed
    enabledMcpTools: undefined, // Phase 6: All tools enabled by default
    thinkingBudget: modelConfig?.thinkingBudget,
    reasoningEffort: undefined, // Phase 6: Use agent default
    verbosity: undefined, // Phase 6: Use agent default
    enableSearch: undefined, // Phase 6: Use agent default
    forcedSearch: undefined, // Phase 6: Use agent default
    searchStrategy: undefined, // Phase 6: Use agent default
    selectedVariantsMap: {}, // Phase 6: Variant management removed
    activeSkills: [] // Phase 6: Active skills feature removed
  }
}
